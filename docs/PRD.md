# Product Requirements Document (PRD) — `keep inv`

**Product Name:** keep inv (Asset-Wise Inventory & POS)  
**Target Repository:** `asset-wise-frontend`  
**Document Purpose:** Definitive product requirements, domain model, design specifications, and architecture guide designed as high-context grounding for AI engineering agents and human contributors.  
**Last Updated:** 2026-08-12  

---

## 1. Executive Summary & Vision

### 1.1 Product Vision
`keep inv` is a high-performance, barcode-driven Inventory Management and Point of Sale (POS) application built for businesses that move physical goods. It is engineered from the ground up for high-volume, time-pressured retail and food-service counters where speed, accuracy, and keyboard/scanner operation are non-negotiable.

### 1.2 Core Mission
The primary objective of `keep inv` is to enable a counter operator to complete transactions, look up stock, scan barcodes, apply statutory discounts, and print receipts within seconds—all without touching a mouse. Simultaneously, it maintains strict audit trails for inventory movements, financial margins, and statutory tax compliance.

### 1.3 Key Product Differentiators
- **Barcode & Keyboard First:** The barcode scanner is treated as a primary input device that lands directly into auto-focused fields.
- **The Lit Workbench UX:** A calm, high-contrast, clutter-free workspace that prioritizes information density and operational speed over visual decoration.
- **Historical Margin Accuracy:** Sale-time cost capture guarantees that historical P&L reports remain accurate even when product supplier costs change.
- **Statutory PH Retail Compliance:** Built-in support for statutory Senior Citizen / PWD discounts (RA 9994 / RA 10754) with BIR-compliant ID tracking and restaurant group-bill allocation logic.
- **Generic Core with Specialized Layers:** Generic asset inventory at its foundation, with configurable feature layers for retail scanning, food-service recipes (size × flavor matrices), and multi-branch operations.

---

## 2. User Personas & Operating Context

### 2.1 Primary Operator: Counter Staff / Cashier
- **Environment:** Busy, brightly lit retail counter or food shop (e.g., motor parts shop, drink counter, quick-service food). High foot traffic, waiting customers.
- **Hardware:** Desktop/laptop or touchscreen POS terminal, USB/Bluetooth HID barcode scanner, 58mm ESC/POS Bluetooth thermal receipt printer, Bluetooth label printer (Niimbot).
- **Behavior & Workflow:** Stands mid-transaction, holds a barcode scanner in one hand, taps keyboard shortcuts with the other. Needs split-second stock confirmation, rapid price lookups, instant cart additions, and one-tap receipt issuance.
- **Pain Points:** Slow UI transitions, loss of input focus, blocking spinners, complex multi-step discount forms, and incorrect inventory counts.

### 2.2 Secondary User: Shop Owner & Back-Office Manager
- **Environment:** Back-office laptop or mobile tablet.
- **Behavior & Workflow:** Monitors real-time sales dashboards, manages product catalogs and prices, creates supplier purchase receipts, posts daily/recurring expenses, runs inventory audits, and reviews consolidated multi-store P&L reports.
- **Pain Points:** Distorted profit margins caused by changing supplier costs, manual data entry for fixed operational expenses, difficult end-of-day drawer reconciliation, and unorganized BIR tax records.

---

## 3. Brand Identity & Design System ("The Lit Workbench")

### 3.1 Design Philosophy & Aesthetics
The design system of `keep inv` is codenamed **"The Lit Workbench"**. It mimics a cleanly organized workbench where every tool sits precisely where the hand expects it.

- **Near-Terminal & Linear Aesthetic:** Clean, precise, and businesslike. Rejects generic SaaS tropes (purple gradients, hero card grids, decorative glassmorphism, or AI-generated visual clutter).
- **Flat Elevation:** Surfaces rely on warm-neutral background layers (`Counter White` vs `Panel` chrome) and 1px hairline dividers rather than heavy drop shadows. Drop shadows are strictly reserved for floating popovers and dropdowns.

