import { Injectable, computed, signal } from '@angular/core';
import { Observable, Subject, filter, map } from 'rxjs';

import type { OutputMode, ParamsReport, ReadMode, ReaderReport, SweepPlan } from './h103-protocol';
import type { ReaderError, ReaderErrorKind, WireEntry } from './h103-transport';

type ProtocolModule = typeof import('./h103-protocol');
type TransportModule = typeof import('./h103-transport');

/** Where the link is right now. Drives every reader affordance in the app. */
export type ReaderStatus = 'idle' | 'connecting' | 'ready' | 'error';

/** One captured identifier, whatever front end produced it. */
export interface ReaderCapture {
  readonly value: string;
  readonly source: 'rfid' | 'barcode';
  /** dBm for a tag read, null for a barcode. Nearer the antenna is closer to zero. */
  readonly rssi: number | null;
  readonly at: number;
}

/**
 * Radio power presets, named for the job rather than the number. A sweep and a commissioning
 * session want opposite ends of the range, and getting it wrong is the difference between reading
 * a whole aisle and reading only what is in your hand.
 */
export interface PowerPreset {
  readonly id: PowerPresetId;
  readonly label: string;
  readonly hint: string;
  readonly dbm: number;
}

export type PowerPresetId = 'near' | 'shelf' | 'room';

export const POWER_PRESETS: readonly PowerPreset[] = [
  { id: 'near', label: 'At the antenna', hint: 'Only a tag you are holding', dbm: 10 },
  { id: 'shelf', label: 'Arm’s length', hint: 'One shelf or bin at a time', dbm: 22 },
  { id: 'room', label: 'Full range', hint: 'Sweep a whole aisle', dbm: 30 },
];

/**
 * Tags weaker than this are ignored while near-field capture is on.
 *
 * Deliberately permissive. RSSI varies hugely with tag, antenna, and orientation, and this number
 * has not been calibrated against real hardware — a gate set too tight silently drops every read
 * and looks exactly like a broken reader. Range limiting is done physically by the power preset,
 * which is reliable; this is only a backstop, and it is opt-in rather than automatic.
 */
const NEAR_FIELD_RSSI_FLOOR = -65;

/** Remembered so a reader paired earlier reconnects on load without another chooser prompt. */
const DEVICE_STORAGE_KEY = 'aw:rfid-device';

/** The module needs about a second to restart its front end after a read-mode switch. */
const MODE_SETTLE_MS = 1100;

/** Breathing room after a stop, so the module drains its inventory before being reconfigured. */
const STOP_SETTLE_MS = 250;

/** The vendor's demo waits this long after enabling notifications before its first command. */
const CONNECT_SETTLE_MS = 150;

/** Battery is polled on this cadence while connected; it moves slowly. */
const BATTERY_POLL_MS = 120_000;

/** Frames kept for the diagnostics panel. Enough to see a sweep, bounded so it cannot grow. */
const WIRE_LOG_LIMIT = 60;


/**
 * The app's single connection to a handheld RFID reader.
 *
 * Connect once per shift; the audit and registration sessions both subscribe to the same capture
 * stream. Everything protocol- and Bluetooth-shaped is lazy-loaded on first use, so tenants
 * without a reader never download the driver.
 *
 * The reader is an *addition* to scanning, never a precondition for it: with no reader connected
 * every surface keeps working exactly as before, on barcode, keyboard-wedge, and manual entry.
 */
@Injectable({ providedIn: 'root' })
export class RfidReaderService {
  /** Web Bluetooth is required. Absent on Firefox, Safari, iOS, and any non-secure origin. */
  readonly supported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  readonly status = signal<ReaderStatus>('idle');
  readonly deviceName = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly errorKind = signal<ReaderErrorKind | null>(null);

  /** Charge percentage, or null before the first reading. */
  readonly battery = signal<number | null>(null);
  readonly readMode = signal<ReadMode>('rfid');
  /**
   * What the reader says it does with captured data, read back from the device after connect.
   * `hid` means it is acting as a Bluetooth keyboard and this channel will never see a tag.
   * Null until the reader answers.
   */
  readonly outputMode = signal<OutputMode | null>(null);
  /** The module's full configuration block, once it has answered GET_ALL_PARAM. */
  readonly params = signal<ParamsReport | null>(null);
  readonly powerDbm = signal<number>(POWER_PRESETS[2].dbm);

  /** A sweep is running: started from the app, or by the reader's own trigger. */
  readonly sweeping = signal(false);
  /** The physical trigger is held down right now. */
  readonly triggerHeld = signal(false);
  /** Tags captured since the counter was last reset. Feeds the connection chip's live readout. */
  readonly tagCount = signal(0);
  /** Ignore anything not held right at the antenna. On for commissioning, off for a sweep. */
  readonly nearFieldOnly = signal(false);

