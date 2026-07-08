import { Routes } from '@angular/router';

import { proGuard, receiptScanGuard } from '../../../common/entitlements/entitlement.guards';

/** Rendered by the shell header as `Tools › <page>` on every tool, since tools left the sidebar. */
const TOOLS_CRUMB = { label: 'Tools', path: '/tools' } as const;

/**
 * Lazy child routes for `/tools`. The index lists what the signed-in user can reach; each tool
 * keeps the guard it had as a top-level route, so a direct URL is still refused the same way.
 */
export const TOOLS_ROUTES: Routes = [
  {
    path: '',
    title: 'Tools',
    loadComponent: () => import('./tools').then((m) => m.Tools),
  },
  {
    path: 'scan-receipt',
    title: 'Scan Receipt',
    data: { breadcrumb: TOOLS_CRUMB },
    canActivate: [receiptScanGuard],
    loadComponent: () => import('./scan-receipt/scan-receipt').then((m) => m.ScanReceipt),
  },
  {
    path: 'barcode-sheet',
    title: 'Barcode Sheet',
    data: { breadcrumb: TOOLS_CRUMB },
    canActivate: [proGuard],
    loadComponent: () => import('./barcode-sheet/barcode-sheet').then((m) => m.BarcodeSheet),
  },
];
