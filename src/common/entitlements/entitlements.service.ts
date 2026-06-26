import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';

import { environment } from '../../environments/environment';
import { ApiResponse } from '../responses/api.response';

export type OrgPlan = 'BASIC' | 'PRO';
export type PrinterType = 'NONE' | 'NIIMBOT';

/**
 * Plan-driven capabilities, mirrored from the backend GET /entitlements response.
 * The plan selects MODULES: BASIC = Inventory only, PRO = POS + Inventory. RFID and barcode are on
 * both plans; label printing depends on the tenant's configured printer, not the plan.
 */
export interface Entitlements {
  plan: OrgPlan;
  printerType: PrinterType;
  trialEndsAt: string | null;
  trialActive: boolean;
  trialExpired: boolean;
  locked: boolean;
  features: {
    inventory: boolean;
    pos: boolean;
    rfid: boolean;
    labelPrinting: boolean;
  };
}

/**
 * Safe fallback used before hydration and whenever the call fails. Note the deliberate split:
 * paid features fail CLOSED (pos hidden), but `locked` fails OPEN — a network blip must never lock
 * out a paying tenant. RFID/inventory are baseline (both plans) so they stay available.
 */
const FALLBACK: Entitlements = {
  plan: 'BASIC',
  printerType: 'NONE',
  trialEndsAt: null,
  trialActive: false,
  trialExpired: false,
  locked: false,
  features: { inventory: true, pos: false, rfid: true, labelPrinting: false },
};

/**
 * The signed-in tenant's plan entitlements. Source of truth is the backend; this service hydrates
 * once at app start (and on login) and mirrors the result into signals the UI gates on.
 */
@Injectable({ providedIn: 'root' })
export class EntitlementsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/entitlements`;

  private readonly state = signal<Entitlements>(FALLBACK);
  readonly entitlements = this.state.asReadonly();

  readonly plan = computed(() => this.state().plan);
  /** PRO-tier tenant: gates PRO-only surfaces such as the barcode catalog sheet. */
  readonly isPro = computed(() => this.state().plan === 'PRO');
  readonly printerType = computed(() => this.state().printerType);
  readonly canUsePos = computed(() => this.state().features.pos);
  readonly canPrintLabels = computed(() => this.state().features.labelPrinting);
  readonly locked = computed(() => this.state().locked);
  readonly trialActive = computed(() => this.state().trialActive);
  readonly trialEndsAt = computed(() => this.state().trialEndsAt);

  /** Hydrates entitlements for the active org. Never throws; resolves to FALLBACK on failure. */
  load(): Observable<Entitlements> {
    return this.http.get<ApiResponse<Entitlements>>(this.url).pipe(
      map((response) => response.data),
      catchError(() => of(FALLBACK)),
      tap((entitlements) => this.state.set(entitlements)),
    );
  }

  /** Clears entitlements back to the fallback default (used on sign-out). */
  reset(): void {
    this.state.set(FALLBACK);
  }
}
