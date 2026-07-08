import { Injectable, computed, inject } from '@angular/core';

import { EntitlementsService } from '../../../../common/entitlements/entitlements.service';
import { OrganizationService } from '../../organization/services/organization.service';
import { ToolDefinition, ToolListing } from '../types/tool.types';

const SCAN_RECEIPT: ToolDefinition = {
  id: 'scan-receipt',
  label: 'Scan Receipt',
  icon: 'pi pi-receipt',
  path: '/tools/scan-receipt',
  blurb: 'Photograph a supplier receipt and file every line into stock.',
  upgrade: {
    headline: 'Stop retyping supplier receipts',
    pitch:
      'Photograph the delivery receipt and Scan Receipt reads every line — item, quantity, cost — then files it into stock for you. A forty-line receipt takes about a minute instead of twenty, and the counts come out right the first time.',
  },
};

const BARCODE_SHEET: ToolDefinition = {
  id: 'barcode-sheet',
  label: 'Barcode Sheet',
  icon: 'pi pi-qrcode',
  path: '/tools/barcode-sheet',
  blurb: 'Print an A4 sheet of barcodes to tape beside the till.',
};

/**
 * Which tools the signed-in user sees on `/tools`, and whether their plan unlocks them.
 *
 * Two independent gates, deliberately handled differently:
 * - **Role** (backend-enforced): a tool the user may never use is hidden outright. Scan Receipt is
 *   owner/admin only, so members never see it.
 * - **Plan**: Scan Receipt stays visible to BASIC managers as a `locked` teaser, because it is the
 *   feature most likely to sell an upgrade. Barcode Sheet is simply hidden on BASIC — a teaser for
 *   a printable sheet persuades nobody.
 *
 * The layout reads {@link hasAny} to decide whether the header's Tools button renders at all, so a
 * user with no tools never lands on an empty page.
 */
@Injectable({ providedIn: 'root' })
export class ToolsService {
  private readonly entitlements = inject(EntitlementsService);
  private readonly organization = inject(OrganizationService);

  readonly listings = computed<readonly ToolListing[]>(() => {
    const listings: ToolListing[] = [];

    if (this.organization.canManage()) {
      listings.push({
        tool: SCAN_RECEIPT,
        state: this.entitlements.canScanReceipts() ? 'available' : 'locked',
      });
    }

    if (this.entitlements.isPro()) {
      listings.push({ tool: BARCODE_SHEET, state: 'available' });
    }

    return listings;
  });

  readonly hasAny = computed(() => this.listings().length > 0);
}