### 3.2 Color System & The "One Signal" Rule
- **Signal Amber (`oklch(72% 0.15 75)`, `~#d99a2b`):** The single accent color. It represents focus, active row selection, and the primary action in a view (e.g., *Complete Sale*). **Rule:** Signal Amber must occupy under 10% of any screen surface. If two amber elements compete for primary attention, the view is wrong.
- **Warm Neutrals:** Pure `#ffffff` and pure `#000000` are strictly forbidden. All neutrals are subtly warm-tinted to prevent clinical gray ERP aesthetics:
  - **Ink (Text):** Warm near-black (`oklch(22% 0.01 75)`).
  - **Counter White (Surface):** Warm off-white (`oklch(98% 0.005 75)`).
  - **Panel (Chrome):** Distinct warm layer for sidebars and toolbars.
  - **Line:** Low-contrast warm gray hairline rules.

### 3.3 Typography & Non-Negotiable Tabular Numerals
- **Typeface:** Native System Sans (`-apple-system, BlinkMacSystemFont, Segoe UI, system-ui`). Zero font-loading overhead.
- **Tabular Numerals Rule (`font-variant-numeric: tabular-nums`):** Mandatory for all prices, monetary totals, quantities, SKUs, and inventory counts. Digits must align vertically in table columns without shifting horizontal width as values update.

### 3.4 Accessibility (WCAG 2.1 AA)
- High contrast tuned for bright retail lighting conditions.
- Visible focus rings on all interactive elements at all times.
- Full keyboard navigation and predictable focus management.
- Respect for `prefers-reduced-motion` with non-blocking, rapid state transitions (150–250ms max).

---

## 4. System Architecture & Technical Stack

### 4.1 Technology Stack

| Layer | Technology / Library | Version / Details |
|---|---|---|
| **Framework** | Angular | v21.2.0 (Standalone Components natively) |
| **Language** | TypeScript | v5.9.2 (Strict type checking) |
| **State Management** | Angular Signals | `signal()`, `computed()`, `update()`, `OnPush` Change Detection |
| **UI Components** | PrimeNG | v21.1.8 (Used strictly as UI layer, wrapped in custom abstractions) |
| **Styling** | Tailwind CSS / PostCSS | v4.1.12 |
| **Testing** | Vitest & Jsdom | v4.0.8 |
| **Package Manager** | Bun | v1.3.14 |
| **Hardware Printers** | Web Bluetooth (BLE), `@mmote/niimbluelib`, custom ESC/POS | Niimbot label printing & 58mm ESC/POS thermal receipts |

### 4.2 Architectural Rules & Angular v21 Standards
When modifying or extending this codebase, agents MUST comply with the following architectural rules (`.claude/rules/angular-best-practices.md`):

1. **Native Standalone Components:** All components are standalone by default. **DO NOT** add `standalone: true` inside `@Component` decorators (it is redundant in Angular v21+).
2. **Signals Only:** Component state must use `signal()` and derived state must use `computed()`. **DO NOT** use `mutate` on signals; use `update()` or `set()`.
3. **No Host Binding Decorators:** **DO NOT** use `@HostBinding` or `@HostListener`. Place host properties inside the `host: {}` object within the `@Component` or `@Directive` decorator.
4. **Modern Property Decorator Replacements:** Use `input()` and `output()` functions instead of `@Input()` and `@Output()` decorators.
5. **Native Control Flow:** Use `@if`, `@for`, and `@switch` blocks in templates. **DO NOT** use legacy structural directives (`*ngIf`, `*ngFor`).
6. **Class and Style Bindings:** **DO NOT** use `ngClass` or `ngStyle`. Use direct standard `[class]` and `[style]` property bindings.
7. **OnPush Change Detection:** Set `changeDetection: ChangeDetectionStrategy.OnPush` on every component.

---

## 5. Module Map & Functional Specifications

