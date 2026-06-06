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
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { Tooltip } from 'primeng/tooltip';

import { AuthService } from '../modules/auth/services/auth.service';

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
  private readonly destroyRef = inject(DestroyRef);

  protected readonly navSections: readonly NavSection[] = [
    {
      label: 'Operations',
      items: [
        { label: 'Point of Sale', icon: 'pi pi-shopping-cart', path: 'pos' },
        { label: 'Sales', icon: 'pi pi-chart-line', path: 'sales' },
        { label: 'Stock Movements', icon: 'pi pi-arrows-v', path: 'stock-movements' },
        {
          label: 'Inventory Audit',
          icon: 'pi pi-check-square',
          path: 'inventory-audit',
          newShortcut: { key: 'a', verb: 'New audit' },
        },
      ],
    },
    {
      label: 'Catalog',
      items: [
        { label: 'Products', icon: 'pi pi-box', path: 'products', newShortcut: { key: 'p', verb: 'New product' } },
        { label: 'Suppliers', icon: 'pi pi-truck', path: 'suppliers' },
        { label: 'Categories', icon: 'pi pi-th-large', path: 'categories' },
        { label: 'Locations', icon: 'pi pi-map-marker', path: 'locations' },
      ],
    },
    {
      label: 'System',
      items: [{ label: 'Settings', icon: 'pi pi-cog' }],
    },
  ];

  /** Leader-chord state: true while waiting for the second key after `N`. */
  protected readonly leader = signal(false);
  private leaderTimer: ReturnType<typeof setTimeout> | null = null;

  /** Desktop rail collapse. */
  protected readonly collapsed = signal(false);
  /** Off-canvas drawer on narrow screens. */
  protected readonly mobileOpen = signal(false);
  private readonly isDesktop = signal(true);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly pageTitle = computed(() => {
    const url = this.currentUrl();
    for (const section of this.navSections) {
      const match = section.items.find((item) => this.matches(item, url));
      if (match) {
        return match.label;
      }
    }
    return 'asset-wise';
  });

  private readonly user = this.authService.user;

  protected readonly displayName = computed(() => {
    const user = this.user();
    if (!user) {
      return 'Account';
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name || user.email;
  });

  protected readonly roleLabel = computed(() => this.user()?.role ?? 'Signed in');

  protected readonly initials = computed(() => {
    const user = this.user();
    if (!user) {
      return '·';
    }
    const first = user.firstName?.trim()?.[0] ?? user.email[0];
    const second = user.lastName?.trim()?.[0] ?? '';
    return `${first}${second}`.toUpperCase();
  });

  protected readonly userMenuItems: MenuItem[] = [
    { label: 'Sign out', command: () => this.logout() },
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
    return this.matches(item, this.currentUrl());
  }

  protected navLinkClasses(active: boolean): string {
    const base =
      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none ' +
      'transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ' +
      'focus-visible:ring-offset-panel';
    const state = active
      ? 'bg-signal/10 text-ink'
      : 'text-muted hover:bg-line/60 hover:text-ink';
    const rail = this.collapsed() ? 'lg:justify-center lg:px-0' : '';
    return `${base} ${state} ${rail}`;
  }

  protected disabledItemClasses(): string {
    const base =
      'flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted/60';
    const rail = this.collapsed() ? 'lg:justify-center lg:px-0' : '';
    return `${base} ${rail}`;
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
    this.authService.logout();
    void this.router.navigateByUrl('/auth/login');
  }

  private matches(item: NavItem, url: string): boolean {
    return item.path !== undefined && url.split('?')[0].split('#')[0].startsWith(`/${item.path}`);
  }
}
