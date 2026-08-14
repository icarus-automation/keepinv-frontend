import { TestBed } from '@angular/core/testing';

import { ReaderCapture, RfidReaderService } from './rfid-reader.service';
import type { ReaderReport } from './h103-protocol';

/**
 * Reach the private report handler. These are the two guarantees both capture surfaces rely on —
 * that a continuous sweep does not re-offer the same tag, and that the near-field gate actually
 * filters — and neither is reachable without a physical reader in the loop.
 */
function feed(service: RfidReaderService, report: ReaderReport): void {
  (service as unknown as { receive(report: ReaderReport): void }).receive(report);
}

function tag(epc: string, rssi = -35): ReaderReport {
  return { kind: 'tag', epc, rssi, antenna: 1, channel: 0 };
}

describe('RfidReaderService capture stream', () => {
  let service: RfidReaderService;
  let captured: ReaderCapture[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RfidReaderService);
    captured = [];
    service.captures.subscribe((capture) => captured.push(capture));
  });

  it('offers a tag once however many times the sweep re-reads it', () => {
    // A continuous inventory reports every tag still in the field, several times a second.
    feed(service, tag('E2801160000A'));
    feed(service, tag('E2801160000A'));
    feed(service, tag('E2801160000A'));

    expect(captured.map((capture) => capture.value)).toEqual(['E2801160000A']);
    expect(service.tagCount()).toBe(1);
  });

  it('offers distinct tags separately', () => {
    feed(service, tag('AAAA'));
    feed(service, tag('BBBB'));

    expect(captured.map((capture) => capture.value)).toEqual(['AAAA', 'BBBB']);
    expect(service.tagCount()).toBe(2);
  });

  it('offers a tag again after a new capture session begins', () => {
    feed(service, tag('AAAA'));
    service.beginSession();
    feed(service, tag('AAAA'));

    expect(captured).toHaveLength(2);
    expect(service.tagCount()).toBe(1);
  });

  it('does not dedupe barcodes: a second deliberate scan must still register', () => {
    feed(service, { kind: 'barcode', value: '4801234567890' });
    feed(service, { kind: 'barcode', value: '4801234567890' });

    expect(captured).toHaveLength(2);
    expect(captured[0].source).toBe('barcode');
    expect(captured[0].rssi).toBeNull();
  });

  it('drops distant tags while near-field capture is on, and keeps close ones', () => {
    service.setNearFieldOnly(true);
    feed(service, tag('FAR', -70));
    feed(service, tag('NEAR', -35));

    expect(captured.map((capture) => capture.value)).toEqual(['NEAR']);
  });

  it('keeps distant tags once the gate is off', () => {
    service.setNearFieldOnly(false);
    feed(service, tag('FAR', -70));

    expect(captured.map((capture) => capture.value)).toEqual(['FAR']);
  });

  it('tracks the trigger without cancelling a sweep the app started', () => {
    feed(service, { kind: 'trigger', pressed: true });
    expect(service.triggerHeld()).toBe(true);
    expect(service.sweeping()).toBe(true);

    feed(service, { kind: 'trigger', pressed: false });
    expect(service.triggerHeld()).toBe(false);
    expect(service.sweeping()).toBe(false);
  });

  it('reads battery reports', () => {
    feed(service, { kind: 'battery', percent: 84 });
    expect(service.battery()).toBe(84);
  });

  it('ignores idle heartbeats', () => {
    feed(service, { kind: 'idle' });
    expect(captured).toHaveLength(0);
  });
});