  /** Recent frames in both directions, newest last, for the diagnostics panel. */
  readonly wireLog = signal<readonly WireEntry[]>([]);
  readonly corruptFrames = signal(0);

  readonly connected = computed(() => this.status() === 'ready');
  /** True once a reader has been paired on this device, so the chip can offer a quick reconnect. */
  readonly remembered = signal(this.readRememberedName());

  private readonly capture$ = new Subject<ReaderCapture>();
  /** EPCs already offered this capture session; see the dedupe note in {@link receive}. */
  private readonly seenTags = new Set<string>();

  /** Every capture, in order. */
  readonly captures = this.capture$.asObservable();
  /** Tag reads only, already gated by the near-field setting. */
  readonly tags: Observable<ReaderCapture> = this.capture$.pipe(
    filter((capture) => capture.source === 'rfid'),
  );
  /** Barcodes read by the reader's own 2D engine. */
  readonly barcodes: Observable<string> = this.capture$.pipe(
    filter((capture) => capture.source === 'barcode'),
    map((capture) => capture.value),
  );

  private protocolPromise?: Promise<ProtocolModule>;
  private transportPromise?: Promise<TransportModule>;
  private transport?: InstanceType<TransportModule['H103Transport']>;
  private batteryTimer?: ReturnType<typeof setInterval>;
  /** Set while the app itself started a sweep, so a trigger release cannot cancel it. */
  private appDrivenSweep = false;
  /** Power the module has actually been told, so redundant commands are never sent. */
  private appliedPowerDbm: number | null = null;

  /**
   * Warm the lazy driver chunk ahead of the click (call on hover or focus). This keeps the later
   * `connect()` inside the user's gesture, which Chrome requires for the device chooser.
   */
  preload(): void {
    if (this.supported) {
      void this.loadModules();
    }
  }

  /** Open the browser's chooser and pair a reader. Must run directly from a user gesture. */
  async connect(): Promise<void> {
    if (!this.supported) {
      this.fail('unsupported', 'This browser cannot talk to Bluetooth devices. Use Chrome or Edge over https.');
      return;
    }
    if (this.status() === 'connecting' || this.connected()) {
      return;
    }

    this.status.set('connecting');
    this.clearError();

    try {
      const { H103Transport } = await this.loadTransport();
      const transport = new H103Transport();
      const name = await transport.connect(this.handlers());
      await this.adopt(transport, name);
    } catch (error) {
      this.handleConnectError(error);
    }
  }

  /**
   * Silently re-attach to a reader this browser already has permission for. Safe to call on app
   * start: it needs no gesture, and a miss leaves the UI untouched rather than showing an error.
   */
  async reconnectSilently(): Promise<void> {
    const deviceId = this.readRememberedId();
    if (!this.supported || !deviceId || this.connected() || this.status() === 'connecting') {
      return;
    }

    this.status.set('connecting');
    try {
      const { H103Transport } = await this.loadTransport();
      const transport = new H103Transport();
      const name = await transport.reconnectKnown(deviceId, this.handlers());
      if (!name) {
        this.status.set('idle');
        return;
      }
      await this.adopt(transport, name);
    } catch {
      // A silent attempt that fails stays silent; the operator can still connect by hand.
      this.status.set('idle');
    }
  }

  async disconnect(): Promise<void> {
    this.stopBatteryPolling();
    const transport = this.transport;
    this.transport = undefined;
    await transport?.disconnect();
    this.markDisconnected();
  }

  /** Forget the paired reader so the next connect opens the chooser again. */
  async forget(): Promise<void> {
    await this.disconnect();
    try {
      localStorage.removeItem(DEVICE_STORAGE_KEY);
    } catch {
      // Storage blocked; the pairing simply is not remembered past this session.
    }
    this.remembered.set(null);
  }

  // --- Sweeping ------------------------------------------------------------------------------

  /** Start reading tags and keep reading until {@link stopSweep}. */
  async startSweep(plan?: SweepPlan): Promise<void> {
    if (!this.connected()) return;
    const protocol = await this.loadProtocol();
    this.appDrivenSweep = true;
    this.sweeping.set(true);
    await this.send(protocol.startInventory(plan));
  }

  async stopSweep(): Promise<void> {
    this.appDrivenSweep = false;
    this.sweeping.set(false);
    if (!this.connected()) return;
    const protocol = await this.loadProtocol();
    await this.send(protocol.stopInventory());
  }

