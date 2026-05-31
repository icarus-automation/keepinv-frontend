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
        path: 'categories',
        loadComponent: () => import('./modules/categories/categories').then((m) => m.Categories),
      },
    ],
  },
];
