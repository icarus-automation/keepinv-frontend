# Frontend handoff — Irene multi-store release

Backend branch `lugawjuan.keepinv.com` was reworked from a generic single-shop SaaS tenant into a
**dedicated deployment for one client (Irene) who runs two stores** (lugaw + milktea) as two
organizations. This document is everything the frontend needs to adapt **without opening the backend
repo**. All paths below are relative to the API base URL (e.g. `https://irene-api.keepinv.com/api/v1`).

> Everything is wrapped in the usual `ApiResponse` envelope (`{ data, ... }`) except Better Auth's
> own `/auth/*` routes, which return their payload directly — unchanged from today.

---

## TL;DR — what breaks if the FE does nothing

1. **API domain changes** (env var). See §1.
2. **Staff (org role `member`) now get HTTP 403 on every non-POS endpoint.** Their nav/routes must be
   restricted to POS only, or the app throws errors on load. See §2. **This is the biggest change.**
3. **`PaymentMethod` reduced to 3 values** — `CARD`, `MAYA`, `OTHER` removed. See §5.
4. Irene owns **two** organizations; the app currently assumes one. Needs an org switcher. See §3.
5. New **consolidated cross-store report** endpoint for the owner. See §4.
6. Creating organizations from the app is now **disabled** server-side. See §3.

---

## 1. New API base URL

After the domain cutover the API moves host:

| | Old | New |
|---|---|---|
| API | `https://lugawjuan-api.keepinv.com/api/v1` | `https://irene-api.keepinv.com/api/v1` |
| App | `https://lugawjuan.keepinv.com` | `https://irene.keepinv.com` |

Change `src/environments/environment.prod.ts` → `apiBaseUrl`. Both hosts work during cutover; flip when
DNS is live. (The git branch name stays `lugawjuan.keepinv.com` — ignore it, it is internal.)

---

## 2. RBAC — staff are POS-only (HTTP 403 elsewhere)

Two **organization** roles now decide what a user may reach (this is the org membership role from
`organizationService.myRole()`, NOT the platform `AuthUser.role`):

- **`owner` / `admin`** → full access, every screen.
- **`member`** → **cashier / staff. POS only.** Every non-POS endpoint returns **403**.

### Endpoints now restricted to owner/admin (→ 403 for `member`)

`products` · `categories` · `locations` · `suppliers` (+ `suppliers/:id/links`) · `stock-movements` ·
`stock-movement-types` · `product-units` · `inventory-audits` · `expenses` · `expense-categories` ·
`reports/*` (inventory dashboard, profit-loss, consolidated) · `users` · `organizations` (settings/logo) ·
`receipt-imports` · `platform/*`.

### Still allowed for `member` (the POS surface)

- `pos/*` — `search-items`, `products/:id/units`, `checkout`, `sales` (list), `sales/:id`, `sales/:id/void`
- `entitlements`
- `auth/*` — sign-in, get-session, sign-out, and `auth/organization/*` (active org, get-full-organization)

### Frontend actions

- **Nav (`layout.ts`):** today `navSections` filters only by POS entitlement (`POS_PATHS`). Add a role
  filter: when `myRole() === 'member'`, render **only the "Point of Sale" item** — hide Overview/Dashboard,
  Sales, Sales Report, Inventory Audit, Stock Movements, the whole Catalog and Finance sections, Tools, and
  admin Settings.
- **Route guards:** add a guard so a `member` deep-linking to `/products`, `/reports`, etc. is redirected to
  `/pos`. Don't rely on hiding nav alone — the API enforces it, so an ungated route just shows a broken
  403 page.
- **Default landing route** for a `member` = `/pos`.
- Treat a `403` from any admin endpoint as "not permitted" (route away / hide), not as a fatal error toast.

> Boundary note: the sales-history list (`GET /pos/sales`) and void (`POST /pos/sales/:id/void`) are on the
> POS controller, so they remain reachable by `member`. If the client wants cashiers to run checkouts only
> (no history / no voids), that must be decided — flag it. The nav change above already hides the separate
> "Sales" and "Sales Report" pages from staff.

