# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary operator is counter staff at a motorshop that buys and sells motor
parts: a person standing at a point of sale, often mid-transaction, frequently
scanning barcodes or RFID tags rather than typing. Their context is
high-volume and time-pressured; a customer is usually waiting. Secondary
users are the shop owner and back-office staff who manage stock levels,
pricing, suppliers, and look at what sold. The product is multi-tenant: each
shop is an organization with its own plan, users, and settings.

The job to be done: find a part fast, know if it is in stock and at what
price, sell it through the POS, and keep inventory counts honest, all with as
little friction as possible. The product is built to generalize beyond motor
parts into generic asset inventory later, so domain specifics stay
configurable rather than hard-coded.

## Product Purpose

keep inv is an inventory management system with an integrated point of sale.
It exists to make stock and sales operations fast and accurate for small
businesses that move physical goods. It is barcode- and RFID-driven end to
end: integrated with barcode/RFID scanning for input, an asset/label printer
for tagging stock, and a receipt printer for the POS. Success looks like a
counter operator completing a sale or a stock lookup in seconds without
reaching for the mouse, and inventory counts that stay trustworthy because
the fast path is also the correct path.

## Positioning

RFID as the first-class input for serialized inventory — commission a unit
once by its EPC tag, then sweep shelves to audit or find it in seconds — with
barcode as the universal fallback for lookup, sale, and printed
labels/receipts. One generic asset model underneath lets the same system
serve motor parts today and other serialized/physical-goods domains later
without a rewrite.

## Operating Context

- **Shop counter, bright lighting, customer waiting.** The physical setting
  is a retail counter, not an office desk; a transaction is usually in
  progress.
- **RFID sweep sessions.** Inventory audits are a heads-down, focused task:
  the operator sweeps shelves with an RFID reader and the UI takes over the
  view for the duration of the sweep.
- **Unit commissioning.** New serialized product units are registered by
  capturing their RFID EPC tag (with serial number / asset tag as fallback
  identifiers), one focused session per batch.
- **Label printer pairing.** Tenants configure a physical printer (NIIMBOT,
  paired over Bluetooth) for on-demand label printing; printing capability
  depends on this device config, not on plan.
- **Receipt import review.** Paper receipts are scanned/photographed and
  parsed for review before committing to inventory (PRO-only).
- **Printable barcode sheets.** A PDF barcode-sheet export exists for shops
  without a configured label printer (PRO-only).

## Capabilities and Constraints

- **Multi-tenant SaaS with two plans.** BASIC = inventory only. PRO = POS +
  inventory. RFID and barcode scanning are baseline on both plans.
- **Feature gates beyond the plan.** Label printing depends on the tenant's
  configured printer type, independent of plan. Receipt scanning and the
  barcode-sheet PDF export are PRO-only.
- **Trial and lockout.** Tenants have a trial period (active/expired) and a
  `locked` state. Paid features fail closed (e.g. POS hidden); the lockout
  check itself fails open, so a network blip must never lock out a paying
  tenant.
- **Generic underneath, domain-specific on top.** Asset/inventory modeling
  must stay configurable so the motorshop is one configuration, not the
  whole system, since the product is meant to generalize to other physical-
  goods domains later.

## Brand Commitments

- **Name:** keep inv (package name `keep-inv`).
- **Voice:** plain and direct, never chatty.
- **Reference (explicitly binding):** closer to a well-built terminal or
  Linear than to a consumer app. Earns confidence through speed and clarity,
  not decoration.

## Evidence on Hand

Real paying tenant(s) are using the product day-to-day. No formal case study
or testimonial has been written yet — future work must not fabricate
customer names, logos, or quotes.

## Product Principles

- **The fast path is the correct path.** The quickest way to do a task
  should also be the one that keeps inventory and sales data accurate. Never
  make correctness require extra steps.
- **Scanner and keyboard first, mouse optional.** Every core action must be
  fully operable without the mouse. RFID and barcode are both first-class
  inputs, treated as keyboard entry that lands where focus expects it.
- **Density with clarity.** Show enough on screen to avoid navigation, but
  keep hierarchy obvious. Information density serves speed; it is not an
  excuse for noise.
- **Built for a waiting customer, restraint over decoration.** Instant
  feedback, no blocking spinners on the critical path, motion that never
  slows the counter workflow, and errors that are recoverable without losing
  the sale.
- **Serious tool, not a toy.** This handles money and inventory; it must
  read as businesslike, never game-like or unserious.
- **Generic underneath, specific on top.** Model assets and inventory
  generically so the motorshop is one configuration, not the whole system.
- **Borrow IA, not chrome, from known enterprise/POS systems.** A planned
  redesign will pattern menu structure, field placement, and workflow order
  after systems staff already know (working example TBD via research) so
  new hires transfer intuition instead of relearning it. This is about
  information architecture and interaction patterns only, never visual skin
  — the "no legacy-ERP look" ban in DESIGN.md stays in force. Credit the
  specific inspiration once chosen (e.g. in docs or an about page). Not yet
  implemented as of this writing.

## Accessibility & Inclusion

- Target WCAG 2.1 AA across the board (contrast, focus management, ARIA,
  color not used as the sole signal), consistent with the project's standing
  requirement.
- **Keyboard and scanner operability is non-negotiable.** Full keyboard
  navigation, visible focus states at all times, and predictable focus
  handling so scanned input never lands in the wrong field.
- Maintain strong contrast suitable for brightly lit shop-counter conditions.
- Respect `prefers-reduced-motion`; given the restrained-motion stance, the
  reduced experience should be nearly identical.
