import { Routes } from '@angular/router';

import { authGuard } from './modules/auth/guards/auth.guard';
import { guestGuard } from './modules/auth/guards/guest.guard';
import {
  accessGuard,
  lockedGuard,
  posGuard,
  proGuard,
} from '../common/entitlements/entitlement.guards';

export const routes: Routes = [
  {
    path: 'auth/login',
    canActivate: [guestGuard],
    loadComponent: () => import('./modules/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'locked',
    canActivate: [authGuard, lockedGuard],
    loadComponent: () => import('./modules/locked/locked').then((m) => m.Locked),
  },
  {
    path: '',
    canActivate: [authGuard, accessGuard],
    loadComponent: () => import('./layout/layout').then((m) => m.Layout),
    children: [
      { path: '', redirectTo: 'categories', pathMatch: 'full' },
      {
        path: 'pos',
        canActivate: [posGuard],
        loadComponent: () => import('./modules/pos/pos').then((m) => m.Pos),
      },
      {
        path: 'sales',
        canActivate: [posGuard],
        loadComponent: () => import('./modules/pos/sales').then((m) => m.Sales),
      },
      {
        path: 'reports',
        canActivate: [posGuard],
        loadComponent: () => import('./modules/pos/report/sales-report').then((m) => m.SalesReport),
      },
      {
        path: 'categories',
        loadComponent: () => import('./modules/categories/categories').then((m) => m.Categories),
      },
      {
        path: 'suppliers',
        loadComponent: () => import('./modules/suppliers/suppliers').then((m) => m.Suppliers),
      },
      {
        path: 'locations',
        loadComponent: () => import('./modules/locations/locations').then((m) => m.Locations),
      },
      {
        path: 'products',
        loadComponent: () => import('./modules/products/products').then((m) => m.Products),
      },
      {
        path: 'barcode-sheet',
        canActivate: [proGuard],
        loadComponent: () =>
          import('./modules/catalog-sheet/catalog-sheet').then((m) => m.CatalogSheet),
      },
      {
        path: 'stock-movements',
        loadComponent: () =>
          import('./modules/stock-movements/stock-movements').then((m) => m.StockMovements),
      },
      {
        path: 'settings',
        loadComponent: () => import('./modules/settings/settings').then((m) => m.Settings),
      },
      {
        path: 'inventory-audit',
        loadComponent: () =>
          import('./modules/inventory-audit/inventory-audit').then((m) => m.InventoryAudit),
      },
    ],
  },
];