---

## 3. Multi-store owner (Irene owns two organizations)

The app currently hydrates one active org (`OrganizationService`) and assumes a fixed single shop. Irene is
an **`owner` member of both** stores and needs to move between them.

- **List her stores:** `GET /auth/organization/list` → array of organizations the signed-in user belongs to.
- **Switch active store:** `POST /auth/organization/set-active` with body `{ organizationId }`. The active
  org lives in the session cookie; after switching, re-run `GET /auth/organization/get-full-organization`
  and reload the current screen's data. All existing per-org screens then follow the new active org — no
  other change needed.
- Add a store switcher in the shell (only show it when `organization/list` returns > 1 org, so staff/single
  -store users are unaffected).
- **Org creation is disabled server-side** (`allowUserToCreateOrganization: false`). `POST
  /auth/organization/create` now errors. Remove/hide any "create organization" affordance (there likely
  isn't one). Provisioning of the two stores is done by the operator.

---

## 4. Consolidated cross-store report (NEW)

`GET /reports/consolidated?from=<ISO>&to=<ISO>` — **owner/admin only.** Same date-window rules as
`/reports/profit-loss` (both default to month-to-date when `from`/`to` are omitted). Aggregates the stores
the caller owns/administers server-side, so **no org switching is needed** to build the overview.

Response `data`:

```jsonc
{
  "from": "2026-07-01T00:00:00.000Z",
  "to":   "2026-07-19T00:00:00.000Z",
  "stores": [                    // one row per store; sorted by netProfit DESC (best-performing first)
    {
      "organizationId": "…",
      "organizationName": "LugawJuan",
      "slug": "lugawjuan",
      "revenue": 12500,
      "cogs": 4200,
      "grossProfit": 8300,
      "totalExpenses": 3000,
      "netProfit": 5300,
      "salesCount": 87
    }
  ],
  "combined": {                  // roll-up across all stores
    "revenue": 0, "cogs": 0, "grossProfit": 0,
    "totalExpenses": 0, "netProfit": 0, "salesCount": 0, "storeCount": 2
  }
}
```

All money fields are **plain numbers in pesos** (not decimal strings — matches the existing profit-loss
report). Suggested UI: an owner dashboard with a P&L card per store, a combined total, and a "which store is
doing better" highlight (`stores[0]` is the leader). Per-store drill-down (top products, margins, expense
breakdown) still comes from `GET /reports/profit-loss` with that store active.

---

## 5. PaymentMethod reduced to three values

Backend enum is now **`CASH`, `GCASH`, `BANK_TRANSFER`** only (`CARD`, `MAYA`, `OTHER` removed).

In `src/app/modules/pos/types/pos.types.ts`:

- `PaymentMethod` type → `'CASH' | 'GCASH' | 'BANK_TRANSFER'`.
- `PAYMENT_METHODS` → delete the `CARD`, `MAYA`, and `OTHER` rows (keep Cash first as default).
- `paymentMethodMeta()` already falls back to Cash for unknown values, so nothing crashes even if a legacy
  value ever appears. (This deployment starts on a fresh DB, so no historical sale uses a removed value.)

Checkout and the sales/report filters then only offer the three supported methods.

---

## 6. Cashier on duty — already supported, just surface it

**No breaking change.** Every checkout already records the signed-in user as the sale's cashier, and the
data is already in responses:

- `GET /pos/sales` (list) and `GET /pos/sales/:id`: each sale has `cashier { id, name, email, role }` (and
  `voidedBy { … }` when voided).
- Receipt snapshot: `receiptData.cashier { id, name, email }`.
- Filter by cashier: `GET /pos/sales?cashierId=<uuid>`.

Optional FE work (value-add for the owner): show the cashier name on the sales list / receipt, and add a
"cashier on duty" filter to the sales report so the owner can see who handled each transaction. There is no
shift / clock-in concept — attribution is per sale.

---

## 7. Unchanged

POS checkout contract, the `ApiResponse` envelope, money-as-decimal-string on POS payloads, entitlements,
and all existing admin DTOs are unchanged. Only the six items above need frontend work.
