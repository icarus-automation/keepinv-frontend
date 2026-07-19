import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import { AuthService } from '../../auth/services/auth.service';
import {
  CachedOrgIdentity,
  FullOrganization,
  Organization,
  OrgRole,
} from '../types/organization.types';

/** Namespaced localStorage key for the last-known org identity on this device. */
const IDENTITY_STORAGE_KEY = 'aw:org-identity';

/**
 * The signed-in user's organization. Source of truth is the Better Auth session;
 * this service hydrates the active org once at app start and mirrors the result
 * into a signal the shell reads to brand itself. The resolved identity is also
 * cached on the device so the pre-auth sign-in screen can show the org it last
 * belonged to — a fit for fixed counter terminals that always serve one shop.
 */
@Injectable({ providedIn: 'root' })
export class OrganizationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly orgBaseUrl = `${environment.apiBaseUrl}/auth/organization`;

  private readonly activeOrg = signal<FullOrganization | null>(null);
  /** The active organization, or null when signed out or membership-less. */
  readonly organization = this.activeOrg.asReadonly();

  /** Every organization the signed-in user belongs to (Irene owns two stores). */
  private readonly orgList = signal<Organization[]>([]);
  readonly organizations = this.orgList.asReadonly();

  /** True only for a multi-store account: gates the store switcher and the consolidated view. */
  readonly hasMultipleStores = computed(() => this.orgList().length > 1);

  /** The signed-in user's role in the active org, or null (e.g. the platform operator). */
  readonly myRole = computed<OrgRole | null>(() => {
    const org = this.activeOrg();
    const userId = this.auth.user()?.id;
    if (!org || !userId) {
      return null;
    }
    return org.members.find((member) => member.userId === userId)?.role ?? null;
  });

  /** Owners and admins may edit org settings; everyone else gets a read-only view. */
  readonly canManage = computed(() => {
    const role = this.myRole();
    return role === 'owner' || role === 'admin';
  });

  /**
   * Hydrates the active organization from the session cookie. Safe as an app
   * initializer: never throws, resolving to null when signed out or when the
   * account holds no membership.
   */
  loadActiveOrganization(): Observable<FullOrganization | null> {
    return this.http
      .get<FullOrganization | null>(`${this.orgBaseUrl}/get-full-organization`)
      .pipe(
        catchError(() => of(null)),
        tap((org) => {
          this.activeOrg.set(org);
          if (org) {
            this.writeIdentity({ name: org.name, logo: org.logo, slug: org.slug });
          }
        }),
      );
  }

  /**
   * Lists every organization the signed-in user belongs to. Better Auth's own route
   * returns the array directly (no `ApiResponse` envelope). Safe as an app initializer:
   * never throws, resolving to an empty list on failure or when signed out.
   */
  loadOrganizations(): Observable<Organization[]> {
    return this.http.get<Organization[] | null>(`${this.orgBaseUrl}/list`).pipe(
      map((orgs) => orgs ?? []),
      catchError(() => of<Organization[]>([])),
      tap((orgs) => this.orgList.set(orgs)),
    );
  }

  /**
   * Switches the session's active organization, then re-hydrates the full active org so
   * the shell rebrands. Callers reload the current screen's data afterwards (a full
   * reload is simplest and safest for the infrequent store-switch). Owner-facing only;
   * the switcher is hidden for single-store accounts.
   */
  setActiveOrganization(organizationId: string): Observable<FullOrganization | null> {
    return this.http
      .post(`${this.orgBaseUrl}/set-active`, { organizationId })
      .pipe(switchMap(() => this.loadActiveOrganization()));
  }

  /**
   * Renames the active organization. Owner/admin only — the server enforces the
   * `organization:update` permission and rejects others with 403.
   */
  updateName(name: string): Observable<Organization> {
    const org = this.activeOrg();
    const body = { data: { name }, ...(org ? { organizationId: org.id } : {}) };
    return this.http.post<Organization>(`${this.orgBaseUrl}/update`, body).pipe(
      tap((updated) => {
        this.activeOrg.update((current) =>
          current ? { ...current, name: updated.name } : current,
        );
        const snapshot = this.activeOrg();
        if (snapshot) {
          this.writeIdentity({ name: snapshot.name, logo: snapshot.logo, slug: snapshot.slug });
        }
      }),
    );
  }

  /**
   * Uploads (or replaces) the active organization's logo. Goes through this app's own
   * `/organizations/logo` endpoint (Cloudinary-backed, wrapped in the standard `ApiResponse`
   * envelope) — unlike `updateName`, which hits Better Auth's own route directly.
   */
  uploadLogo(file: File): Observable<Organization> {
    const form = new FormData();
    form.append('logo', file);
    return this.http
      .post<ApiResponse<Organization>>(`${environment.apiBaseUrl}/organizations/logo`, form)
      .pipe(
        map((response) => response.data),
        tap((updated) => this.applyLogoPatch(updated)),
      );
  }

  /** Removes the active organization's logo. */
  removeLogo(): Observable<Organization> {
    return this.http
      .delete<ApiResponse<Organization>>(`${environment.apiBaseUrl}/organizations/logo`)
      .pipe(
        map((response) => response.data),
        tap((updated) => this.applyLogoPatch(updated)),
      );
  }

  private applyLogoPatch(updated: Organization): void {
    this.activeOrg.update((current) => (current ? { ...current, logo: updated.logo } : current));
    const snapshot = this.activeOrg();
    if (snapshot) {
      this.writeIdentity({ name: snapshot.name, logo: snapshot.logo, slug: snapshot.slug });
    }
  }

  /**
   * Last-known identity for this device, read synchronously so the sign-in
   * screen (rendered before any session exists) can brand itself immediately.
   */
  readCachedIdentity(): CachedOrgIdentity | null {
    try {
      const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as CachedOrgIdentity;
      return parsed && typeof parsed.name === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  private writeIdentity(identity: CachedOrgIdentity): void {
    try {
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    } catch {
      // Storage blocked (private mode/quota): identity still holds for this session.
    }
  }
}
