import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ProUpgradeDialog } from './pro-upgrade-dialog';
import { ToolsService } from './services/tools.service';
import { ToolDefinition } from './types/tool.types';

/**
 * The tools directory. Everything here is occasional work — a supplier delivery, a reprint — so it
 * lives one click off the header rather than holding a permanent slot in the sidebar.
 *
 * Rows the tenant's plan has not unlocked render locked and open {@link ProUpgradeDialog} instead
 * of navigating. Tools the user's role forbids never appear at all; see {@link ToolsService}.
 */
@Component({
  selector: 'app-tools',
  imports: [RouterLink, ProUpgradeDialog],
  templateUrl: './tools.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Tools {
  private readonly toolsService = inject(ToolsService);

  protected readonly listings = this.toolsService.listings;

  protected readonly upgradeOpen = signal(false);

  /**
   * The tool the dialog is pitching. Deliberately *not* cleared on close: the dialog animates out,
   * and blanking the copy mid-transition would flash an empty panel.
   */
  private readonly pitchedTool = signal<ToolDefinition | null>(null);

  protected readonly pitchedName = computed(() => this.pitchedTool()?.label ?? '');
  protected readonly pitchedHeadline = computed(() => this.pitchedTool()?.upgrade?.headline ?? '');
  protected readonly pitchedPitch = computed(() => this.pitchedTool()?.upgrade?.pitch ?? '');

  protected openUpgrade(tool: ToolDefinition): void {
    this.pitchedTool.set(tool);
    this.upgradeOpen.set(true);
  }
}
