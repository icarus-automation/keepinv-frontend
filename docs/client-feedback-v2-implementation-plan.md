# Client Feedback V2 — Ultimate Implementation Plan

**Branch:** `lugawjuan.keepinv.com` (both repos — frontend `asset-wise-frontend`, backend `asset-wise-backend`)
**Do not commit to `master` / `main`.**
**Date:** 2026-08-12
**Stores:** LugawJuan (plain product-grid POS) · A Cup of Joy (size→flavor drinks POS). Same codebase, two orgs, one owner.

> **⚠ This deploys onto a live production database with real trading data.** No `prisma migrate reset`, no destructive migrations, no seed script that writes business rows. See §5 before writing a single migration.

---

## 0. The client's four asks, decoded

| # | Her words | What she actually needs | Root cause / gap |
|---|---|---|---|
| 1 | *"Option to print the inventory and sales report… I need to check isa-isa. Takes a lot of time."* | **One end-of-day print**: total stock per item, and the day's sales sheet she hands to the money person. | No report surface prints. The only printing that exists is the kitchen slip / queue stub (58mm ESC-POS). No inventory-count endpoint. `/reports` is a screen-only sales dashboard. |
| 2 | *"Sa POS, wala option dun yung senior citizen discount."* | Statutory **20% Senior / PWD discount**, captured with the ID details, reflected on the receipt and in the day's totals. | No discount concept anywhere. `PosService.calculateTotals()` sets `total = subtotal`, full stop (`pos.service.ts:650`). `Sale` has no discount columns. |
| 3 | *"Sa Lugaw puwede kong mag-add ng bagong item sa menu, pero sa Cup of Joy hindi ako makapag-add."* | Add a new sellable item in the drinks store and actually see it at the counter. | **Confirmed bug** — see §3.1. The drinks POS *replaces* the product grid, so anything she adds that isn't a size inside a menu group is invisible at checkout. She can create it; she can never sell it. |
| 4 | *"For expenses, mas maganda if meron option na fixed expenses every day. Hassle mag-input every day."* | **Recurring expense templates** that post themselves. | Expenses are manual-only, one row at a time (`expenses.ts:submit`). No recurrence model. |

**Delivery order (by client pain ÷ effort):** WS3 → WS2 → WS4 → WS1.
WS3 is a live bug in a shop that is open today. WS1 is the biggest build and depends on WS2 (discounts must appear on the sales sheet) — do it last so it is built once, correctly.

---

## Workstream 3 — Cup of Joy can't add items *(ship first, it's a bug)*

### 3.1 Root cause — verified in code

`src/app/modules/pos/pos.ts`

```
:129   protected readonly usesDrinkMenu = computed(() => this.menuGroups().length > 0);
:283   loadMenu() { … if (groups.length > 0) { this.gridLoading.set(false); return; }  // ← loadGrid() never runs
              this.loadGrid(); }
```

A Cup of Joy has 3 menu groups (Milktea, Coffee, Hot Tea), so `usesDrinkMenu` is `true`, `loadGrid()` is never called, and `pos.html` renders **only** the drinks picker. Every product she adds that is not a `menuGroupId`-bearing size — a pastry, bottled water, a new standalone drink — exists in the catalog, is returned by `GET /pos/products`, and **cannot be reached at the counter**. LugawJuan has zero menu groups, so the grid renders and adding works. That asymmetry is exactly what she reported.

The design comment at `pos.ts:278-282` says the grid "must not" show because every drink size demands a flavor. That reasoning is right for *sizes* and wrong for *everything else*.

### 3.2 Secondary friction (fix in the same pass)

- **`/menu` (Menu & Flavors) can't add a size.** Sizes render read-only (`menu.ts:26-28`); the copy says they're "created on the Menu Items screen" but doesn't link there. Adding a drink line therefore means: `/menu` → new group → `/products` → new item → set menu group + size label + recipe (8+ fields). Expert-only.
- **Empty-group trap.** `MenuService.createMenuGroup` (`menu.service.ts:26`) happily creates a group with **0 flavors and 0 sizes**. `GET /pos/menu` then renders a dead card, and any size later attached to it can never check out — `resolveMenuFlavor` throws `"<product> requires a flavor"` (`pos.service.ts:599`). If she already tried "add" this way, this is the second thing that bit her.

### 3.3 Changes

**Backend**

| File | Change |
|---|---|
| `src/modules/pos/types/pos.types.ts` | Add `menuGroupId: string \| null` to `PosSearchItem`. |
| `src/modules/pos/pos.service.ts` | `toProductSearchItem()` (:1036) emits `menuGroupId`. `getPosMenu()` (:185) drops groups that have **no sizes** or **no live flavors** — a dead card can never reach the counter. |
| `src/modules/menu/menu.controller.ts` + `menu.service.ts` | New `POST /menu/groups/:id/sizes` → creates a size product for that group in one call: `{ label, sellingPrice, costPrice?, componentId?, componentQuantity? }`. Server generates `name` (`"<Group> (<label>)"`) and a unique SKU (mirror `generateIngredientSku` in `products/types/product.types.ts`), sets `menuGroupId`, `menuSizeLabel`, `menuSortOrder = max+1`, `categoryId` = the group's dominant category or the tenant's `Uncategorized`. Reuses `ProductsService.createProduct` internally so every existing validation still runs. |
| `src/modules/menu/menu.service.ts` | `createMenuGroup` accepts an optional `firstFlavorName` and creates group + flavor atomically, so a group is never born dead. |

