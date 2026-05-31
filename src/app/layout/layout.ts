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

import { AuthService } from '../modules/auth/services/auth.service';

interface NavItem {
  readonly label: string;
  /** PrimeIcons class, e.g. `pi pi-box`. */
  readonly icon: string;
  /** Absent path means the destination is not built yet; the item renders disabled. */
  readonly path?: string;
}

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, MenuModule],
  templateUrl: './layout.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closeMobile()' },
})
export class Layout {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly navItems: readonly NavItem[] = [
    { label: 'Point of Sale', icon: 'pi pi-shopping-cart' },
    { label: 'Inventory', icon: 'pi pi-box' },
    { label: 'Categories', icon: 'pi pi-th-large', path: 'categories' },
    { label: 'Suppliers', icon: 'pi pi-truck' },
    { label: 'Sales', icon: 'pi pi-chart-line' },
    { label: 'Settings', icon: 'pi pi-cog' },
  ];

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
    return this.navItems.find((item) => this.matches(item, url))?.label ?? 'asset-wise';
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

  private logout(): void {
    this.authService.logout();
    void this.router.navigateByUrl('/auth/login');
  }

  private matches(item: NavItem, url: string): boolean {
    return item.path !== undefined && url.split('?')[0].split('#')[0].startsWith(`/${item.path}`);
  }
}