  async toggleSweep(): Promise<void> {
    return this.sweeping() ? this.stopSweep() : this.startSweep();
  }

  /**
   * Start a fresh capture session: clear the distinct-tag count and, with it, the memory of which
   * tags have already been reported. Call it when a surface opens a new count or batch, so a tag
   * read during the previous one is offered again to this one.
   */
  beginSession(): void {
    this.tagCount.set(0);
    this.seenTags.clear();
  }

  /**
   * Forget one tag, so the next sweep offers it again.
   *
   * The dedupe exists because a continuous inventory re-reports the same tag many times a second.
   * But it makes the reader look broken the moment a surface *discards* a tag it was given: the
   * operator removes a row, sweeps the same tag, and nothing happens. Whoever throws a capture
   * away is responsible for telling the reader it may be offered again.
   */
  forgetTag(value: string): void {
    if (this.seenTags.delete(value)) {
      this.tagCount.update((count) => Math.max(0, count - 1));
    }
  }

  // --- Configuration -------------------------------------------------------------------------

  /**
   * Point the reader's front end at the radio or at the 2D barcode engine. Any running sweep is
   * stopped first: leaving the radio inventorying across a mode switch wedges the module.
   */
  async setReadMode(mode: ReadMode): Promise<void> {
    if (!this.connected() || this.readMode() === mode) return;
    if (this.sweeping()) {
      await this.stopSweep();
    }

    const protocol = await this.loadProtocol();
    await this.send(protocol.setReadMode(mode));
    this.readMode.set(mode);
    await sleep(MODE_SETTLE_MS);
  }

  async setPower(dbm: number): Promise<void> {
    const protocol = await this.loadProtocol();
    const clamped = Math.max(protocol.MIN_POWER_DBM, Math.min(protocol.MAX_POWER_DBM, Math.round(dbm)));
    this.powerDbm.set(clamped);
    if (!this.connected()) {
      return;
    }
    // Never reconfigure mid-sweep. The vendor app refuses the same thing outright, and commands
    // that arrive during an inventory are the likeliest explanation for a module that acknowledges
    // everything and reads nothing.
    if (this.sweeping()) {
      return;
    }
    // Never re-send a power the module already has. Belt-and-braces against the feedback loop that
    // a two-way binding on this value once created: a redundant radio command is pure cost, and at
    // volume it starves the module of the time it needs to actually inventory.
    if (clamped === this.appliedPowerDbm) {
      return;
    }
    this.appliedPowerDbm = clamped;
    await this.send(protocol.setPower(clamped));
  }

  async applyPreset(id: PowerPresetId): Promise<void> {
    const preset = POWER_PRESETS.find((candidate) => candidate.id === id);
    if (preset) {
      await this.setPower(preset.dbm);
    }
  }

  /** The preset the current power matches, or null when it was tuned by hand. */
  readonly activePreset = computed(
    () => POWER_PRESETS.find((preset) => preset.dbm === this.powerDbm())?.id ?? null,
  );

  setNearFieldOnly(enabled: boolean): void {
    this.nearFieldOnly.set(enabled);
  }

  /**
   * Put the reader into the shape a task needs, in one call. Registration commissions tags one at a
   * time in the hand; an audit sweeps a room. Both are best-effort: a reader that is not connected
   * simply keeps its settings for next time.
   *
   * This also starts a fresh capture session, so tags read during the previous count or batch are
   * offered again to this one.
   */
  async prepareFor(task: 'commission' | 'audit'): Promise<void> {
    this.beginSession();
    this.setNearFieldOnly(false);

    // Range comes from the power preset, not from an RSSI gate: cutting power stops distant tags
    // answering at all, whereas a gate discards reads the radio already made. Commissioning wants
    // only what is in your hand; an audit wants the aisle.
    //
    // Only ever while stopped. `setPower` refuses mid-sweep, and reconfiguring a running module is
    // what stranded this integration for a whole evening.
    await this.applyPreset(task === 'commission' ? 'near' : 'room');
  }

  async refreshBattery(): Promise<void> {
    if (!this.connected()) return;
    const protocol = await this.loadProtocol();
    await this.send(protocol.getBattery());
  }

