import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter, map } from 'rxjs';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { Tooltip } from 'primeng/tooltip';
import { NgOptimizedImage } from '@angular/common';

import { AuthService } from '../modules/auth/services/auth.service';
import { OrganizationService } from '../modules/organization/services/organization.service';
import { orgMonogram, orgRoleLabel } from '../modules/organization/organization.util';
import { EntitlementsService } from '../../common/entitlements/entitlements.service';
import { ToolsService } from '../modules/tools/services/tools.service';

interface NavItem {
  readonly label: string;
  /** PrimeIcons class, e.g. `pi pi-box`. */
  readonly icon: string;
  /** Absent path means the destination is not built yet; the item renders disabled. */
  readonly path?: string;
  /**
   * Second key of the `N`-leader create chord for this surface, if any. Must match a
   * key in {@link NEW_SHORTCUTS}; surfaced as a hover tooltip (e.g. `verb · N then P`).
   */
  readonly newShortcut?: { readonly key: string; readonly verb: string };
}

interface NavSection {
  /** Caption shown above the group; named by domain, not by chore. */
  readonly label: string;
  readonly items: readonly NavItem[];
}

/** A single ancestor link shown before the page title, e.g. `Tools › Scan Receipt`. */
interface Breadcrumb {
  readonly label: string;
  readonly path: string;
}

interface RouteMeta {
  readonly url: string;
  readonly title: string;
  readonly breadcrumb: Breadcrumb | null;
}

/** How long after pressing `N` the second key is still accepted as a chord. */
const LEADER_TIMEOUT_MS = 1500;

/**
 * `N` then one of these keys opens that surface's create flow (via `?new=1`).
 * Extend by adding an entry, e.g. `m: { path: '/stock-movements' }`.
 */
const NEW_SHORTCUTS: Record<string, { readonly path: string }> = {
  p: { path: '/products' },
  a: { path: '/inventory-audit' },
};

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, MenuModule, Tooltip],
  templateUrl: './layout.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closeMobile()',
    '(document:keydown)': 'onGlobalKeydown($event)',
  },
})
export class Layout {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly organizationService = inject(OrganizationService);
  private readonly entitlements = inject(EntitlementsService);
  private readonly tools = inject(ToolsService);
  private readonly destroyRef = inject(DestroyRef);

  /** Paths that belong to the POS module — hidden for BASIC (Inventory-only) tenants. */
  private static readonly POS_PATHS = new Set(['pos', 'sales', 'reports']);

  /**
   * The rail holds only the work an operator repeats through the day. Occasional jobs (Tools) and
   * chrome (Settings) live in the header instead — that is what keeps this list short enough to
   * fit a laptop screen without scrolling. Resist adding to it.
   */
  private static readonly ALL_SECTIONS: readonly NavSection[] = [
    {
      label: 'Overview',
      items: [{ label: 'Dashboard', icon: 'pi pi-home', path: 'dashboard' }],
    },
    {
      label: 'Operations',
      items: [
        { label: 'Point of Sale', icon: 'pi pi-shopping-cart', path: 'pos' },
        { label: 'Sales', icon: 'pi pi-chart-line', path: 'sales' },
        { label: 'Sales Report', icon: 'pi pi-chart-bar', path: 'reports' },
        {
          label: 'Inventory Audit',
          icon: 'pi pi-check-square',
          path: 'inventory-audit',
          newShortcut: { key: 'a', verb: 'New audit' },
        },
        { label: 'Stock Movements', icon: 'pi pi-arrows-v', path: 'stock-movements' },
      ],
    },
    {
      label: 'Catalog',
      items: [
        {
          label: 'Products',
          icon: 'pi pi-box',
          path: 'products',
          newShortcut: { key: 'p', verb: 'New product' },
        },
        { label: 'Categories', icon: 'pi pi-th-large', path: 'categories' },
        { label: 'Locations', icon: 'pi pi-map-marker', path: 'locations' },
        { label: 'Suppliers', icon: 'pi pi-truck', path: 'suppliers' },
        { label: 'Movement Types', icon: 'pi pi-tags', path: 'stock-movement-types' },
      ],
    },
    {
      label: 'Finance',
      items: [{ label: 'Expenses', icon: 'pi pi-wallet', path: 'expenses' }],
    },
  ];

