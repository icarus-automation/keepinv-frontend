# Niimbot B21 Label Printing — Design

- **Date:** 2026-06-05
- **Status:** Approved design, pending implementation plan
- **Scope:** Frontend-only feature in the existing `asset-wise/frontend` Angular app

## Context

When a product is registered, staff need to print a physical label for it on a
**Niimbot B21** thermal label printer (50 × 30 mm rolls, 203 DPI). No printing
infrastructure exists in the codebase today. A product already carries the
identifiers a label needs: `id`, `sku`, and an optional `barcode`.

The B21 is a portable **Bluetooth-LE** printer that speaks a proprietary,
community-reverse-engineered protocol. It has no network endpoint, no standard
driver, and no official SDK. The printer sits next to the *user*, never next to
the server — so the print transport must run **client-side**. The backend has no
role in this feature.

## Decisions (locked)

- **Transport:** Web Bluetooth, from the browser, targeting **Chrome/Edge desktop**.
- **Protocol implementation:** **hand-rolled** Niimbot encoder + Web Bluetooth
  transport, ported from the open-source `niimprint` (Python) and NiimBlue (TS)
  references as documentation. **No npm dependency** for the protocol.
  - Rejected `@mmote/niimbluelib`: it is pre-release alpha (`0.0.1-alpha.38`) and
    hard-depends on Capacitor (`@capacitor/core`, `@capacitor-community/bluetooth-le`),
    a native-mobile framework that is dead weight in a desktop web app already
    fighting its bundle budget.
- **Structure:** our own `LabelPrinter` interface; the Niimbot implementation
  sits behind it; the whole feature is a **single lazy-loaded chunk** kept out of
  the main bundle.
- **One dependency added:** **JsBarcode** (MIT, small, no native deps,
  lazy-loaded) to render the Code128 barcode. Hand-rolling Code128 is its own
  107-symbol correctness risk with no upside; the alpha+Capacitor problem that
  justified hand-rolling the Niimbot protocol does not apply here.
- **Trigger:** an explicit **"Print label"** button shown after a successful
  registration; the same component is reused on the product detail view as a
  **reprint** action. Printing never blocks or affects the save.
- **Label content:** Code128 barcode (`barcode ?? sku`), product name, and
  brand / price. Retail-facing.
- **Label stock:** 50 × 30 mm at 203 DPI (≈ 400 × 240 dots, confirmed empirically).
- **Label template:** client-side, hardcoded layout for v1. Backend-owned
  templates are deferred (YAGNI).
- **Deployment:** cloud static hosting → HTTPS is automatic → the Web Bluetooth
  secure-context requirement is satisfied with no extra work.

## Non-goals (out of scope)

- No backend component, no separate service, no separate repository.
- No support for Safari/Firefox/iPad (Web Bluetooth is Chromium-only). If that
  changes, the `LabelPrinter` interface lets a local print-agent implementation
  slot in later without touching callers.
- No multi-size / roll-swapping UI; single 50 × 30 mm layout.
- No backend label-template management.
- No automated test of the physical print path (covered by an empirical gate).

## Architecture

Everything lives under `src/common/printing/`, behind one interface. The heavy
parts (protocol encoder, renderer, JsBarcode) sit behind a **single dynamic
`import()`** so they form one lazy chunk that never touches the main bundle.

| Unit | File | Responsibility | Depends on |
|---|---|---|---|
| `LabelPrinter` interface + shared types | `label-printer.ts` | The abstraction boundary: `connect`, `disconnect`, `print(bitmap)`, status. | — |
| Packet codec | `niimbot/niimbot-packet.ts` | **Pure.** Frame `0x55 0x55 │ type │ len │ data │ XOR-checksum │ 0xAA 0xAA`, and parse responses. | — |
| Command builders | `niimbot/niimbot-protocol.ts` | **Pure.** Build set-density / start-print / start-page / set-dimension / image-line / end-page / end-print packets. Opcodes ported verbatim from references. | packet codec |
| Web Bluetooth printer | `niimbot/niimbot-web-bluetooth-printer.ts` | Implements `LabelPrinter`. The **only** file touching `navigator.bluetooth`: device request, GATT connect, chunked writes, notifications, print state machine. | protocol, packet |
| Label renderer | `label-renderer.ts` | **Pure-ish.** `LabelData + LabelSpec → 1-bit packed bitmap` via offscreen canvas; barcode via JsBarcode. | JsBarcode |
| Data mapping | `label-data.ts` | **Pure.** `productToLabelData(product)`: name, brand, price, `barcodeValue = barcode ?? sku`. | money formatting |
| Orchestrator service | `label-printing.service.ts` | `providedIn:'root'`. Holds the printer, exposes signal-based status, `printProductLabel(product)`; performs the lazy `import()`. | all above |
| UI | `print-label-button.ts` | Tiny standalone, OnPush component used in product-form (post-save) and product-detail (reprint). | service |

### Angular conventions

Follows the project rules: standalone components (no `standalone: true`),
`ChangeDetectionStrategy.OnPush`, signals for state, `computed()` for derived
state, `inject()` over constructor injection, `class`/`style` bindings (no
`ngClass`/`ngStyle`), native control flow, strict typing (no `any`; `unknown`
where uncertain), and device APIs wrapped behind our own abstraction.

