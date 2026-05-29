import { Routes } from '@angular/router';

import { authGuard } from './modules/auth/guards/auth.guard';
import { guestGuard } from './modules/auth/guards/guest.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'categories',
    pathMatch: 'full'
  },
  {
    path: 'auth/login',
    canActivate: [guestGuard],
    loadComponent: () => import('./modules/auth/login/login').then(m => m.Login)
  },
  {
    path: 'categories',
    canActivate: [authGuard],
    children: [
      { path: '', loadComponent: () => import('./modules/categories/categories').then(m => m.Categories) }
    ]
  },
];
