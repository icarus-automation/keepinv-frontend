# Handheld RFID reader (CHAFON H103 SE-2D)

How the Bluetooth reader integration works, how to roll it out, and what to check about existing
data before you do.

## What it is

The app talks to the reader directly from the browser over Web Bluetooth — no Android app, no
vendor SDK, no native shell. The protocol is reimplemented in TypeScript from the vendor manual and
verified against the shipped AAR.

| File | What it owns |
| --- | --- |
| `src/common/rfid/h103-protocol.ts` | Frame building, CRC-16, response parsing, EPC/barcode decoding. Pure, no I/O. |
| `src/common/rfid/h103-transport.ts` | Web Bluetooth: device chooser, GATT channel, write queue, notification reassembly. |
| `src/common/rfid/rfid-reader.service.ts` | One app-wide connection. Connection state, capture stream, sweep, mode, power. |
| `src/common/rfid/reader-chip.ts` | The header chip and its panel. |

The driver is lazy-loaded. A tenant without a reader never downloads it.

### The GATT channel

```
service  0000ffe0-0000-1000-8000-00805f9b34fb
write    0000ffe3-0000-1000-8000-00805f9b34fb
notify   0000ffe4-0000-1000-8000-00805f9b34fb
```

### The frame

```
HEAD  ADDR  CMD     LEN  [STATUS]  DATA…    CRC16
0xCF  1B    2B BE   1B   1B*       LEN-1B   2B, high byte first
                          (* responses only)
```

A whole frame is always `7 + LEN` bytes. CRC-16 covers HEAD through the last DATA byte: reflected
polynomial `0x8408`, preset `0xFFFF`, no final XOR — i.e. CRC-16/X-25 without the xorout. The unit
tests pin this to X-25's published check value rather than to our own transliteration of the
vendor's C.

RSSI arrives as a signed 16-bit value in **tenths of a dBm** (`0xFEC0` = −32.0 dBm). The vendor SDK
divides by ten; so do we.

### Telling a tag from a barcode

Both the UHF radio and the 2D barcode engine report on command `0x0001`. A barcode is identified by
its `STX … ETX CR` wrapper **and** by zeroed RSSI, antenna, and channel — those fields don't apply
to it. A real tag read always carries a non-zero (negative) RSSI, so requiring both signals leaves
no realistic ambiguity. There is a test for the adversarial case: an EPC whose bytes happen to look
like a wrapped barcode.

## Rolling it out

Order matters. Steps 1–2 are safe to run while tenants are live; nothing changes for anyone until
step 3.

### 1. Check your existing RFID data first

```bash
cd asset-wise-backend
bun run inspect:rfid          # add --samples 20 for more examples per shape
```

Read-only. No writes, no transactions that commit. It reports how many `ProductUnit.rfidTag` values
exist and what shape they are.

> **Why this matters.** `InventoryAuditService.resolveProductUnitsByScanValue` matches scan values
> against `rfidTag` with an **exact** `in` query — case-sensitive, no separator handling. A sweep
> emits canonical uppercase hex with no separators (`E2801160600002094C4C8B1A`). If your stored
> tags are lowercase or spaced, they will not match, and an audit would report every unit missing
> and every scan untracked. That is not data loss, but it is a wrong count.

The script reads with the platform's `app.bypass_rls` escape hatch, because `product_units` is
under row-level security and the app role is `NOBYPASSRLS`. Without it a plain `SELECT` returns
**zero rows** and the script would cheerfully report "no tags stored yet" against a full database.
It also cross-checks the organization count and warns you if that looks like what happened.

Three outcomes:

**No tags stored yet.** Nothing to do. Uppercase hex with no separators becomes the canonical
format from here on.

**Every tag is already canonical uppercase hex.** Nothing to do. Sweeps match existing data as-is.

**Some tags are lowercase, spaced, or otherwise off-format.** You need normalized matching. It is
not built yet — it was deliberately left until the data says whether it is needed, because it adds
a column and a backfill to every deployment. The shape is:

1. Additive migration: `ALTER TABLE product_units ADD COLUMN rfid_tag_normalized text;` plus an
   index. Nothing existing is altered or dropped.
2. Populate `rfidTagNormalized` on write in register / update / write-tag.
3. A dry-run-first backfill script for existing rows, in the style of
   `scripts/backfill-dispose-movement-type.ts`.