## Data flow

1. Product created in `product-form.ts`; the create call resolves with the
   product (`id`/`sku`/`barcode`).
2. The form shows the `print-label-button`, bound to the product.
3. Click → `service.printProductLabel(product)`:
   1. Lazy `import()` the printing engine (first time only).
   2. `productToLabelData(product)`.
   3. `label-renderer` produces a 1-bit bitmap for the 50 × 30 mm spec.
   4. If not already connected, `printer.connect()` (device picker on first use).
   5. Encode + transmit the bitmap over BLE; poll for print completion.
   6. Update status signal; surface a success or error toast.
4. The device reference is retained for the session, so reprints and the next
   product do not re-prompt the device picker while the connection holds.

The save path is independent: registration has already succeeded before any
printing is attempted, and a print failure never rolls it back.

## Niimbot protocol notes

- **Packet frame:** `0x55 0x55 │ type(1) │ len(1) │ data[len] │ checksum(1) │ 0xAA 0xAA`,
  where `checksum = type XOR len XOR (each data byte)`.
- **Print state machine:** connect → (optional get status/info) → set density →
  set label type → print-start → page-start → set image dimensions (rows × cols)
  → stream image rows → page-end → print-end → poll print status until complete.
- **Image encoding:** each row is `ceil(width / 8)` bytes of 1-bpp data, sent via
  the image-line opcode (with the per-line black-pixel header used by the
  reference implementations). v1 sends rows **uncompressed** (correctness over
  speed; ~240 rows for this label is trivial). RLE is a later optimization.
- **All opcode constants and service/characteristic UUIDs are ported verbatim
  from `niimprint`/NiimBlue and validated by a physical test print.** This design
  does not assert specific numeric opcodes — they are an implementation detail
  confirmed empirically, because a reverse-engineered binary protocol cannot be
  eyeball-verified.

## Web Bluetooth transport notes

- `navigator.bluetooth.requestDevice(...)` with filters for the Niimbot device
  (name prefix and/or `acceptAllDevices` + `optionalServices` listing the Niimbot
  service UUID, ported from NiimBlue).
- After connect: get GATT service, the write characteristic
  (`writeValueWithoutResponse`) and the notify characteristic; chunk writes to the
  negotiated MTU (fall back to 20-byte chunks).
- Listen for `gattserverdisconnected` to detect mid-print disconnects.
- Retain the device handle for the session to avoid re-prompting on reprint.

## Label layout (50 × 30 mm ≈ 400 × 240 dots @ 203 DPI)

Top to bottom:

- **Product name** — bold, ellipsis, up to 2 lines.
- **`brand · price`** — smaller line.
- **Code128 barcode** — full width, human-readable value beneath the bars,
  quiet zones preserved for scannability.

Exact dot dimensions, **orientation, and maximum print-head width are confirmed
empirically against a real B21**; the nominal 400 × 240 figure is a starting
point, not an assertion of pixel precision.

## Error handling

| Condition | Behavior |
|---|---|
| No `navigator.bluetooth` (non-Chromium / insecure context) | Button disabled; message: needs Chrome/Edge over HTTPS. |
| User cancels the device picker | Silent; status returns to idle (no error toast). |
| Printer off / out of range / GATT connect fails | Actionable error toast ("Power on the B21 and retry"). |
| Disconnect mid-print (`gattserverdisconnected`) | Error toast; mark disconnected. |
| Paper-out / cover-open | Surfaced if the protocol's status notifications report it. |
| Any print failure | Never affects the saved product; the label is a follow-on action. |

## Testing & verification

- **Unit tests** focus on the pure, silent-failure-prone units: packet codec
  (framing + checksum), protocol command builders, `productToLabelData` mapping,
  and renderer output dimensions. A wrong checksum or wrong image packing yields a
  blank/garbled label, so these are where tests earn their keep.
- The transport and the physical print **cannot** be meaningfully unit-tested.
- **Acceptance gate (empirical):** a real 50 × 30 mm label prints from the
  product registration flow, the layout fits within the label, and scanning the
  printed barcode decodes back to `barcode ?? sku`.

## Risks

1. **Web Bluetooth user-gesture trap.** `requestDevice()` requires transient
   activation. If the click handler `await`s the dynamic `import()` *before*
   calling `requestDevice`, the gesture can expire. **Mitigation:** prefetch the
   printing chunk on button hover/focus / on idle, so the click runs
   `requestDevice` without awaiting a network fetch.
2. **Reverse-engineered protocol.** Opcodes/UUIDs come from community references
   and a future B21 firmware change could break them. Mitigation: isolate all
   protocol code; validate by test print; the `LabelPrinter` interface allows
   swapping the implementation.

## Prerequisites

- **HTTPS:** satisfied automatically by cloud static hosting. No action required
  for the secure-context requirement.
- **Mixed content (separate concern):** once served over HTTPS, the app cannot
  call a remote plain-`http` API. The current `apiBaseUrl: http://localhost:8000`
  is a dev placeholder to reconcile during deployment — out of scope for this
  feature.

## Dependencies

- **Add:** `jsbarcode` (MIT), imported only inside the lazy-loaded printing chunk.
- **No other runtime dependencies.** No protocol library, no Capacitor.