  // POS items (Point of Sale, Sales, Sales Report) only show on plans that include the module.
  // Sections left empty by the filter are dropped so no orphan caption renders.
  protected readonly navSections = computed<readonly NavSection[]>(() => {
    const canUsePos = this.entitlements.canUsePos();
    return Layout.ALL_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.path || canUsePos || !Layout.POS_PATHS.has(item.path),
      ),
    })).filter((section) => section.items.length > 0);
  });

  /** Leader-chord state: true while waiting for the second key after `N`. */
  protected readonly leader = signal(false);
  private leaderTimer: ReturnType<typeof setTimeout> | null = null;

  /** Desktop rail collapse. */
  protected readonly collapsed = signal(false);
  /** Off-canvas drawer on narrow screens. */
  protected readonly mobileOpen = signal(false);
  private readonly isDesktop = signal(true);
  /** Mirrors the account menu's open state onto the trigger's `aria-expanded`. */
  protected readonly accountMenuOpen = signal(false);

  /**
   * Page identity, read off the resolved route rather than the nav model: Tools and Settings no
   * longer appear in the rail, so the rail can no longer name every page.
   */
  private readonly routeMeta = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.readRouteMeta()),
    ),
    { initialValue: this.readRouteMeta() },
  );

  private readonly currentUrl = computed(() => this.routeMeta().url);
  protected readonly pageTitle = computed(() => this.routeMeta().title);
  protected readonly breadcrumb = computed(() => this.routeMeta().breadcrumb);

  /** Walks the activated tree; the deepest route that declares a value wins. */
  private readRouteMeta(): RouteMeta {
    let snapshot: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    let title: string | undefined;
    let breadcrumb: Breadcrumb | undefined;
    while (snapshot) {
      title = snapshot.title ?? title;
      breadcrumb = (snapshot.data['breadcrumb'] as Breadcrumb | undefined) ?? breadcrumb;
      snapshot = snapshot.firstChild;
    }
    return { url: this.router.url, title: title ?? 'AssetWise', breadcrumb: breadcrumb ?? null };
  }

  /** Header chrome. Tools hides entirely when the user's plan and role unlock none of them. */
  protected readonly showTools = this.tools.hasAny;
  protected readonly toolsActive = computed(() => this.startsWith('/tools'));
  protected readonly settingsActive = computed(() => this.startsWith('/settings'));

  private readonly organization = this.organizationService.organization;

  /** Tenant identity for the sidebar; falls back to the product mark when absent. */
  protected readonly orgName = computed(() => this.organization()?.name?.trim() || null);
  protected readonly orgLogo = computed(() => this.organization()?.logo?.trim() || null);
  protected readonly orgMonogram = computed(() => orgMonogram(this.organization()?.name));

  private readonly user = this.authService.user;

  protected readonly displayName = computed(() => {
    const user = this.user();
    if (!user) {
      return 'Account';
    }
    return user.name?.trim() || user.email;
  });

  /** Second line of the account menu — omitted when the name already *is* the email. */
  protected readonly email = computed(() => {
    const user = this.user();
    return user?.name?.trim() ? user.email : null;
  });

  /** The user's role *in this shop* (Owner / Admin / Member), not the platform-level auth role. */
  protected readonly roleLabel = computed(() => orgRoleLabel(this.organizationService.myRole()));

  protected readonly initials = computed(() => {
    const user = this.user();
    if (!user) {
      return '·';
    }
    const parts = (user.name?.trim() || user.email).split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? user.email[0];
    const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return `${first}${second}`.toUpperCase();
  });

  protected readonly userMenuItems: MenuItem[] = [
    { label: 'Sign out', icon: 'pi pi-sign-out', command: () => this.logout() },
  ];

  protected readonly asideClasses = computed(() => {
    const base =
      'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-panel ' +
      'transition-transform duration-200 ease-out motion-reduce:transition-none ' +
      'lg:static lg:z-auto lg:translate-x-0';
    const drawer = this.mobileOpen() ? 'translate-x-0' : '-translate-x-full lg:translate-x-0';
    const width = this.collapsed() ? 'lg:w-[4.75rem]' : 'lg:w-60';
    return `${base} ${drawer} ${width}`;
  });

  constructor() {
    afterNextRender(() => {
      const query = window.matchMedia('(min-width: 1024px)');
      const sync = () => {
        this.isDesktop.set(query.matches);
        if (query.matches) {
          this.mobileOpen.set(false);
        }
      };
      sync();
      query.addEventListener('change', sync);
      this.destroyRef.onDestroy(() => query.removeEventListener('change', sync));
    });

    this.destroyRef.onDestroy(() => {
      if (this.leaderTimer) {
        clearTimeout(this.leaderTimer);
      }
    });
  }

  protected toggleNav(): void {
    if (this.isDesktop()) {
      this.collapsed.update((value) => !value);
    } else {
      this.mobileOpen.update((value) => !value);
    }
  }

  protected closeMobile(): void {
    this.mobileOpen.set(false);
  }

  /**
   * App-wide "new" leader chord: press `N`, then an entity key (`P` product,
   * `A` audit). Suppressed while typing in a field or while a scanner streams into
   * an input, and ignored when a modifier is held so browser shortcuts still work.
   */
  protected onGlobalKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (this.isEditableTarget(event.target)) {
      this.clearLeader();
      return;
    }

    const key = event.key.toLowerCase();

    if (this.leader()) {
      const destination = NEW_SHORTCUTS[key];
      this.clearLeader();
      if (destination) {
        event.preventDefault();
        this.closeMobile();
        void this.router.navigate([destination.path], { queryParams: { new: 1 } });
      }
      return;
    }

    if (key === 'n') {
      this.leader.set(true);
      if (this.leaderTimer) {
        clearTimeout(this.leaderTimer);
      }
      this.leaderTimer = setTimeout(() => this.leader.set(false), LEADER_TIMEOUT_MS);
    }
  }

  private clearLeader(): void {
    if (this.leaderTimer) {
      clearTimeout(this.leaderTimer);
      this.leaderTimer = null;
    }
    if (this.leader()) {
      this.leader.set(false);
    }
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target.isContentEditable ||
      target.closest('[contenteditable="true"]') !== null
    );
  }

  protected isActive(item: NavItem): boolean {
    return item.path !== undefined && this.startsWith(`/${item.path}`);
  }

  protected navLinkClasses(active: boolean): string {
    const base =
      'group flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium outline-none ' +
      'transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-signal ' +
      'focus-visible:ring-offset-2 focus-visible:ring-offset-panel';
    const state = active ? 'bg-signal/10 text-ink' : 'text-muted hover:bg-line/60 hover:text-ink';
    const rail = this.collapsed() ? 'lg:justify-center lg:px-0' : '';
    return `${base} ${state} ${rail}`;
  }

  protected disabledItemClasses(): string {
    const base =
      'flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium text-muted/60';
    const rail = this.collapsed() ? 'lg:justify-center lg:px-0' : '';
    return `${base} ${rail}`;
  }

  /** Square icon control in the header: nav toggle, Tools, Settings. One shape, one state set. */
  protected chromeButtonClasses(active = false): string {
    const base =
      'grid h-9 w-9 shrink-0 place-items-center rounded-md outline-none transition-colors ' +
      'motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-signal ' +
      'focus-visible:ring-offset-2 focus-visible:ring-offset-counter';
    const state = active ? 'bg-signal/10 text-signal' : 'text-muted hover:bg-line/60 hover:text-ink';
    return `${base} ${state}`;
  }

  protected labelClasses(): string {
    return this.collapsed() ? 'lg:hidden' : '';
  }

  /**
   * Hover tooltip text. Expanded rail teaches the create chord on shortcut-bearing
   * items (`verb · N then P`); the collapsed icon-only rail also names the item.
   * Empty string disables the tooltip (PrimeNG renders nothing).
   */
  protected tooltipFor(item: NavItem): string {
    const shortcut = item.newShortcut;
    const chord = shortcut ? `N then ${shortcut.key.toUpperCase()}` : '';
    if (this.collapsed()) {
      return shortcut ? `${item.label} · ${chord}` : item.label;
    }
    return shortcut ? `${shortcut.verb} · ${chord}` : '';
  }

  /**
   * Section captions stay in the accessibility tree when the rail collapses
   * (sr-only, not hidden) so each group keeps its `aria-labelledby` name.
   */
  protected sectionCaptionClasses(): string {
    return this.collapsed() ? 'lg:sr-only' : '';
  }

  private logout(): void {
    this.authService.logout().subscribe(() => void this.router.navigateByUrl('/auth/login'));
  }

  /** Path-prefix match that ignores the query string and fragment. */
  private startsWith(path: string): boolean {
    const url = this.currentUrl().split('?')[0].split('#')[0];
    return url === path || url.startsWith(`${path}/`);
  }
}