**Frontend**

| File | Change |
|---|---|
| `src/app/modules/pos/pos.ts` | `loadMenu()` **always** calls `loadGrid()`. New `otherProducts = computed(() => gridProducts().filter(p => !p.menuGroupId))`. New `posMode = signal<'drinks' \| 'others'>('drinks')`, only rendered when both lists are non-empty. |
| `src/app/modules/pos/pos.html` | Segmented control above the picker: **Drinks | Others (n)**. `Others` renders the existing `<app-product-grid>` with `otherProducts()`. LugawJuan (no menu groups) is untouched — one list, no segmented control. |
| `src/app/modules/pos/types/pos.types.ts` | Mirror `menuGroupId` on `PosSearchItem`. |
| `src/app/modules/menu/menu.ts` / `menu.html` | Per-group **"Add size"** → compact dialog (label, price, optional "draws from" ingredient + qty) hitting the new endpoint. **"Add drink line"** → group name + first flavor + first size in one flow. Groups with 0 sizes or 0 live flavors render an amber **"Can't be ordered yet — add a size and a flavor"** card with the exact next action. |
| `src/app/modules/menu/services/menu.service.ts` / `types/menu.types.ts` | `createSize(groupId, body)`; extend `MenuGroupRequest` with `firstFlavorName`. |

### 3.4 Acceptance

- [ ] In A Cup of Joy: create a plain product (e.g. "Bottled Water", own-stock, no menu group) → it appears under **Others** at the POS and rings up.
- [ ] In A Cup of Joy: `/menu` → "Add size" on Milktea → new size appears in the drinks picker without visiting `/products`.
- [ ] Creating a brand-new drink line from `/menu` produces a group that is immediately orderable.
- [ ] A group with no sizes never renders at the POS; `/menu` explains why and how to fix it.
- [ ] LugawJuan's POS is visually and behaviourally identical to today.

**Effort:** M (~2 days FE, ~1 day BE). No migration.

---

## Workstream 2 — Senior Citizen / PWD discount

### 2.1 Legal frame (this is not a UI preference — it's RA 9994 / RA 10754)

