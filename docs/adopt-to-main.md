# Adopt to `main` — what the LugawJuan branch proved, and why the product should keep it

**Status:** proposal. **Nothing in this document has been implemented on `master` / `main`.**
**Source branch:** `lugawjuan.keepinv.com` (frontend `master` ← , backend `main` ←).
**Date:** 2026-08-12

Two things drive this list:

1. **Client-originated ideas.** Irene runs two real shops on this software daily. Her feedback (Aug 2026) surfaced requirements that are not LugawJuan-specific — they are Philippine retail table stakes. The Senior/PWD discount is not a feature request; it is **RA 9994 / RA 10754**. Any PH tenant that serves a senior and cannot apply 20% is operating illegally. Shipping that only to one dedicated deployment is leaving the product legally unusable for the rest of the market.
2. **Correctness fixes discovered while building for her.** Two of these are live defects on `main` today (§T1.2, §T1.3). They should be adopted regardless of the feature roadmap.

Generalization rule for everything below: `main` is a **multi-tenant SaaS**; the lugaw branch is a **dedicated single-client deployment** where hardcoding was correct. Nothing gets copied verbatim. Every item ships behind an org setting, an entitlement, or a plan flag.

---

## Tier 1 — Adopt now

### T1.1 · Senior Citizen / PWD discount (statutory)

**What.** Bill-level discount on a sale: type (`SENIOR` / `PWD` / `CUSTOM`), snapshotted rate, computed amount, and the ID capture (name + OSCA/PWD number) the BIR requires on the receipt and in a separate sales log. Group bills use the restaurant share rule (`bill ÷ persons × covered`, BIR RMC 38-2012).

**Why adopt.**
- **Legal.** Without it, no PH retail or food tenant can transact compliantly. This is the single highest-value item on the list and it is not close.
- **Revenue.** It removes a hard disqualifier in every sales conversation with a PH SME. "Wala kayong senior discount?" ends the demo.
- **Reporting integrity.** Discounts must reduce revenue, not COGS. Building it later, after tenants have sales history, means a migration over live money. Building it now is one additive migration over near-zero data.
- **Audit.** The senior/PWD log is a book the BIR asks for. Being the POS that just prints it is a genuine differentiator against the spreadsheet the shop uses today.

**Where it lives (once built).** `prisma/schema.prisma` (`SaleDiscountType`, `Sale.discount*`), `pos.service.ts#calculateTotals`, `checkout-pos.dto.ts`, `pos/types/pos.types.ts`, FE `pos.ts` / `pos.html` / `receipt.html`.

**Generalize by.** The lugaw branch deliberately ships the narrowest version — **SENIOR + PWD only, non-VAT, rate hardcoded at 20%** — because both its shops are non-VAT and its owner does not want cashiers discounting freely. `main` needs three things it will not inherit:

- `Organization.isVatRegistered` → drives the VAT-exempt treatment of the covered portion. A VAT-registered tenant gets materially different receipt maths, and getting it wrong is a BIR finding.
- `Organization.statutoryDiscountRate` (default `0.20`) → a statutory rate change becomes config, not a deploy.
- A `CUSTOM` discount type + a `discount:apply` permission, so owners who *do* want promo discounts can have them and owners who don't can lock cashiers out.

Everything else — the group-share formula, the ID capture, the server-authoritative computation, the discount log — ports directly.

**Effort:** L · **Risk:** low (additive migration, defaults preserve current behaviour) · **Blast radius:** POS checkout, receipts, sales summary, P&L revenue.

---

### T1.2 · Sale-time cost capture — **`main` has a correctness bug**

**What.** `Sale.totalCost`, `SaleItem.unitCost`, `SaleItem.lineCost`, written at checkout from the product's cost *at that moment*.

