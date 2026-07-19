import { Routes } from '@angular/router';

import { authGuard } from './modules/auth/guards/auth.guard';
import { guestGuard } from './modules/auth/guards/guest.guard';
import { accessGuard, adminGuard, lockedGuard, posGuard } from '../common/entitlements/entitlement.guards';

/**
 * Every authenticated route carries a `title`: it names the page in the shell header (see
 * `Layout.pageTitle`) and, through `AppTitleStrategy`, in the browser tab. Tools live under
 * `/tools` as lazy children; the two paths they used to occupy redirect so old bookmarks survive.
 */
export const routes: Routes = [
  {
    path: 'auth/login',
    title: 'Sign in',
    canActivate: [guestGuard],
    loadComponent: () => import('./modules/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'locked',
    title: 'Account locked',
    canActivate: [authGuard, lockedGuard],
    loadComponent: () => import('./modules/locked/locked').then((m) => m.Locked),
  },
  {
    path: '',
    canActivate: [authGuard, accessGuard],
    loadComponent: () => import('./layout/layout').then((m) => m.Layout),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

      // Legacy top-level tool URLs, kept working after the move under /tools.
      { path: 'barcode-sheet', pathMatch: 'full', redirectTo: 'tools/barcode-sheet' },
      { path: 'scan-receipt', pathMatch: 'full', redirectTo: 'tools/scan-receipt' },

      {
        path: 'dashboard',
        title: 'Dashboard',
        canActivate: [adminGuard],
        loadComponent: () => import('./modules/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'pos',
        title: 'Point of Sale',
        canActivate: [posGuard],
        loadComponent: () => import('./modules/pos/pos').then((m) => m.Pos),
      },
      {
        path: 'sales',
        title: 'Sales',
        canActivate: [posGuard],
        loadComponent: () => import('./modules/pos/sales').then((m) => m.Sales),
      },
      {
        path: 'reports',
        title: 'Sales Report',
        canActivate: [posGuard, adminGuard],
        loadComponent: () => import('./modules/pos/report/sales-report').then((m) => m.SalesReport),
      },
      {
        path: 'expenses',
        title: 'Expenses',
        canActivate: [adminGuard],
        loadComponent: () => import('./modules/expenses/expenses').then((m) => m.Expenses),
      },
      {
        path: 'categories',
        title: 'Categories',
        canActivate: [adminGuard],
        loadComponent: () => import('./modules/categories/categories').then((m) => m.Categories),
      },
      {
        path: 'suppliers',
        title: 'Suppliers',
        canActivate: [adminGuard],
        loadComponent: () => import('./modules/suppliers/suppliers').then((m) => m.Suppliers),
      },
      {
        path: 'locations',
        title: 'Locations',
        canActivate: [adminGuard],
        loadComponent: () => import('./modules/locations/locations').then((m) => m.Locations),
      },
      {
        path: 'stock-movement-types',
        title: 'Movement Types',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./modules/stock-movement-types/stock-movement-types').then(
            (m) => m.StockMovementTypes,
          ),
      },
      {
        path: 'products',
        title: 'Menu Items',
        canActivate: [adminGuard],
        loadComponent: () => import('./modules/products/products').then((m) => m.Products),
      },
      {
        path: 'ingredients',
        title: 'Ingredients',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./modules/ingredients/ingredients').then((m) => m.Ingredients),
      },
      {
        path: 'stock-movements',
        title: 'Stock Movements',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./modules/stock-movements/stock-movements').then((m) => m.StockMovements),
      },
      {
        path: 'inventory-audit',
        title: 'Inventory Audit',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./modules/inventory-audit/inventory-audit').then((m) => m.InventoryAudit),
      },
      {
        path: 'tools',
        canActivate: [adminGuard],
        loadChildren: () => import('./modules/tools/tools.routes').then((m) => m.TOOLS_ROUTES),
      },
      {
        path: 'settings',
        title: 'Settings',
        canActivate: [adminGuard],
        loadComponent: () => import('./modules/settings/settings').then((m) => m.Settings),
      },
    ],
  },
];
