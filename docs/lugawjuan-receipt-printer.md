# Lugawjuan receipt printing — Xprinter XP-58H (58mm, USB+BT)

What prints after every completed sale, on one strip of paper:

1. **Kitchen slip** — shop name, `KITCHEN SLIP`, the day's order number huge (`#12`), time,
   each line as `2x Lugaw with Egg` in double-height bold, the sale note if any, and the total.
   Its job is that the kitchen never misses an order.
2. A tear gap, then the **customer stub** — shop name, `YOUR ORDER NUMBER`, `#12` huge, time.
   The cashier tears once between the two and hands the stub over.

Order numbers restart at `#1` each day (Manila time) and are stored on the sale's receipt
snapshot, so a reprint months later shows the same number. Sales made before this feature print
a `#` + receipt-number tail instead.

## First-time setup (once per tablet)

1. Load a 58mm roll, power the printer on.
2. Open the app in **Chrome on the Android tablet** (must be HTTPS — Web Bluetooth requires it).
   Do **not** pair the printer in Android's Bluetooth settings; the browser does its own pairing.
3. On **Point of Sale**, tap the **Connect printer** chip beside the search box.
4. Pick the printer (usually `XP-58H` or similar) in the chooser. The chip turns to
   `Ready` with a green dot.
5. Ring up a test sale — the kitchen slip + stub print by themselves.

After the first pairing the app remembers the printer and reconnects silently on reload where
Chrome supports it; otherwise the chip needs one tap per session.

## Daily flow

- **Auto-print**: completing a sale prints slip + stub immediately. A printer problem shows a
  red notice under the receipt but never blocks the sale.
- **Reprint**: on the sale-complete screen — `Print again` (slip + stub) or `Stub only`.
- **Old sales**: Sales → pick a sale → `Print slip`.

## Troubleshooting

- **Chip says "Connect printer" and auto-print complains** — tap the chip, re-pick the printer.
- **Printer prints garbage or nothing** — power-cycle it; make sure no phone app (e.g. a vendor
  test app) holds the connection. Hold the FEED button while powering on to print the self-test
  page, which confirms the printer itself is healthy and shows its Bluetooth name.
- **The chooser never lists the printer** — the unit may be classic-Bluetooth-only (no BLE).
  Fallback: `Print via system dialog` under the receipt prints the on-screen receipt through any
  OS-installed printer (e.g. the XP-58H over USB on a PC with its Windows driver, or RawBT on
  Android). Report it so the direct path can be revisited.
- **Faded print** — thermal paper in backwards (only one side is coated), or low voltage; use
  the DC9V adapter, not a USB power bank.

## Implementation notes

- `src/common/printing/receipt/escpos.ts` — minimal ESC/POS builder (32 cols, ASCII-sanitised;
  `₱` prints as `P` because the printer's code page has no peso sign).
- `src/common/printing/receipt/receipt-slips.ts` — kitchen slip / queue stub renderers over a
  POS-agnostic `SlipData`.
- `src/common/printing/receipt/receipt-printer.service.ts` — Web Bluetooth transport: chooser
  accepts any device, then talks over the usual ESC/POS BLE services (18f0, ff00, ffe0, ae30,
  49535343…, e7810a71…); writes are chunked at 120 bytes with a 15ms gap; the chosen device id
  persists in localStorage for silent reconnect via `navigator.bluetooth.getDevices`.
- `src/app/modules/pos/services/receipt-print.service.ts` — maps a sale's `ReceiptData` (+ org
  name) to slips; both the sell screen and the sales-ledger detail print through it.
- Order number: computed at checkout inside the sale transaction (backend
  `pos.service.ts#nextOrderNo`) as 1 + sales already completed that Manila day, stored only in
  `receiptSnapshot.orderNo` — no schema migration.