- **20%** off the senior's / PWD's own consumption.
- **Group bills** (restaurant rule, BIR RMC 38-2012): covered base = `total bill ÷ number of persons × number of covered persons`. Discount = 20% of that base.
- The seller must keep a **separate senior/PWD sales log**: date, receipt no., **name**, **OSCA / PWD ID number**, gross, discount. The receipt must print the ID details.
- **Both shops are NON-VAT-registered (client-confirmed).** → straight 20%, **no VAT-exempt line, no VAT breakdown on the receipt**. Do not build VAT handling; do not add an `isVatRegistered` flag on this branch. (Generalising it is `main`'s problem — see `docs/adopt-to-main.md` §T1.1.)
- **SENIOR and PWD only (client-confirmed).** No custom/promo discount. The cashier cannot discount freely — that is a deliberate control, not an omission.

### 2.2 Schema (`prisma/schema.prisma`)

```prisma
/// SENIOR / PWD only — the two statutory discounts. No promo/custom type by decision.
/// Postgres can ALTER TYPE … ADD VALUE later without a table rewrite, so this costs nothing.
enum SaleDiscountType { NONE SENIOR PWD }

model Sale {
  // …existing…
  discountType         SaleDiscountType @default(NONE)         @map("discount_type")
  /// Rate snapshot (0.20). Kept so a later statutory change never rewrites old receipts.
  discountRate         Decimal?         @db.Decimal(5, 4)      @map("discount_rate")
  discountAmount       Decimal          @default(0) @db.Decimal(12, 2) @map("discount_amount")
  /// BIR senior/PWD log fields. Required for SENIOR/PWD, null otherwise.
  discountIdName       String?          @map("discount_id_name")
  discountIdNumber     String?          @map("discount_id_number")
  /// Group-share method: covered persons out of the party. Both default to 1.
  discountCoveredCount Int?             @map("discount_covered_count")
  discountPartySize    Int?             @map("discount_party_size")

  @@index([organizationId, discountType])   // the senior/PWD log report
}
```

`subtotal` stays **gross**; `total = subtotal − discountAmount`. Existing rows migrate to `NONE` / `0` — every current report keeps its numbers.

> **Decision: bill-level, not line-level.** The group-share formula is the legally-correct restaurant method and is one number for the cashier. Line-level selection is slower at a busy counter and buys nothing legally. Documented here so it isn't re-litigated.

### 2.3 Backend

| File | Change |
|---|---|
| `dto/checkout-pos.dto.ts` | New nested optional `discount`: `{ type: 'SENIOR' \| 'PWD', idName, idNumber, coveredCount?, partySize? }`. `idName`/`idNumber` are **required** whenever `discount` is present. **No client-supplied amount or percent field exists at all** — the wire format makes tampering unrepresentable rather than merely rejected. |
| `pos.service.ts` | `calculateTotals()` (:650) takes the discount input and computes it server-side: `covered = subtotal × coveredCount / partySize`; `discountAmount = round2(covered × 0.20)`. Guards: `1 ≤ coveredCount ≤ partySize`, `partySize ≥ 1`, `discountAmount ≤ subtotal`, tender compared against the **discounted** total. New constant `STATUTORY_DISCOUNT_RATE = 0.20` in `pos/constants/`. |
| `pos.service.ts` | `buildReceiptData()` (:955) emits `totals: { subtotal, discount, total }` + `discount: { type, rate, idName, idNumber, coveredCount, partySize }`. `tx.sale.create` persists the new columns. |
| `pos.service.ts` | `getSalesSummary()` (:330) adds `discountTotal` and `netSales` (`grossSales` stays the gross of `total`… see note below). |
| `types/pos.types.ts` | `ReceiptData.totals.discount`, `ReceiptData.discount`, `PosSalesSummary.discountTotal`. |
| `reports/reports.service.ts` | No change needed for P&L — `computeProfitLoss` sums `sale.total`, which is already net of discount. Add `discountTotal` to the report payload so the owner sees what discounts cost her. |
| `pos.controller.ts` | New `GET /pos/sales/discount-log?dateFrom&dateTo` → the BIR senior/PWD book: receipt no, date, name, ID no, gross, discount, cashier. Owner/admin only. |

> **Summary semantics:** keep `grossSales` = Σ`sale.total` (unchanged meaning, so nothing downstream silently shifts), and add `discountTotal` alongside. The day sheet renders `Gross ₱X · Discounts −₱Y · Net ₱Z` where `Gross = grossSales + discountTotal`. State this in the field doc comments.

### 2.4 Frontend

| File | Change |
|---|---|
| `pos/types/pos.types.ts` | Mirror `SaleDiscountType`, `CheckoutRequest.discount`, `ReceiptData.totals.discount` + `ReceiptData.discount`, `SalesSummary.discountTotal`. `SaleListItem.discountAmount`. |
| `pos/pos.ts` | `discount = signal<DiscountDraft \| null>(null)`. `discountCents` computed from cart subtotal (mirror of the server formula, display-only). `totalCents = subtotalCents − discountCents`. `canComplete` / `changeDueCents` use the discounted total. `newSale()` clears it. |
| `pos/pos.html` | **"Discount"** button in the tender panel (next to Note). Panel: two chips `Senior 20% · PWD 20%`; ID **name** + **ID number** inputs (required, inline-validated); live preview `Discount −₱X → New total ₱Y`; Remove. Totals band grows a `Discount` row that only renders when non-zero. **Group share defaults to off**: the panel opens at `party 1 / covered 1` (= whole bill, two taps total). A single `Sharing with others?` link reveals `Party size` / `Covered` steppers. See §2.6. |
| `pos/components/receipt.html` | `Subtotal` → `Senior discount (20%)` / `PWD discount (20%)` → `Total`, plus a small `OSCA/PWD ID · <name> · <no>` block. |
| `common/printing/receipt/receipt-slips.ts` | Kitchen slip's `TOTAL` uses the discounted total (already reads `data.total` — pass the net). Customer receipt slip (new, WS1) prints the discount rows + ID line. |
| `pos/sales.html` / `sales.ts` | Ledger row shows a `SC`/`PWD` chip; totals band adds `Discounts`. |
| `pos/detail/sale-detail.html` | Discount rows + ID details on the stored sale. |

### 2.5 Acceptance

- [ ] Cashier taps Discount → Senior → types name + OSCA no. → total drops exactly 20% → completes. **Three taps and two fields, no more.**
- [ ] Party of 4 with 1 senior on a ₱400 bill → discount = ₱20 (400 ÷ 4 × 0.20), not ₱80.
- [ ] Discount without ID name/number is rejected client- and server-side.
- [ ] Receipt (screen + thermal) shows subtotal, discount line, ID details, net total.
- [ ] Day sheet (WS1) and P&L both show discounts; net revenue matches the drawer.
- [ ] Voiding a discounted sale reverses the full stock and leaves totals consistent.
- [ ] No VAT line appears anywhere (non-VAT shops).
- [ ] Existing sales made before this ships still render correctly (`discountType = NONE`, no discount row).

### 2.6 Why group-share ships (and why it's still two taps)

Whole-bill-only looks faster but is wrong in the common case: 4 people eat, 1 is a senior. Without the share rule the cashier either discounts the whole ₱400 bill (₱80 — the shop eats ₱60 it never owed, every single time) or works it out on a calculator at the counter. Neither is acceptable and the second one won't happen.

So: **build the rule, hide the input.** Party/covered default to `1/1`, which is the whole bill, so the lone-senior case — the overwhelming majority, especially at A Cup of Joy — never sees the steppers. The group case costs one tap to reveal. Fast path stays fast; the shop stops leaking money on the group path.

**Effort:** L (~2 days BE incl. migration, ~2.5 days FE). One migration.

---

## Workstream 4 — Fixed daily expenses

### 4.1 Approach

Recurring **templates** + **idempotent posting**. No cron: `@nestjs/schedule` is not installed and a single-VPS cron that misses a night silently loses a day of expenses. Posting is an explicit, replayable POST that back-fills any missed days.

### 4.2 Schema

```prisma
enum RecurrenceFrequency { DAILY WEEKLY MONTHLY }

model RecurringExpense {
  id         String   @id @default(uuid())
  name       String                                    // "Rent (daily share)", "Ice delivery"
  amount     Decimal  @db.Decimal(12, 2)
  frequency  RecurrenceFrequency @default(DAILY)
  /// WEEKLY only: Manila weekdays 0–6. Empty = every day of the week.
  weekdays   Int[]    @default([])
  /// MONTHLY only: 1–31, clamped to the month's last day.
  dayOfMonth Int?     @map("day_of_month")
  startsOn   DateTime @map("starts_on")  @db.Date
  endsOn     DateTime? @map("ends_on")   @db.Date
  isActive   Boolean  @default(true)  @map("is_active")
  isArchived Boolean  @default(false) @map("is_archived")

  organizationId    String @default(dbgenerated("current_setting('app.current_org_id'::text, true)")) @map("organization_id")
  expenseCategoryId String @map("expense_category_id")
  expenseCategory   ExpenseCategory @relation(fields: [expenseCategoryId], references: [id], onDelete: Restrict)
  userId            String @map("user_id")

  expenses  Expense[]
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt      @map("updated_at")

  @@index([organizationId])
  @@map("recurring_expenses")
}

model Expense {
  // …existing…
  recurringExpenseId String?           @map("recurring_expense_id")
  recurringExpense   RecurringExpense? @relation(fields: [recurringExpenseId], references: [id], onDelete: SetNull)

  /// Idempotency key. Generated rows always write Manila-midnight, so one template can
  /// post at most once per business day. NULL for manual rows, and Postgres treats NULLs
  /// as distinct, so manual entry is unaffected.
  @@unique([recurringExpenseId, incurredAt])
}
```

### 4.3 Backend

| File | Change |
|---|---|
| `common/time/manila-day.ts` **(new)** | Extract `manilaStartOfDay` / `manilaEndOfDay` / `manilaDateKey` out of `pos.service.ts:66`. Four features need it now; one copy. |
| `expenses/recurring-expenses.controller.ts` **(new)** | `GET /expenses/recurring`, `POST`, `PATCH /:id`, `DELETE /:id` (archive), `POST /expenses/recurring/post` body `{ date?: 'YYYY-MM-DD' }`. Owner/admin (`@OrgRoles(['owner','admin'])`), matching the rest of the module. |
| `expenses/recurring-expenses.service.ts` **(new)** | `postDue(userId, date)`: for each active template, enumerate due business days from `max(startsOn, lastPosted+1, date−CATCH_UP_DAYS)` to `date`, `createMany({ skipDuplicates: true })` inside one transaction. Returns `{ created, skipped, from, to, total }`. `CATCH_UP_DAYS = 60` so a long absence can't fabricate a year of rows. |
| `expenses/expenses.service.ts` | `getAll` returns `recurringExpenseId` so the ledger can badge generated rows. |
| `core/auth/provisioning.ts` | **No change. Do not seed any template.** See §4.6. |
| `expenses/recurring-expenses.service.ts` | `suggestFromHistory()` — reads the last 30 days of expenses, groups by `(expenseCategoryId, amount)`, returns rows seen on ≥ 5 distinct days. Powers the one-tap "make this recurring" first-run experience. Read-only; suggests, never writes. |

### 4.4 Frontend

| File | Change |
|---|---|
| `expenses/types/expense.types.ts` | `RecurringExpense`, `RecurringExpenseRequest`, `PostRecurringResult`; `Expense.recurringExpenseId`. |
| `expenses/services/recurring-expenses.service.ts` **(new)** | CRUD + `postDue(date?)`. |
| `expenses/expenses.ts` / `expenses.html` | New **"Fixed expenses"** panel above the ledger: template rows (name · category · ₱amount · frequency · pause/edit/delete) and **Add fixed expense**. On screen load, call `postDue()` once per day (guard in `localStorage` keyed by org + Manila date) and show the outcome inline: `Today's fixed expenses posted ✓ ₱1,250 · 4 items` or `Post now` when something is outstanding. Ledger rows from a template get a small **Fixed** badge; they stay fully editable (the electric bill that differs one day) and deleting one does **not** re-create it. |
| `app.routes.ts` / `layout.ts` | No new route — this lives inside `/expenses`. |

### 4.5 Acceptance

- [ ] Owner defines "Rent ₱300/day" once; opening Expenses the next morning shows it already recorded.
- [ ] Opening Expenses twice in one day does **not** double-post.
- [ ] Away for a week → next open back-fills the 7 missing days (bounded at 60).
- [ ] Editing a posted row's amount sticks and doesn't get overwritten.
- [ ] Pausing a template stops future posting and leaves history intact.
- [ ] P&L for the period includes generated rows automatically (no report change needed).
- [ ] First open shows suggestions built from her **own** expense history — not invented defaults.
- [ ] No expense row is ever created without the owner explicitly confirming a template.

### 4.6 Why no seeded templates (and what replaces them)

Seeding is tempting and wrong here. Generated rows post **real money into a live P&L** — a guessed "Rent ₱300/day" is not a placeholder the owner can ignore, it is a fabricated expense silently deflating her profit until she notices. And we do not know her actual amounts; the client said her expenses are fixed, not what they are.

Instead the panel ships **empty with a populated first-run state**: `suggestFromHistory()` reads what she has *already been typing every day* for the last 30 days and offers each as a one-tap template — "You've recorded **Ice ₱150** on 22 of the last 30 days. Make it automatic?" Every number comes from her own books, one confirmation each.

That is strictly better than seeding: it is correct by construction, it needs no knowledge of her business, it makes the feature explain itself, and it is the moment she realises the software was paying attention. Ship the empty panel.

**Effort:** M (~1.5 days BE incl. migration, ~1.5 days FE).

---

## Workstream 1 — Printable Inventory + Sales reports *(the headline)*

### 1.1 Shape: one screen, two sheets, one habit

New route **`/end-of-day`** ("End of Day"), nav section *Operations*, **`posGuard` only — no `adminGuard`**. Date picker defaulting to **today (Manila)**, two tabs:

1. **Sales** — the sheet she hands to the money person. **Reachable by cashier and owner** (client-confirmed).
2. **Inventory** — total stock per item. **Owner/admin only** — it is served by the owner-gated reports module and exposes stock value.

Each tab: **Print (58mm)** · **Copy summary**. Plus **Print both** (owner only, since it includes Inventory) so closing is one tap.

**Access shape.** Add `'end-of-day'` to both `POS_PATHS` **and** `MEMBER_PATHS` in `layout.ts:93,100`. The Inventory tab renders only when `organizationService.canManage()` — a `member` sees a single-tab screen, never a tab that 403s. The day report's owner-only fields (`expensesToday`) are omitted server-side for `member`, so the cashier's sheet is takings-only by construction, not by hiding.

**58mm only (client-confirmed).** No A4 sheet, no `@page` CSS, no `.print-sheet` class — **do not touch `src/styles.css`**, the existing `.print-area` 58mm rule stays exactly as it is. The fallback when the printer dies is **Copy summary**: a plain-text block sized for Messenger/Viber, which she can send to the money person from the same tablet. That is a better escape hatch than A4 on a device with no A4 printer attached, and it is ~20 lines.

### 1.2 Backend — Sales day report

`GET /pos/sales/day-report?date=YYYY-MM-DD&cashierId=<uuid>` — on the **POS controller** (staff-reachable, like `/pos/sales/summary`, so a cashier can print their own Z-read at close). Takings only: **no cost, no margin** — those stay on the owner-only reports module, matching the boundary already documented at `pos.controller.ts:79-81`.

```jsonc
{
  "businessDate": "2026-08-12",           // Manila day
  "from": "…", "to": "…",
  "generatedAt": "…",
  "orders": 87,
  "itemsSold": 213,
  "grossSales": "12500.00",               // before discounts
  "discountTotal": "340.00",
  "discountsByType": [ { "type": "SENIOR", "count": 3, "amount": "240.00" } ],
  "netSales": "12160.00",
  "byPaymentMethod": [ { "paymentMethod": "CASH", "amount": "9800.00", "count": 70 } ],
  "byCashier":       [ { "cashierId": "…", "name": "Ana", "orders": 45, "netSales": "6400.00" } ],
  "voidedCount": 2, "voidedAmount": "180.00",
  "topItems": [ { "name": "Lugaw with Egg", "quantity": 41, "amount": "2050.00" } ],   // capped at 10
  "expensesToday": "1250.00",             // owner/admin only; omitted for `member`
  "cashToRemit": "9800.00"                // cash sales; expenses shown separately, never netted silently
}
```

Implementation: reuse `buildSaleWhere` so the numbers can never disagree with the ledger. Aggregate with `groupBy` (status × paymentMethod, and cashierId) + a `saleItem.groupBy` for `topItems`. One `$transaction` after `setTenantContext`, `RepeatableRead`, mirroring `ReportsService`.

### 1.3 Backend — Inventory close report

`GET /reports/inventory-close?date=YYYY-MM-DD&kind=ALL|SELLABLE|INGREDIENT&includeZero=false` — owner/admin.

Per row: `productId, name, sku, categoryName, opening, in, out, sold, adjustments, closing, costPrice, stockValue, reorderPoint, isLow`.
Totals: `itemCount, totalUnits, totalStockValue, lowStockCount`.

Math (exact, and it survives back-dating):

```
closing(D)  = product.quantityOnHand − Σ quantityChange WHERE createdAt > manilaEndOfDay(D)
dayChanges  = movements WHERE createdAt BETWEEN manilaStartOfDay(D) AND manilaEndOfDay(D)
in          = Σ  positive dayChanges
out         = Σ |negative dayChanges|
sold        = Σ |negative dayChanges WHERE stockMovementType.systemKey = 'SALE'|
opening     = closing − (in − out)
```

Every stock change in this codebase writes a `StockMovement` (POS sale, void/return, adjustment, audit, receipt import), so this reconciles exactly. Add a doc comment saying so — if a future path mutates `quantityOnHand` without a movement, this report is the thing that breaks.

Group by category on the client. Recipe items (bowls, drink sizes) hold no stock of their own — render them as **"made from ingredients"** with their *derivable servings* (reuse `productAvailability`, `pos.service.ts:1020`) rather than a fake 0. The countable rows are the ingredient pools, which is what she actually counts at closing.

### 1.4 Printing

**Thermal (58mm, 32 cols)** — extend the existing pipeline, don't fork it.

| File | Change |
|---|---|
| `src/common/printing/receipt/escpos.ts` | Add `rowWrapped(left, right)` — `row()` (:108) truncates the left side, which mangles long item names on a report. Add `twoCol(left, right, leftWidth)` for the inventory grid. |
| `src/common/printing/receipt/report-slips.ts` **(new)** | `renderSalesDayReport(data)` and `renderInventoryReport(data)`. Header: shop name, `SALES REPORT` / `INVENTORY REPORT`, business date, printed-at, printed-by. Sales body: orders, items, gross, discounts (with SC/PWD split), net, payment split, per-cashier, voids, top items, `CASH TO REMIT` double-height, then a `Counted by: ______ / Received by: ______` sign-off block — that's the artifact the money person signs. Inventory body: per category, `<item name>` wrapped, right-aligned `closing` (and `sold` when the day sheet is requested), category subtotals, grand total units + stock value. |
| `src/common/printing/receipt/receipt-slips.ts` | New `renderCustomerReceipt(data)` — a real customer receipt with discount rows and the OSCA/PWD ID block (WS2 needs it; today only the kitchen slip and queue stub exist). |
| `src/app/modules/pos/services/receipt-print.service.ts` | New `printSalesDayReport`, `printInventoryReport`, `printCustomerReceipt` (all via `printSlipInteractive`'s connect-then-print path). |

**Copy summary (the no-paper fallback)** — a `navigator.clipboard.writeText()` of a plain-text rendering of the same data, ~30 chars wide so it reads cleanly in a chat bubble. Shares the formatting helpers with the slip renderer so the numbers can never differ between paper and message.

### 1.5 Frontend

| File | Change |
|---|---|
| `src/app/modules/end-of-day/` **(new)** | `end-of-day.ts` / `.html` (tabs, date, print actions), `services/end-of-day.service.ts`, `types/end-of-day.types.ts`, `components/sales-day-sheet.ts`, `components/inventory-sheet.ts` (both `OnPush`, inline-template where small, print-friendly markup inside `.print-sheet`). |
| `src/app/app.routes.ts` | `{ path: 'end-of-day', title: 'End of Day', canActivate: [posGuard], loadComponent: … }` — **no `adminGuard`**, the cashier needs this. |
| `src/app/layout/layout.ts` | Nav item under *Operations*: `{ label: 'End of Day', icon: 'pi pi-print', path: 'end-of-day' }`. Add `'end-of-day'` to **both** `POS_PATHS` (:93) and `MEMBER_PATHS` (:100). |
| `src/app/modules/pos/report/sales-report.ts` | Add a **"Print this period"** button reusing the same slip renderer, so the existing analytics screen isn't a dead end. |

### 1.6 Acceptance

- [ ] At close, one tap prints a 58mm sales sheet showing gross, discounts, net, cash vs GCash, voids, per-cashier, and cash-to-remit with a sign-off line.
- [ ] One tap prints the inventory sheet: every item, grouped by category, with today's closing count — no clicking item by item.
- [ ] Both sheets reprint identically for a past date (she can re-run last Friday).
- [ ] Numbers reconcile: day sheet `netSales` == `/pos/sales/summary` for the same Manila day == the P&L revenue for that day.
- [ ] Inventory `closing` for today == the count shown on `/ingredients` and `/products`.
- [ ] A signed-in **cashier** can open `/end-of-day`, sees only the Sales tab, and can print it.
- [ ] Kitchen-slip and queue-stub printing are byte-identical to today (`.print-area` untouched).
- [ ] **Printing at 11pm and at 1am produce different business dates, and both are right.**

**Effort:** L (~2 days BE, ~2.5 days FE). No migration. *(Trimmed from the original estimate — the A4 path is cut.)*

---

## Cross-cutting

### The business day — **midnight Manila, resolved on the server** (decision)

Every day-scoped surface (order numbers, day report, inventory close, recurring expenses) uses **00:00–23:59:59.999 Asia/Manila**, matching what `nextOrderNo` already assumes (`pos.service.ts:948`). Both shops close well before midnight, so no shift straddles the boundary.

The part that matters is *where* it is resolved:

- **Day-scoped endpoints take `date=YYYY-MM-DD`, never an ISO instant**, and expand it to Manila boundaries server-side. `GET /pos/sales/day-report?date=2026-08-12`, `GET /reports/inventory-close?date=…`, `POST /expenses/recurring/post {date}`.
- The frontend sends a plain date string and does no boundary math for these screens.

**Why this is non-negotiable:** the existing screens build their windows with `setHours(0,0,0,0)` on the **browser's** timezone and then `.toISOString()` (`sales-report.ts:259`, `expenses.ts:332`, `sales.ts`). That is only correct while the tablet's clock is set to Manila. A device on UTC, a misconfigured tablet, or a browser that ships a different default silently shifts the whole report by 8 hours — and since 00:00 Manila is 16:00 UTC the previous day, the failure mode is *late-afternoon sales landing on tomorrow's sheet*. Given this branch already carries a commit called "5pm fix", assume this class of bug has bitten once already. Server-resolved dates make it structurally impossible.

Existing screens keep their current behaviour (out of scope); new ones must not copy the pattern.

**Shared work — do once, first**
- `src/common/time/manila-day.ts` (BE): extract `manilaStartOfDay` / `manilaEndOfDay` / `manilaDateKey` from `pos.service.ts:66`. Four features need it; one copy.
- `PosSalesSummary` / day-report money stays **fixed-2 decimal strings** (POS contract); reports module money stays **plain numbers** (reports contract). Do not mix — both conventions are already load-bearing.

**Testing** (unit specs only where logic is real; this repo does not run strict TDD)
- `pos.service.spec.ts`: discount math — whole bill, group share, cap at subtotal, tender vs discounted total.
- `manila-day.spec.ts`: 16:00 UTC is the start of the next Manila day; a 23:30 and a 00:30 sale fall on different business dates.
- `recurring-expenses.service.spec.ts`: idempotency, catch-up bounds, weekday/monthly selection, month-end clamp.
- `reports.service.spec.ts`: `opening + in − out == closing`, back-dated day, item with zero movements.
- Manual QA on the tablet: print both sheets on the XP-58H, confirm column alignment at 32 chars and that long item names wrap instead of truncating.

**Risks**
| Risk | Mitigation |
|---|---|
| Discount math wrong → BIR exposure | Server-authoritative; rate snapshotted per sale; spec'd unit tests; discount log report for audits. |
| Inventory report drifts from reality | Derived from the movement ledger + live `quantityOnHand`, never a parallel counter. Documented invariant. |
| Recurring expenses double-post | DB unique key `(recurringExpenseId, incurredAt)` + `skipDuplicates`. The UI guard is convenience, not correctness. |
| POS "Others" tab confuses drinks staff | Only renders when the tenant has both lists; defaults to Drinks; LugawJuan unchanged. |
| 58mm report too long / paper waste | Inventory sheet defaults to `includeZero=false`; category filter; show the row count before printing. |
| **New table ships without an RLS policy → cross-store leak** | Hand-written policy block in the migration, copied from the menu-tables migration. Verify with `SELECT relname, relrowsecurity FROM pg_class WHERE relname='recurring_expenses'` after deploy. §5.2. |
| **Migration damages live trading data** | Additive-only rules (§5.1), hand-reviewed SQL, and a `pg_dump` taken before every deploy. CI's rollback restores the image, never the data. §5.3. |
| Report dates shift by 8h on a mis-timezoned tablet | Day-scoped endpoints take `YYYY-MM-DD` and resolve Manila boundaries server-side. See "The business day". |

**Docs to update on completion**
- `docs/lugawjuan-receipt-printer.md` — the two new report slips + the customer receipt.
- New `docs/end-of-day-reports.md` — a one-page, non-technical "how to close the day" for the client (Taglish is fine; she will actually read it).
- `docs/frontend-changes-irene.md` — append the new endpoints.
- New `docs/deployment-runbook.md` — see §5.3.

---

## 5. Production data safety & deployment

**Both stores are trading on this database today. There is no staging copy. Treat every migration as surgery on a live patient.**

### 5.1 Migration rules (non-negotiable)

- **Never** `prisma migrate reset`, `prisma db push`, or any `DROP` / `ALTER … TYPE` / `NOT NULL`-without-default on an existing column.
- Additive only: new tables, new **nullable** columns, or new **`NOT NULL` columns with a default**.
- Never run a seed script against production. `seed-all.ts`, `seed-lugawjuan-products.ts`, `seed-cupofjoy-*.ts` are provisioning tools for a fresh database. They are documented as re-run-safe, but "safe" is not "authorised" — production catalog changes go through the app.
- Review every generated `migration.sql` by hand before it leaves your machine. Prisma's generator has no idea what is destructive to this business.

### 5.2 Is an ETL needed? **No.**

Both planned migrations are additive and existing rows resolve correctly without a backfill:

| Migration | Effect on existing rows | Conflict risk |
|---|---|---|
| `add_sale_discount` | `sales` gains `discount_type` (`NOT NULL DEFAULT 'NONE'`), `discount_amount` (`NOT NULL DEFAULT 0`), and 4 nullable columns. Every historical sale reads as "no discount", which is exactly what it was. | **None.** No backfill, no ETL. |
| `add_recurring_expenses` | New `recurring_expenses` table. `expenses` gains nullable `recurring_expense_id` + unique `(recurring_expense_id, incurred_at)`. Every existing expense has `NULL` there, and Postgres treats NULLs as distinct in a unique index, so unlimited manual rows still work. | **None.** |

The two things that *can* bite, and must be in the migration, not remembered later:

1. **RLS policy on `recurring_expenses`.** Prisma does not emit RLS — every tenant table's policy is hand-written SQL in its migration. Copy the `DO $$ … FOREACH` block from `prisma/migrations/20260721115609_enable_rls_on_menu_tables/migration.sql` verbatim, with `tenant_tables := ARRAY['recurring_expenses']`. **Without it, `organization_id` on that table is decorative and one store's fixed expenses are readable by the other.** Table grants are already automatic (`ALTER DEFAULT PRIVILEGES` in `prisma/rls-setup.sql`); the policy is not.
2. **Index creation locks.** `@@index([organizationId, discountType])` on `sales` takes a brief lock. The table is small (low thousands) so a plain `CREATE INDEX` is fine — but deploy it outside service hours anyway.

### 5.3 Deliverable: `docs/deployment-runbook.md`

Write it for someone SSHing from **Termux on a phone** — short lines, copy-pasteable, no assumed context. It must cover:

**Ground truth about the current pipeline (verify before writing — don't restate this from memory):**
- The backend **already auto-deploys**. `.github/workflows/deploy.yml` triggers on push to `lugawjuan.keepinv.com`: it builds an immutable `sha-<12>` image, pushes to GHCR, SSHes to the VPS, and runs `scripts/deploy-irene-vps.sh`.
- That script **already runs `docker compose run --rm --no-deps tools bunx prisma migrate deploy`** before restarting the API, and has an automatic rollback trap that restores the previous image version on any failure.
- **So the happy path is: push, watch the Action, verify.** The runbook's job is the parts CI does *not* do.
- App dir `/home/ace/docker-apps/keepinv/irene`, compose project `keepinv-lugawjuan`, API container `keepinv-lugawjuan-api-1`, health `https://irene-api.keepinv.com/api/v1/health`.
- Frontend is Vercel CI — nothing manual.

**The runbook must contain:**
1. **Pre-deploy `pg_dump` — the headline.** `scripts/deploy-irene-vps.sh` states outright: *"This intentionally performs no database backup."* The automatic rollback restores the **image**, never the **data**. A migration that corrupts rows is rolled back into a healthy container serving corrupted data. Exact command, where the dump lands, how to verify it is non-empty, and how much disk to expect.
2. Verifying which migrations are pending **before** pushing (`… tools bunx prisma migrate status`).
3. Watching the deploy and reading `docker compose logs --tail=150 api`.
4. Post-deploy verification: health endpoint, `migrate status` clean, one smoke check per shipped workstream (ring up a discounted sale, print a day sheet, confirm fixed expenses posted once).
5. **Restore-from-dump procedure**, written out fully. Untested backups are decoration — include the verification step.
6. Manual fallback if GitHub Actions is down: pull the image by tag, edit `API_VERSION` in `.env`, `migrate deploy`, `up -d --wait api`.
7. Rolling back a **schema** change: what is reversible (both of ours are — the columns are additive and the app tolerates their absence only in the *forward* direction, so document that rollback means restoring the dump, not un-migrating).

Keep it to one page of commands plus a short "if it goes wrong" section. He will be reading it on a phone at closing time.

---

## Decisions (all client questions resolved 2026-08-12)

| # | Question | Decision |
|---|---|---|
| 1 | VAT-registered? | **Non-VAT.** Straight 20%, no VAT lines anywhere. |
| 2 | Custom/promo discount? | **No — SENIOR + PWD only.** Enum carries no `CUSTOM`. |
| 3 | Who prints the day sheet? | **Cashier and owner.** `/end-of-day` in `MEMBER_PATHS`; Inventory tab owner-only. |
| 4 | Seed her fixed expenses? | **No — ship empty, suggest from her own 30-day history.** §4.6. |
| 5 | Print targets? | **58mm only.** No A4 path; Copy-summary is the fallback. |
| 6 | Business day cutoff? | **Midnight Manila, resolved server-side from a `YYYY-MM-DD` param.** |
| 7 | Group-share discount? | **Ship it, defaulted off** (`party 1 / covered 1` = whole bill). §2.6. |

No open questions remain. If a new one appears mid-build, add it here rather than guessing.