  /**
   * Re-push the whole configuration and read it back. The reader keeps its settings across power
   * cycles, so anything that left it in Bluetooth-keyboard mode or on the barcode front end
   * persists until something puts it back — this is that something, without making the operator
   * open the vendor's Android app.
   */
  async reapplySettings(): Promise<void> {
    if (!this.connected()) return;
    const protocol = await this.loadProtocol();

    // Stop first, always. The vendor app blocks its own configuration screens while an inventory
    // is running ("please stop inventory first"), and the module does appear to drop or mishandle
    // commands that arrive mid-sweep.
    await this.stopSweep();
    await sleep(STOP_SETTLE_MS);

    // Re-derive the radio from the module's own stored parameters. This is the documented reset
    // path and does not impose any settings of ours.
    await this.send(protocol.moduleInit());
    await sleep(MODE_SETTLE_MS);

    // Drop a tag-selection mask left behind by another app; one survives power cycles and filters
    // every inventory down to the tags it matches, often none.
    await this.send(protocol.clearSelectMask());

    // Put the front end back on the radio, in case a barcode session left it on the scan engine.
    await this.send(protocol.setReadMode('rfid'));
    this.readMode.set('rfid');
    await sleep(MODE_SETTLE_MS);

    await this.send(protocol.getAllParams());
    await this.send(protocol.getBattery());
  }

  clearWireLog(): void {
    this.wireLog.set([]);
    this.corruptFrames.set(0);
  }

  // --- Internals -----------------------------------------------------------------------------

  private handlers() {
    return {
      onReport: (report: ReaderReport) => this.receive(report),
      onDisconnect: () => this.markDisconnected(),
      onWire: (entry: WireEntry) => this.logWire(entry),
    };
  }

  /**
   * Bring a freshly attached reader into a known state. Output mode comes first and matters most:
   * a reader left in Bluetooth-keyboard mode connects happily over GATT and then never sends a
   * single tag, which is the hardest failure of all to diagnose from the outside.
   */
  private async adopt(
    transport: InstanceType<TransportModule['H103Transport']>,
    name: string,
  ): Promise<void> {
    this.transport = transport;
    this.deviceName.set(name);
    this.status.set('ready');
    this.clearError();
    this.beginSession();
    this.remember(transport.deviceId, name);

    const protocol = await this.loadProtocol();

    // Deliberately minimal, and it matches the vendor's own demo app almost exactly: enable
    // notifications, pause, read device info, then leave the module alone.
    //
    // An earlier version configured everything here — output mode, read mode, power, the whole
    // parameter block — and the reader answered every one of those commands with "ok" and then
    // inventoried nothing, forever. The working app writes none of them: the module already holds
    // valid settings in flash, and reconfiguring it on every connect is what broke the radio.
    //
    // Configuration now happens only where the vendor puts it: behind an explicit action, with the
    // inventory stopped first. See `reapplySettings`.
    await this.send(protocol.stopInventory());
    this.sweeping.set(false);
    await sleep(CONNECT_SETTLE_MS);

    await this.send(protocol.getDeviceInfo());

    // NOTHING here touches the output mode. Not a write, not even a read.
    //
    // Command 0x0088 is documented by both the manual and the vendor SDK as `0x01 = transparent`,
    // and on this hardware sending it puts the reader into HID — the one state in which it reads
    // tags and sends none of them here. Observed repeatably: a reader restored to Serial by hand
    // works until this app connects, then reports HID again. The documentation is wrong, or the
    // H103 firmware differs from the family the manual covers.
    //
    // The module keeps a correct output mode in flash indefinitely, and the vendor's own app never
    // sets it either. So the safe contract is: we do not manage this setting. See the runbook for
    // how an operator fixes a reader that is genuinely stuck in HID.
    await this.send(protocol.getAllParams());
    await this.send(protocol.getBattery());

    this.startBatteryPolling();
  }

  private receive(report: ReaderReport): void {
    switch (report.kind) {
      case 'tag': {
        if (this.nearFieldOnly() && report.rssi < NEAR_FIELD_RSSI_FLOOR) {
          return;
        }
        // A continuous inventory re-reports every tag still in the field, several times a second.
        // Emitting each repeat would flood consumers and, in the audit, the API behind them — so a
        // tag is offered once per capture session. Barcodes get no such gate: each one is a
        // discrete trigger pull, and a deliberate second scan must still register.
        if (this.seenTags.has(report.epc)) {
          return;
        }
        this.seenTags.add(report.epc);
        this.tagCount.update((count) => count + 1);
        this.capture$.next({
          value: report.epc,
          source: 'rfid',
          rssi: report.rssi,
          at: Date.now(),
        });
        return;
      }

      case 'barcode': {
        if (report.value) {
          this.capture$.next({ value: report.value, source: 'barcode', rssi: null, at: Date.now() });
        }
        return;
      }

      case 'trigger': {
        this.triggerHeld.set(report.pressed);
        // The reader inventories on its own while the trigger is held, so the app reflects that
        // state rather than issuing commands — but it must not cancel a sweep the app itself began.
        if (report.pressed) {
          this.sweeping.set(true);
        } else if (!this.appDrivenSweep) {
          this.sweeping.set(false);
        }
        return;
      }

      case 'battery':
        this.battery.set(report.percent);
        return;

      case 'readMode':
        this.readMode.set(report.mode);
        return;

      case 'outputMode':
        // `hid` here is the smoking gun for "connects fine, never reports a tag": the reader is
        // typing its reads as Bluetooth keystrokes instead of sending them over this channel.
        this.outputMode.set(report.mode);
        return;

      case 'params':
        this.params.set(report);
        return;

      case 'idle':
      case 'other':
        return;
    }
  }

