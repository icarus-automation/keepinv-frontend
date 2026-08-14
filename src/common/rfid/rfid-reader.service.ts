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

/** Long enough for the module's parameter block to come back before it is modified and rewritten. */
const PARAM_READ_MS = 400;

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
  /**
   * Whether the module says its antenna is switched on, read back after connect. `false` fully
   * explains an inventory that runs and reports nothing. Null until the reader answers.
   */
  readonly antennaEnabled = signal<boolean | null>(null);
  /** Per-port power the module reports, which need not match what SET_POWER asked for. */
  readonly antennaPowers = signal<readonly number[]>([]);
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
    const near = task === 'commission';
    this.beginSession();
    // Range comes from the power preset, not from the RSSI gate: cutting power physically stops
    // distant tags from answering at all, whereas the gate throws away reads the radio did make.
    // Leaving the gate off by default means a mis-set threshold can never look like dead hardware.
    this.setNearFieldOnly(false);
    await this.setReadMode('rfid');
    await this.applyPreset(near ? 'near' : 'room');
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

    await this.stopSweep();
    await sleep(STOP_SETTLE_MS);

    await this.send(protocol.setOutputMode('transparent'));
    await this.send(protocol.setReadMode(this.readMode()));
    await sleep(MODE_SETTLE_MS);

    // Read the module's own parameter block, switch the antenna on and set the power inside it,
    // then write the whole thing back. Every other field is preserved exactly as reported, so this
    // repairs the radio without disturbing region, Q, or session.
    await this.send(protocol.getAllParams());
    await sleep(PARAM_READ_MS);

    const current = this.params();
    if (current) {
      await this.send(
        protocol.setAllParams(current.raw, {
          antenna: current.antenna === 0 ? 0x01 : current.antenna,
          powerDbm: this.powerDbm(),
        }),
      );
      await sleep(MODE_SETTLE_MS);
    }

    this.appliedPowerDbm = null;
    await this.setPower(this.powerDbm());
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

    // Order and timing both matter here.
    //
    // 0. STOP first. The module keeps running whatever inventory it was left in — across app
    //    reloads and reconnects — and a busy module ignores configuration commands while flooding
    //    the link with "idle" reports. That is what made a read-back of the output mode go
    //    unanswered: the query was never processed, not answered wrongly.
    // 1. Transparent output: in Bluetooth-keyboard (HID) mode the reader types its reads as
    //    keystrokes and sends nothing over GATT.
    // 2. RFID front end, then WAIT. The manual is explicit that a read-mode switch restarts the
    //    module and needs ~1s "to completely start". Commands sent inside that window are lost —
    //    which previously swallowed the power setting and left the radio at its default.
    // 3. Only then set power, which the manual requires before any tag operation.
    await this.send(protocol.stopInventory());
    await sleep(STOP_SETTLE_MS);
    this.sweeping.set(false);

    await this.send(protocol.setOutputMode('transparent'));
    await this.send(protocol.setReadMode('rfid'));
    this.readMode.set('rfid');
    await sleep(MODE_SETTLE_MS);

    this.appliedPowerDbm = null;
    await this.setPower(this.powerDbm());

    // Read the module's real configuration and, if the antenna is not selected or the power does
    // not match, write the block back with those corrected. GET_ALL_PARAM is the only read this
    // reader answers reliably — it rejects GET_OUTPUT_MODE with a module error and ignores the
    // standalone antenna command entirely, so neither is worth sending.
    await this.send(protocol.getReadMode());
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

      case 'antenna':
        this.antennaEnabled.set(report.enabled);
        this.antennaPowers.set(report.powers);
        return;

      case 'params':
        this.params.set(report);
        // The module's own view of its antenna and power wins over anything a bare SET_POWER
        // acknowledged: this is the block the radio actually runs on.
        this.antennaEnabled.set(report.antenna !== 0);
        this.antennaPowers.set([report.powerDbm]);
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
    this.antennaEnabled.set(null);
    this.antennaPowers.set([]);
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