The frontend routing tree (`src/app/app.routes.ts`) defines the core functional domains:

```
src/app/modules/
├── auth/                 # Authentication & Guest Guards
├── locked/               # Account Locked / Subscription Gate Screen
├── dashboard/            # High-level Analytics & Revenue Overview
├── pos/                  # Point of Sale Counter, Sales Ledger, & Reports
├── products/             # Retail Product Catalog & SKU Management
├── menu/                 # Food-Service Menu Groups (Size × Flavor Matrix)
├── ingredients/          # Kitchen Ingredients & Component Tracking
├── stock-movements/      # Stock Movements Ledger (In/Out/Audit/Transfer)
├── stock-movement-types/ # Configurable Movement Types
├── inventory-audit/      # Physical Stock Take & Variance Reconciliation
├── categories/           # Product & Item Categorization
├── suppliers/            # Supplier Records & Purchasing Context
├── locations/            # Storage & Shop Location Management
├── expenses/             # Operational Expense Tracking & Recurring Schedules
├── tools/                # Barcode Sheet Generator & OCR Receipt Scanner
└── settings/             # Organization Preferences & Hardware Config
```

### 5.1 Point of Sale (POS) Module (`/pos`)
- **Interactive Cart & Tender:** High-speed scanner/keyboard product addition, quantity adjustments, item removals, cash/e-wallet tendering, change calculation.
- **Statutory Senior / PWD Discounts (RA 9994 / RA 10754):**
  - Bill-level 20% discount with mandatory ID capture (Customer Name + OSCA/PWD ID Number).
  - Restaurant group-bill allocation formula:  
    $$\text{Covered Base} = \frac{\text{Total Bill}}{\text{Party Size}} \times \text{Covered Persons}$$  
    $$\text{Discount Amount} = \text{Covered Base} \times 0.20$$
  - ID details snapshot saved on sale record and printed on receipt slips.
- **Sale-time Cost Capture:** Captures `totalCost`, `unitCost`, and `lineCost` at the instant of transaction. Ensures historical profit margins stay accurate even when base product cost prices change later in the catalog.
- **Receipt & Thermal Printing:** ESC/POS 32-column slip rendering over Web Bluetooth for 58mm thermal printers (`escpos.ts`, `receipt-printer.service.ts`).
- **Server-side Aggregation:** Direct backend totals retrieval (`GET /pos/sales/summary`) for drawer reconciliation and Z-read closing sheets.

### 5.2 Catalog & Product Management (`/products`, `/menu`, `/ingredients`)
- **Retail Catalog (`/products`):** Barcode tagging, SKU generation, cost price, selling price, reorder points, location mapping, unit stock management.
- **Drink & Flavor Matrix (`/menu`):** Dual-axis menu configuration (Size × Flavor) for beverage/food service (e.g., Milktea, Coffee). Supports standalone retail items alongside menu groups.
- **Kitchen Ingredients (`/ingredients`):** Separate management of raw ingredients and stock-only components (`ProductComponent`, `isStockOnly`, `isStockTracked`) mapped to recipe output items.

### 5.3 Stock Movements & Inventory Audits (`/stock-movements`, `/inventory-audit`)
- **Stock Movement Ledger:** Complete audit trail of stock adjustments (Purchase Receive, Waste/Damage, Theft, Transfer, Audit Correction).
- **Inventory Audit Tool:** Physical stock count entry, automated variance calculation (Expected vs Actual), and instant inventory ledger adjustment.

### 5.4 Expenses & Financial Reporting (`/expenses`, `/reports`)
- **Manual & Recurring Expenses:** Track operational costs (Rent, Utilities, Payroll, Daily Deliveries). Supports recurring template posting (Daily/Weekly/Monthly) with back-fill capability.
- **Sales Reports & Profit Margin Analysis:** Real-time Gross Sales, Statutory Discounts, Net Revenue, COGS (derived from sale-time cost capture), and Net Profit calculations.
- **End-of-Day (Z-Read) Reports:** Consolidated daily sales summary, payment breakdowns, cash-to-remit figures, and inventory closing sheets (`GET /reports/inventory-close`).

