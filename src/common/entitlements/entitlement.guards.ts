import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { EntitlementsService } from './entitlements.service';
import { OrganizationService } from '../../app/modules/organization/services/organization.service';

/** Blocks POS-module routes (pos/sales/reports) for plans without POS (BASIC). Redirects home. */
export const posGuard: CanActivateFn = () => {
  const entitlements = inject(EntitlementsService);
  const router = inject(Router);
  return entitlements.canUsePos() ? true : router.parseUrl('/');
};

/** Blocks PRO-only routes (the barcode catalog sheet) for BASIC tenants. Redirects home. */
export const proGuard: CanActivateFn = () => {
  const entitlements = inject(EntitlementsService);
  const router = inject(Router);
  return entitlements.isPro() ? true : router.parseUrl('/');
};

/**
 * Blocks /scan-receipt unless the plan includes receipt scanning AND the user is an org
 * owner/admin (the backend enforces both). BASIC managers reach the feature through the
 * sidebar upgrade dialog instead, so a direct URL just goes home.
 */
export const receiptScanGuard: CanActivateFn = () => {
  const entitlements = inject(EntitlementsService);
  const organization = inject(OrganizationService);
  const router = inject(Router);
  return entitlements.canScanReceipts() && organization.canManage() ? true : router.parseUrl('/');
};

/** Sends a locked tenant (expired trial / deactivated org) to the lock screen. */
export const accessGuard: CanActivateFn = () => {
  const entitlements = inject(EntitlementsService);
  const router = inject(Router);
  return entitlements.locked() ? router.parseUrl('/locked') : true;
};

/** The lock screen is only reachable while actually locked; otherwise bounce home. */
export const lockedGuard: CanActivateFn = () => {
  const entitlements = inject(EntitlementsService);
  const router = inject(Router);
  return entitlements.locked() ? true : router.parseUrl('/');
};
