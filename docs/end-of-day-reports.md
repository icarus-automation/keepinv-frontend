# End-of-Day Reports Specification & Operator Guide

This document describes the `/end-of-day` reporting feature added in Lugaw Juan V2, supporting both cashier daily shift closes and owner/admin inventory reconciliations.

---

## 1. Overview & Access Control

The `/end-of-day` route provides two specialized daily sheets:

1. **Sales Day Sheet** (`GET /pos/sales/day-report?date=YYYY-MM-DD`):
   - **Access**: Cashiers (`member`), Admins, Owners.
   - **Purpose**: Cashier shift closing and till reconciliation.
   - **Metrics**: Gross Sales, Statutory Discounts, Net Sales, Completed Transactions count, Items Sold count, Payment Method breakdown (Cash, GCash, Card, etc.), and Expenses incurred today (Expenses visible to Owner/Admin).

2. **Inventory Close Sheet** (`GET /reports/inventory-close?date=YYYY-MM-DD`):
   - **Access**: Owner and Admin roles only.
   - **Purpose**: Stock ledger audit and loss prevention.
   - **Metrics per Product**:
     - `Opening Stock`: Product stock quantity at start of the day.
     - `+Stock In`: Sum of restocks / stock additions on that day.
     - `-Stock Out`: Sum of non-sale stock deductions / waste / damage on that day.
     - `Sales Qty`: Sum of units deducted via POS sales on that day.
     - `Closing Stock`: Expected stock count at end of day (`Opening + In - Out - Sales`).

---

## 2. ESC-POS 58mm Thermal Printing & Plain Text Summary

Operators can output both reports using two built-in methods:

1. **Thermal Print (XP-58H Bluetooth Printer)**:
   - Formatted for 58mm thermal receipts (32 columns width).
   - Styled with bold headers, centered branding, right-aligned monetary amounts, double-height net total emphasis, and tear feed spacing.

2. **Copy Summary (Clipboard Fallback)**:
   - 1-tap plain text copy formatted for SMS / Messenger / Viber reporting to store owners.

---

## 3. Data Integrity & Stock Ledger Formulas

Opening stock is calculated dynamically backwards from live stock balance:
$$\text{Opening Stock} = \max(0, \text{Closing Stock} - \text{Stock In} + \text{Stock Out} + \text{Sales Qty})$$

This guarantees consistent reporting even if reviewed retroactively for past dates.
