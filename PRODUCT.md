# Product

## Register

product

## Users

The primary operator is counter staff at a motorshop that buys and sells motor
parts: a person standing at a point of sale, often mid-transaction, frequently
scanning barcodes rather than typing. Their context is high-volume and
time-pressured; a customer is usually waiting. Secondary users are the shop
owner and back-office staff who manage stock levels, pricing, suppliers, and
look at what sold.

The job to be done: find a part fast, know if it is in stock and at what price,
sell it through the POS, and keep inventory counts honest, all with as little
friction as possible. The product is built to generalize beyond motor parts
into generic asset inventory later, so domain specifics stay configurable rather
than hard-coded.

## Product Purpose

keep inv is an inventory management system with an integrated point of sale.
It exists to make stock and sales operations fast and accurate for small
businesses that move physical goods. It is barcode-driven end to end:
integrated with a barcode scanner for input, an asset/label printer for tagging
stock, and a receipt printer for the POS. Success looks like a counter operator
completing a sale or a stock lookup in seconds without reaching for the mouse,
and inventory counts that stay trustworthy because the fast path is also the
correct path.

## Brand Personality

Fast, precise, dependable. The voice is plain and direct, never chatty. The
interface should feel like a professional tool a working person trusts during a
busy day, closer to a well-built terminal or Linear than to a consumer app. It
earns confidence through speed and clarity, not decoration.

## Anti-references

- **Clunky legacy ERP.** No gray-on-gray density, no cramped 2010-era forms, no
  SAP/old-POS-terminal aesthetic. Efficient does not mean ugly or dated.
- **Generic SaaS template.** No purple gradients, no identical icon-heading-text
  card grids, no hero-metric dashboard cliche, no AI-slop defaults.
- **Toy or consumer app.** This handles money and inventory; it must read as
  serious and businesslike, never game-like or unserious.
- **Over-animated or flashy.** Motion and decoration must never slow the counter
  workflow. Restraint is the default.

## Design Principles

- **The fast path is the correct path.** The quickest way to do a task should
  also be the one that keeps inventory and sales data accurate. Never make
  correctness require extra steps.
- **Scanner and keyboard first, mouse optional.** Every core action must be
  fully operable without the mouse. The barcode scanner is a first-class input,
  treated as keyboard entry that lands where focus expects it.
- **Density with clarity.** Show enough on screen to avoid navigation, but keep
  hierarchy obvious. Information density serves speed; it is not an excuse for
  noise.
- **Built for a waiting customer.** Optimize for the moment a transaction is in
  progress: instant feedback, no blocking spinners on the critical path, errors
  that are recoverable without losing the sale.
- **Generic underneath, specific on top.** Model assets and inventory
  generically so the motorshop is one configuration, not the whole system.

## Accessibility & Inclusion

- Target WCAG 2.1 AA across the board (contrast, focus management, ARIA, color
  not used as the sole signal), consistent with the project's standing
  requirement.
- **Keyboard and scanner operability is non-negotiable.** Full keyboard
  navigation, visible focus states at all times, and predictable focus handling
  so scanner input never lands in the wrong field.
- Maintain strong contrast suitable for brightly lit shop-counter conditions.
- Respect `prefers-reduced-motion`; given the restrained-motion stance, the
  reduced experience should be nearly identical.