  private async send(frame: Uint8Array): Promise<void> {
    try {
      await this.transport?.write(frame);
    } catch (error) {
      const kind = (error as ReaderError | undefined)?.kind;
      if (kind === 'link') {
        this.markDisconnected();
      }
    }
  }

  /**
   * Append a frame, collapsing consecutive identical ones into a repeat count.
   *
   * A running inventory emits an "idle" report several times a second. Logged one line each, those
   * flush the connect handshake out of a bounded buffer within seconds — which is exactly what hid
   * the evidence during the first hardware session. Collapsing keeps the interesting frames
   * visible however long a sweep runs.
   */
  private logWire(entry: WireEntry): void {
    this.wireLog.update((entries) => {
      const last = entries[entries.length - 1];
      if (last && last.hex === entry.hex && last.direction === entry.direction) {
        const collapsed = { ...last, at: entry.at, repeat: (last.repeat ?? 1) + 1 };
        return [...entries.slice(0, -1), collapsed];
      }
      return [...entries.slice(-(WIRE_LOG_LIMIT - 1)), entry];
    });
  }

  private markDisconnected(): void {
    this.stopBatteryPolling();
    this.transport = undefined;
    this.status.set('idle');
    this.deviceName.set(null);
    this.battery.set(null);
    this.outputMode.set(null);
    this.params.set(null);
    this.appliedPowerDbm = null;
    this.sweeping.set(false);
    this.triggerHeld.set(false);
    this.appDrivenSweep = false;
  }

  private handleConnectError(error: unknown): void {
    const readerError = error as Partial<ReaderError> | undefined;
    const kind = readerError?.kind ?? 'unavailable';
    if (kind === 'cancelled') {
      // The operator closed the chooser. Not a failure worth reporting.
      this.status.set('idle');
      this.clearError();
      return;
    }
    this.fail(kind, readerError?.message ?? 'Could not connect to the reader.');
  }

  private fail(kind: ReaderErrorKind, message: string): void {
    this.errorKind.set(kind);
    this.error.set(message);
    this.status.set('error');
  }

  private clearError(): void {
    this.error.set(null);
    this.errorKind.set(null);
  }

  private startBatteryPolling(): void {
    this.stopBatteryPolling();
    this.batteryTimer = setInterval(() => void this.refreshBattery(), BATTERY_POLL_MS);
  }

  private stopBatteryPolling(): void {
    if (this.batteryTimer) {
      clearInterval(this.batteryTimer);
      this.batteryTimer = undefined;
    }
  }

  private loadModules(): Promise<[ProtocolModule, TransportModule]> {
    return Promise.all([this.loadProtocol(), this.loadTransport()]);
  }

  private loadProtocol(): Promise<ProtocolModule> {
    this.protocolPromise ??= import('./h103-protocol');
    return this.protocolPromise;
  }

  private loadTransport(): Promise<TransportModule> {
    this.transportPromise ??= import('./h103-transport');
    return this.transportPromise;
  }

  private remember(deviceId: string | null, name: string): void {
    if (!deviceId) return;
    try {
      localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ id: deviceId, name }));
      this.remembered.set(name);
    } catch {
      // Storage blocked (private mode, quota): pairing holds for this session only.
    }
  }

  private readRemembered(): { id: string; name: string } | null {
    try {
      const stored = localStorage.getItem(DEVICE_STORAGE_KEY);
      if (!stored) return null;
      const parsed: unknown = JSON.parse(stored);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { id?: unknown }).id === 'string' &&
        typeof (parsed as { name?: unknown }).name === 'string'
      ) {
        return parsed as { id: string; name: string };
      }
    } catch {
      // Unreadable or corrupt: treat as never paired.
    }
    return null;
  }

  private readRememberedId(): string | null {
    return this.readRemembered()?.id ?? null;
  }

  private readRememberedName(): string | null {
    return this.readRemembered()?.name ?? null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