4. Widen the audit's resolver to match on `rfidTag` exact **OR** `rfidTagNormalized`.

`rfid_tag` is never rewritten in any of that, so it stays reversible: drop the column and the
system is exactly where it was.

The script also reports **collisions** — two different stored tags that would normalize to the same
value (e.g. `E2 80 11 60 60 00 02 09` and `E280116060000209`). Resolve those by hand *before*
enabling normalized matching, or a scan would become ambiguous between two units.

### 2. Apply the schema migration

```bash
cd asset-wise-backend
bunx prisma migrate deploy
```

`20260814090000_add_organization_reader_type` adds one enum and one column with a default:

```sql
CREATE TYPE "ReaderType" AS ENUM ('NONE', 'CHAFON_H103');
ALTER TABLE "organizations" ADD COLUMN "reader_type" "ReaderType" NOT NULL DEFAULT 'NONE';
```

Purely additive. Every existing organization takes `NONE`, so nothing changes for anyone. No column
is altered, renamed, or dropped, and no row is read or rewritten.

### 3. Turn it on for a tenant

`readerType` mirrors `printerType`: hardware the operator provisions, not a plan feature.

```
PATCH /platform/organizations/:id   { "readerType": "CHAFON_H103" }
```

`GET /entitlements` then returns `features.rfidReader: true`, and the reader UI appears. Tenants
left at `NONE` see no reader affordance anywhere — scanning still works for them exactly as before,
on barcode, keyboard-wedge, and manual entry.

## Using it

**Where it lives.** A chip in the shell header, for tenants with a reader. Connect once per shift;
the audit and registration sessions both use the same connection. The chip shows device name,
battery, and live read count, and its panel holds mode, range, the near-field gate, and
diagnostics.

**Reconnecting.** The paired device is remembered per browser profile. On load the app silently
re-attaches via `navigator.bluetooth.getDevices()` — no chooser, no prompt. A miss stays silent.

**Sweeping.** Either pull the reader's physical trigger, or press **Sweep** in the session. The app
reflects the trigger rather than commanding it, so both work regardless of how the firmware
behaves.

**Range presets.** Named for the job, not the number:

| Preset | Power | For |
| --- | --- | --- |
| At the antenna | 5 dBm | Only a tag you are holding |
| Arm's length | 16 dBm | One shelf or bin |
| Full range | 26 dBm | Sweep a whole aisle |

Registration opens at **At the antenna** with the near-field gate on; an audit opens at **Full
range** with it off. Both are set automatically and can be overridden from the chip.

**Barcodes.** The H103 SE-2D has a 2D barcode engine on the same connection. Switch to it from the
chip's panel. Tenants without an H103 keep using their existing scanner — that path is untouched.

## Gotchas worth knowing before you test

**Output mode is the classic silent failure.** The reader can emit reads as a Bluetooth *keyboard*
(HID) instead of over the GATT channel. In that state it connects perfectly and then never sends a
single tag. The app forces transparent output on every connect, so this should not bite — but if
you have previously paired the reader to this PC as a keyboard in Windows Bluetooth settings,
**remove that pairing first**, or Chrome may not offer the device at all.

**Web Bluetooth needs Chrome or Edge over HTTPS.** Firefox and Safari have no support; neither does
any browser on iOS. `localhost` counts as secure for development. The chip says so plainly rather
than offering controls that cannot work.

**One connection at a time.** If a phone or the vendor's Android app holds the reader, the browser
cannot have it.

**Diagnostics.** The chip's panel has a collapsed diagnostics section: a live hex log of every frame
in and out, a dropped-frame counter, trigger state, and a fine dBm slider. Pull the trigger and
watch the log — that is the fastest way to tell a link problem from a protocol problem.

## What was not verified

The protocol, framing, CRC, reassembly, dedupe, and near-field gate are covered by unit tests and
verified against the vendor SDK's bytecode. **The integration has not been run against physical
hardware** — no H103 was available to this build. The first real-device session should check, in
this order:

1. The device appears in Chrome's chooser and connects.
2. Frames appear in the diagnostics log in both directions.
3. Pulling the trigger produces `trigger` then tag frames.
4. Tags land in an audit session and resolve against the catalog.
5. The barcode mode switch takes, and a scanned barcode arrives as text.

If a step fails, the hex log plus the frame layout above is enough to tell exactly where.
