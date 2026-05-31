import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthUser, LoginRequest, LoginResponse } from '../models/auth.model';

const TOKEN_STORAGE_KEY = 'access_token';
const USER_STORAGE_KEY = 'auth_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly loginUrl = `${environment.apiBaseUrl}/auth/login`;

  private readonly currentUser = signal<AuthUser | null>(this.restoreUser());
  readonly user = this.currentUser.asReadonly();

  login(credentials: LoginRequest): Observable<AuthUser> {
    return this.http.post<LoginResponse>(this.loginUrl, credentials).pipe(
      map((response) => response.data),
      tap((user) => this.persistSession(user)),
    );
  }

  logout(): void {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    this.currentUser.set(null);
  }

  isAuthenticated(): boolean {
    return this.token !== null;
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  }

  private persistSession(user: AuthUser): void {
    localStorage.setItem(TOKEN_STORAGE_KEY, user.accessToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }

  private restoreUser(): AuthUser | null {
    const stored = localStorage.getItem(USER_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as AuthUser;
    } catch {
      localStorage.removeItem(USER_STORAGE_KEY);
      return null;
    }
  }
}