**Why adopt.** On `main`, `ReportsService.buildMargins` computes COGS as `item.product.costPrice × quantity` — the product's **current** cost (`reports.service.ts:163` on `main`). Editing a product's cost price silently **rewrites every historical profit number**. A tenant who raises a cost in August sees July's profit change. That is not a rounding concern; it is a report nobody can trust, and it is invisible until an owner notices their margins moved on their own.

The lugaw branch already captures cost at sale time in the schema — but note **its reports still read `product.costPrice`** (`reports.service.ts:201`, with a comment admitting it). So the fix is two-part and neither branch has finished it:

1. Capture at sale time (lugaw branch: done; `main`: missing).
2. **Read the captured cost in the reports** (neither branch: do this as part of adoption).

**Generalize by.** Nothing tenant-specific. Migrate with a backfill that sets historical `lineCost` from current cost — imperfect but explicitly one-time and documented, versus wrong forever.

**Effort:** S–M · **Risk:** low · **Value:** high. Adopt this even if nothing else on this list ships.

---

### T1.3 · `GET /pos/sales/summary` — server-side totals

**What.** DB-aggregated totals (gross, count, items sold, payment split, voids) for exactly the filter set the ledger lists.

**Why adopt.** `main`'s sales report aggregates **client-side**: `SalesReportService.loadRange` fetches page 1, then fans out up to **60 more requests of 50 rows** and concatenates — ~3,000 sales max, with a `truncated` flag when it clips. That is 61 HTTP round trips to render one number, it silently under-reports past the ceiling, and it will not survive a tenant with real volume. The lugaw branch replaced it with one `groupBy`.

Second reason: the counter needs a drawer-reconciliation figure that a cashier can reach. `main` has no such surface, so closing the till means adding rows on a calculator.

**Generalize by.** Straight port. Keep it on the POS controller (staff-reachable, takings only, no cost/margin) — that boundary is already documented and is the right one. Then delete `SalesReportService.loadRange` and point the report at the endpoint.

**Effort:** S · **Risk:** low · **Also fixes:** a latent performance cliff.

---

### T1.4 · Recurring / fixed expenses

**What.** `RecurringExpense` templates (daily / weekly / monthly) + idempotent posting that back-fills missed days, keyed `(recurringExpenseId, incurredAt)`.

**Why adopt.** Every business has fixed costs — rent, salaries, subscriptions, daily deliveries. `main`'s expenses module is manual-entry only, so the P&L is only as accurate as the owner's discipline, and in practice the fixed costs get entered in a lump at month-end or not at all. That makes **net profit — the number the whole reports module exists to produce — quietly wrong for most tenants.** Cheap to build, compounding in value.

Client's own words: *"mejo hassle if we input every day."* She is describing why the data is bad, not just why she is tired.

**Generalize by.** Port as-is; it is already tenant-scoped and category-driven. Do **not** add a cron for this — the lazy, idempotent, back-filling POST is deliberately the more robust design for single-VPS deployments and it degrades gracefully. If `main` later gains a scheduler, the same service method becomes the job body with zero changes.

**Effort:** M · **Risk:** low (one additive table, RLS policy required).

---

## Tier 2 — Adopt soon

### T2.1 · End-of-day reports (sales sheet + inventory count sheet)

**What.** `GET /pos/sales/day-report` (Z-read: gross → discounts → net, payment split, per-cashier, voids, top items, cash-to-remit, sign-off block) and `GET /reports/inventory-close` (per item: opening / in / out / sold / closing, derived from the movement ledger).

**Why adopt.** "Close the day and hand a sheet to whoever counts the money" is the universal end of every retail shift; it is also the moment an owner decides whether the software is worth paying for. `main` today can show an owner a dashboard but cannot produce **an artifact**. The inventory sheet also removes the exact complaint the client made — *"I need to check isa-isa, and takes a lot of time"* — which is a per-item click cost that every tenant with more than 20 SKUs pays daily.

