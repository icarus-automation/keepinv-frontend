# Frontend Changes Summary (For Irene & Team)

This document summarizes all frontend UI and architectural changes introduced in **Lugaw Juan V2**.

---

## Workstream Summary & UI Changes

### 1. Workstream 3 — Cup of Joy Item Selection Fix
- **Issue**: Cup of Joy products (drinks with size tiles and flavors) couldn't be added directly to sales when menu groups had default items.
- **Fix**: Updated POS grid & customizer logic so clicking a drink tile opens flavor selection correctly, and adding to cart includes selected `menuFlavorId` with price delta.

### 2. Workstream 2 — Senior Citizen / PWD Statutory Discounts
- **UI Panel**: Added statutory discount selector chips (`Senior 20%` / `PWD 20%`) in the POS Tender sidebar.
- **ID Inputs**: ID Name and ID Number fields appear dynamically and validate before completing checkout.
- **Group-Share Stepper**: Toggle for group dining bill-sharing (`Party Size` and `Covered Seniors/PWDs`). Calculates statutory 20% discount on covered share formula:
  $$\text{Covered Base} = \frac{\text{Subtotal} \times \text{Covered Count}}{\text{Party Size}}, \quad \text{Discount} = \text{Covered Base} \times 20\%$$
- **Receipt Snapshot**: Discount lines (Type, ID Name, ID Number, Discount Amount) appear on receipt preview and printed receipts.

### 3. Workstream 4 — Fixed Daily Expenses
- **Panel & Templates**: Added "Fixed daily expenses" section in `/expenses` view with Active/Paused toggles and template management.
- **Auto-Posting**: Automatically posts due recurring expenses once per day on app launch.
- **History Suggestions**: Analyzes past 30 days history to suggest recurring candidates (expenses recorded on $\ge 5$ distinct days).

### 4. Workstream 1 — End of Day Reports (`/end-of-day`)
- **Route & Navigation**: New `/end-of-day` route added under Operations in sidebar navigation.
- **Tabs**:
  - `Sales Day Sheet`: Cashier shift close takings report (Gross Sales, Discounts, Net Sales, Payment Method breakdown, Expenses).
  - `Inventory Close Sheet`: Stock reconciliation sheet (`Opening Stock`, `+In`, `-Out`, `Sales Qty`, `Closing Stock`).
- **Output Options**: Bluetooth 58mm thermal print button and 1-tap plain-text copy summary fallback for messaging.
