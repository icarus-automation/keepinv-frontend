import { Routes } from '@angular/router';

import { authGuard } from './modules/auth/guards/auth.guard';
import { guestGuard } from './modules/auth/guards/guest.guard';

export const routes: Routes = [
  {
    path: 'auth/login',
    canActivate: [guestGuard],
    loadComponent: () => import('./modules/auth/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/layout').then((m) => m.Layout),
    children: [
      { path: '', redirectTo: 'categories', pathMatch: 'full' },
      {
        path: 'pos',
        loadComponent: () => import('./modules/pos/pos').then((m) => m.Pos),
      },
      {
        path: 'sales',
        loadComponent: () => import('./modules/pos/sales').then((m) => m.Sales),
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
        path: 'stock-movements',
        loadComponent: () =>
          import('./modules/stock-movements/stock-movements').then((m) => m.StockMovements),
      },
      {
        path: 'inventory-audit',
        loadComponent: () =>
          import('./modules/inventory-audit/inventory-audit').then((m) => m.InventoryAudit),
      },
    ],
  },
];