**Generalize by.** `main` supports serialized inventory (RFID/units) which the lugaw branch disabled. The inventory sheet must sum **both** product quantities and on-hand `ProductUnit` rows — `ReportsService.buildByLocation` (`reports.service.ts:451`) already shows the correct double-count-safe pattern; reuse it. Per-cashier breakdown is already possible on `main` (sales carry `cashier`).

**Effort:** L · **Risk:** low (read-only).

---

### T2.2 · ESC/POS receipt printing over Web Bluetooth

**What.** `escpos.ts` (32-col builder), `receipt-printer.service.ts` (BLE transport, chunked writes, silent reconnect via `navigator.bluetooth.getDevices`), slip renderers.

**Why adopt.** `main` prints **labels** (Niimbot) but cannot print a **receipt**. Customers ask for receipts; the BIR expects them; a POS that cannot print one is a demo, not a POS. The transport here is genuinely hard-won — the "accept any device, then find the one writable characteristic anywhere on it" discovery in `discoverWriteCharacteristic` is what makes the cheap 58mm printers on Lazada work, and that knowledge should not stay on one branch.

**Generalize by.** The slip *renderers* are LugawJuan-shaped (kitchen slip, queue stub, `"Salamat po!"`). Port the **transport and builder as-is**; ship a generic `renderCustomerReceipt` on `main` and keep kitchen/queue slips as a food-service option. Extend `Organization.printerType` (already an enum: `NONE | NIIMBOT`) with a receipt-printer setting rather than assuming.

**Effort:** M · **Risk:** medium (Web Bluetooth is Chromium + HTTPS only — needs the documented system-print fallback, which already exists at `pos.ts:857`).

---

### T2.3 · Daily order numbers

**What.** `receiptSnapshot.orderNo` = 1 + sales completed this Manila day, computed inside the checkout transaction (`pos.service.ts#nextOrderNo`).

**Why adopt.** No migration (it lives in the JSON snapshot), ~20 lines, and it converts a 24-character receipt number into something a human can shout across a counter. Small, and one of the most-noticed things in the shop.

**Generalize by.** The Manila-midnight assumption must become the org's timezone once `main` serves tenants outside PH. Extract a shared day helper rather than porting the inline `MANILA_UTC_OFFSET_MS` constant. Note the documented race (two concurrent checkouts can collide on the count) — fine for one tablet, **not** fine for a multi-lane `main` tenant. Adopt with a unique index or a sequence, not the `count()`.

**Effort:** S · **Risk:** low, **but do not port the race.**

---

### T2.4 · Multi-store switcher

