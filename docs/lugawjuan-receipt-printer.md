# Lugaw Juan Receipt Printer & Thermal Slips

This document describes the 58mm ESC-POS thermal receipt printing setup for Lugaw Juan POS operations using the XP-58H Bluetooth thermal printer.

---

## 1. Supported Slips & Reports

1. **Customer Receipt Slip**: Printed upon checkout completion. Includes store header, itemized line items (with menu flavors/size labels), statutory Senior/PWD discount details, gross subtotal, discount total, net total, payment method, cash tendered, change due, and salutation.
2. **Kitchen Order Slip**: Auto-printed job sent to kitchen/bar order counter.
3. **Queue Stub**: Customer queue number stub.
4. **Sales Day Report**: Printable end-of-day sales summary slip (Gross Sales, Discounts, Net Sales, Payment Breakdown, Transactions, Expenses).
5. **Inventory Close Report**: Printable end-of-day inventory reconciliation slip (`Opening -> Closing`, `+In / -Out / Sold`).

---

## 2. Printer Specifications & EscPos Encoding

- **Printer Model**: Xprinter XP-58H (or compatible 58mm ESC-POS printer).
- **Line Width**: 32 characters per line (`RECEIPT_COLS = 32`).
- **Connection**: Web Bluetooth API (`ReceiptPrintService`).
- **Encoding**: EscPos binary commands (`ESC @` reset, `ESC a` alignment, `GS !` character sizing, `GS V` paper feed/tear).
