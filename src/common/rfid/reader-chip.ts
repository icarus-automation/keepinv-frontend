import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { PopoverModule } from 'primeng/popover';
import { SliderModule } from 'primeng/slider';
import { FormsModule } from '@angular/forms';

import { MAX_POWER_DBM, MIN_POWER_DBM } from './h103-protocol';
import { POWER_PRESETS, PowerPresetId, RfidReaderService } from './rfid-reader.service';

/** How the chip reads at a glance. Ordered by urgency: a fault outranks activity. */
type ChipTone = 'fault' | 'live' | 'ready' | 'busy' | 'off';

/**
 * The app's ambient reader status: a quiet chip in the shell header that says whether a handheld
 * reader is paired, awake, and reading, and opens the panel where it is configured.
 *
 * The chip stays green, never amber. Amber is the app's one action signal and belongs to the
 * capture field inside a session; a permanent header indicator that competed with it would break
 * the scarcity the whole palette depends on.
 *
 * Rendered only for tenants whose organization has a reader configured — the parent gates it — so
 * shops without the hardware never see an affordance they cannot use.
 */
@Component({
  selector: 'app-reader-chip',
  imports: [ButtonModule, PopoverModule, SliderModule, FormsModule],
  templateUrl: './reader-chip.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReaderChip {
  protected readonly reader = inject(RfidReaderService);
  protected readonly presets = POWER_PRESETS;
  protected readonly minPower = MIN_POWER_DBM;
  protected readonly maxPower = MAX_POWER_DBM;

  /** The diagnostics disclosure is closed until someone is actually troubleshooting. */
  protected readonly showDiagnostics = signal(false);
  protected readonly panelOpen = signal(false);

  protected readonly tone = computed<ChipTone>(() => {
    if (this.reader.status() === 'error') return 'fault';
    if (this.reader.status() === 'connecting') return 'busy';
    if (!this.reader.connected()) return 'off';
    return this.reader.sweeping() ? 'live' : 'ready';
  });

  /** Short enough for the header at every width; the panel carries the detail. */
  protected readonly label = computed(() => {
    switch (this.tone()) {
      case 'fault':
        return 'Reader problem';
      case 'busy':
        return 'Connecting…';
      case 'live':
        return `Reading · ${this.reader.tagCount()}`;
      case 'ready':
        return this.reader.deviceName() ?? 'Reader ready';
      case 'off':
        return this.reader.remembered() ? 'Reader off' : 'Connect reader';
    }
  });

  /** Spoken state for screen readers, which never see the dot or the colour. */
  protected readonly srLabel = computed(() => {
    const name = this.reader.deviceName() ?? this.reader.remembered() ?? 'RFID reader';
    switch (this.tone()) {
      case 'fault':
        return `RFID reader: problem. ${this.reader.error() ?? ''}`.trim();
      case 'busy':
        return 'RFID reader: connecting';
      case 'live':
        return `RFID reader ${name}: reading, ${this.reader.tagCount()} tags this session`;
      case 'ready':
        return `RFID reader ${name}: connected${batterySuffix(this.reader.battery())}`;
      case 'off':
        return this.reader.remembered()
          ? `RFID reader ${name}: disconnected`
          : 'RFID reader: not connected';
    }
  });

  protected readonly dotClasses = computed(() => {
    switch (this.tone()) {
      case 'fault':
        return 'bg-danger';
      case 'busy':
        return 'bg-muted';
      case 'live':
      case 'ready':
        return 'bg-success';
      case 'off':
        return 'bg-muted/50';
    }
  });

  protected readonly labelClasses = computed(() =>
    this.tone() === 'fault' ? 'text-danger' : this.tone() === 'off' ? 'text-muted' : 'text-ink',
  );

  /** Battery bar fill, 0–1. Null hides the indicator entirely rather than showing a guess. */
  protected readonly batteryFill = computed(() => {
    const percent = this.reader.battery();
    return percent === null ? null : Math.max(0, Math.min(100, percent)) / 100;
  });

  protected readonly batteryLow = computed(() => (this.reader.battery() ?? 100) <= 20);

  /** Fine power control, bound to the slider in diagnostics. */
  protected get powerValue(): number {
    return this.reader.powerDbm();
  }
  protected set powerValue(dbm: number) {
    void this.reader.setPower(dbm);
  }

  protected connect(): void {
    void this.reader.connect();
  }

  protected disconnect(): void {
    void this.reader.disconnect();
  }

  protected forget(): void {
    void this.reader.forget();
  }

  protected choosePreset(id: PowerPresetId): void {
    void this.reader.applyPreset(id);
  }

  protected toggleNearField(): void {
    this.reader.setNearFieldOnly(!this.reader.nearFieldOnly());
  }

  protected setMode(mode: 'rfid' | 'barcode'): void {
    void this.reader.setReadMode(mode);
  }

  protected reapply(): void {
    void this.reader.reapplySettings();
  }

  protected toggleDiagnostics(): void {
    this.showDiagnostics.update((open) => !open);
  }
}

function batterySuffix(percent: number | null): string {
  return percent === null ? '' : `, battery ${percent} percent`;
}