**What.** Org list + `set-active` + a header switcher, plus `GET /reports/consolidated` (per-store P&L + combined roll-up, scoped to the caller's own owner/admin memberships).

**Why adopt.** `main` assumes one active org per user. Any customer who opens a second branch — the natural growth path for exactly the SMEs this targets — hits a wall. The consolidated report is also the most compelling owner screen either branch has: *"which of my shops is doing better"* answered in one view, without switching context.

**Generalize by.** Re-enable `allowUserToCreateOrganization` (the lugaw branch disables it on purpose for a dedicated deployment). Keep the authorization boundary exactly as written — the store set is derived **only** from the caller's own memberships, never from client input (`reports.service.ts:116`). That detail is what makes the cross-tenant query safe; do not "simplify" it.

**Effort:** M · **Risk:** medium (auth surface — review carefully).

---

## Tier 3 — Adopt behind a capability flag (food service)

`main` today models **retail / asset inventory**. These turn it into a food-service POS. Real market expansion, but they add concepts every existing tenant would otherwise have to ignore. Gate them on a plan/entitlement (`foodService`), not on a hardcoded tenant.

### T3.1 · Recipes — `ProductComponent`, `isStockOnly`, `isStockTracked`

Selling one bowl deducts a cup + toppings from shared pools; availability = the scarcest ingredient (`pos.service.ts#productAvailability`). `main` has none of this — every sellable thing must hold its own count, which is false for any prepared food. This is the piece that makes inventory *honest* for a kitchen: the only rows with a real count are the things you actually buy.

`isStockTracked = false` (a refill: sale recorded, nothing deducted) is a small idea that solves a real problem cleanly and is worth having on `main` even without full recipes.

**Effort:** L · **Risk:** medium (touches product validation, POS availability, voids/restock).

### T3.2 · Menu groups + flavors (size × flavor ordering)

38 flavors × 6 sizes as **two axes instead of 228 products**. Adding a flavor is one row; a price change is one edit. For any drinks/food tenant this is the difference between a usable catalog and an unusable one.

**Adopt the fix, not the bug.** The drinks POS on the lugaw branch *replaces* the product grid whenever a tenant has any menu group (`pos.ts:129`, `:283`), which makes every non-menu product unsellable at the counter — this is the live defect behind the client's complaint #3. If menus are adopted, adopt the coexistence fix (drinks picker **and** an "Others" list) in the same change. Also adopt the guard that a menu group with no sizes or no live flavors never reaches the counter.

**Effort:** L · **Risk:** medium.

### T3.3 · Ingredients screen (kitchen stock split from sellable catalog)

Splitting `/products` (sellable) from `/ingredients` (kitchen stock) is what makes a 200-row catalog navigable for a cook. Depends on T3.1.

**Effort:** M · **Risk:** low.

---

## Do **not** adopt

| Thing | Why not |
|---|---|
| Hardcoded org IDs (`seed-constants.ts`, `CUPOFJOY_ORGANIZATION_ID`) and the per-store seed scripts | Dedicated-deployment artifacts. `main` provisions tenants dynamically. |
| RBAC narrowed to "member = POS only" | Correct for one client's staff; `main` needs configurable roles, not a hardcoded policy. |
| `allowUserToCreateOrganization: false` | Deliberate lockdown for a dedicated deploy; the opposite of what SaaS needs. |
| `SCANNER_FIRST = false` (`pos.ts:80`) | Tuned for a touch-only tablet with no scanner. `main` must keep scanner-first focus, or make it an org setting. |
| Nav renames — "Menu Items", "Menu & Flavors" | LugawJuan vocabulary. `main` says Products. |
| LugawJuan copy — `"Salamat po!"`, kitchen-slip wording, category palette | Tenant branding. |
| `environment.prod.ts` API host, Caddyfile, `deploy-irene-vps.sh` | Deployment-specific. |

---

## Suggested sequencing

| PR | Contents | Why this order |
|---|---|---|
| 1 | **T1.2** sale-time cost + reports read captured cost | Standalone bug fix, no feature coupling, unblocks trustworthy margins. |
| 2 | **T1.3** `/pos/sales/summary`, delete client-side aggregation | Small, removes a performance cliff, needed by the day report. |
| 3 | **T1.1** Senior/PWD discount (+ org VAT/rate settings) | The legal blocker. Depends on nothing above but wants #2 for reporting. |
| 4 | **T1.4** recurring expenses | Independent; makes net profit real. |
| 5 | **T2.1** end-of-day sheets | Needs #2 and #3 to print correct numbers. |
| 6 | **T2.3** order numbers (with a proper sequence), **T2.2** receipt printing | Printing wants the customer-receipt renderer from #3. |
| 7 | **T2.4** multi-store | Independent; schedule by demand. |
| 8 | **T3.x** food-service behind an entitlement | Only when a food-service customer is actually in the pipeline. |

---

## Open questions

1. Is `main` targeting **PH-only** tenants? If yes, T1.1 is mandatory, not Tier 1 — it's a launch blocker.
2. Does `main` have live tenants with sales history? Decides whether T1.2's backfill needs a communicated caveat.
3. Is multi-branch (T2.4) already being asked for by anyone on `main`, or speculative?
4. Is food service (T3.x) a target market, or is `main` staying retail/asset inventory?
5. Who owns the `main` roadmap — is this list a proposal to someone, or self-directed?