### 5.5 Tools & Utilities (`/tools`)
- **Barcode Sheet Generator (`/tools/barcode-sheet`):** Select catalog items to generate printable sheets of scannable barcodes (using JsBarcode & pdf export).
- **AI Receipt Scanner (`/tools/scan-receipt`):** PRO-tier feature to scan paper vendor receipts and automatically populate inventory/expense entries.

### 5.6 Entitlements & Subscription Tiers (`src/common/entitlements/`)
The frontend dynamically hydrates plan capabilities from `GET /entitlements`:
- **BASIC Plan:** Core Inventory Management, Stock Movements, Manual Expenses.
- **PRO Plan:** Point of Sale (POS), Barcode Sheet Generator, AI Receipt Scanner, Multi-store Consolidation.
- **Printer Configuration:** `NONE` | `NIIMBOT` | ESC/POS Bluetooth.

---

## 6. Multi-Tenant SaaS vs. Dedicated Client Deployments

The core codebase (`main` / `master`) is designed as a **Multi-Tenant SaaS**.

> [!IMPORTANT]
> **Generalization Principle for AI Agents:**  
> When adopting features tested in dedicated client branches (e.g., `lugawjuan.keepinv.com`), **NEVER** copy hardcoded tenant IDs, client-specific constants, or hardcoded RBAC rules. All features must be gated behind Organization Settings, Plan Entitlements (`EntitlementsService`), or User Permissions.

### Feature Adoption Strategy & Tiers

| Tier | Feature / Requirement | Core Justification & Architectural Rule |
|---|---|---|
| **Tier 1 (Immediate)** | **Sale-time Cost Capture** | Fixes historical profit corruption. Must read captured cost in reports. |
| **Tier 1 (Immediate)** | **Server-side Sales Summary** | Replaces multi-request client-side fanout (`/pos/sales/summary`). |
| **Tier 1 (Immediate)** | **Senior / PWD Discount** | Legal requirement (RA 9994/10754). Gated by org VAT/discount settings. |
| **Tier 1 (Immediate)** | **Recurring Expenses** | Idempotent daily/weekly/monthly template posting for accurate net P&L. |
| **Tier 2 (Secondary)** | **End-of-Day Reports** | Printable Z-Read sheets and inventory closing sheets (`/reports/inventory-close`). |
| **Tier 2 (Secondary)** | **BLE Thermal Receipt Printing** | Generic ESC/POS transport over Web Bluetooth with system print fallback. |
| **Tier 2 (Secondary)** | **Multi-Store Switcher** | Store switcher header + consolidated multi-branch P&L roll-up. |
| **Tier 3 (Optional)** | **Food Service Recipes & Flavors** | Gated behind the `foodService` entitlement flag. |

---

## 7. Guidelines for AI Agents Working on This Codebase

When executing tasks, writing code, or creating pull requests for `asset-wise-frontend`, AI agents MUST adhere to these operational guidelines:

1. **Consult Project Documents:** Read `CLAUDE.md`, `DESIGN.md`, `PRODUCT.md`, and `.claude/rules/angular-best-practices.md` before making code changes.
2. **Verify Correctness Over Assumptions:** Never guess component paths or service signatures. Inspect the actual source files first.
3. **Preserve Design Integrity:** Strictly enforce the "Lit Workbench" rules: Signal Amber < 10%, warm neutrals only, `tabular-nums` on all figures, keyboard/scanner focus preserved.
4. **Zero Symptom Patching:** Do not wrap missing backend data in silent try-catch blocks or return fake fallbacks. Trace and fix the root data provider.
5. **Run Verification Commands:** Always execute `ng build` and `ng test` (Vitest) after modifying code to verify build integrity and test passes.
