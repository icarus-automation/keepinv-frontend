<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: asset-wise
description: A fast, barcode-driven inventory and point-of-sale tool built for the counter.
---

# Design System: asset-wise

## 1. Overview

**Creative North Star: "The Lit Workbench"**

A clean, brightly lit surface where every tool sits exactly where the hand
reaches for it. The interface behaves like a well-organized parts counter: the
operator is mid-transaction with a customer waiting, a scanner in one hand, and
needs the right part number and price to surface in a fraction of a second.
Nothing decorative competes for that attention. The screen is calm, high
contrast, and dense where density buys speed.

The system commits to one signal color, a warm amber, and otherwise stays in
near-neutral tones tinted slightly warm so the surface never reads as clinical
gray. Amber is the single light on the workbench: it marks the one action that
matters, the current selection, and where focus lives. Its scarcity is what
makes it readable at a glance. Everything else is structure and type.

This system explicitly rejects the clunky legacy ERP look (gray-on-gray, cramped
2010-era forms), the generic SaaS template (purple gradients, identical card
grids, hero-metric dashboards), anything that reads as a toy or consumer app,
and over-animated or flashy motion that would slow a high-volume counter. It is
closer to a well-built terminal or Linear than to a marketing site.

**Key Characteristics:**
- Light, high-contrast surface tuned for bright retail-counter lighting.
- One amber signal accent, on under 10% of any screen.
- Warm-tinted neutrals, never pure `#fff` or `#000`.
- System sans with tabular numerals for prices, quantities, and SKUs.
- Dense but legible; hierarchy stays obvious.
- Responsive, state-only motion; no choreography.

## 2. Colors

A near-neutral, warm-tinted light palette carrying a single amber signal accent.

### Primary
- **Signal Amber** (oklch(72% 0.15 75), approx `#d99a2b`): The one signal on the
  workbench. Used only for the primary action in a flow (confirm sale, complete
  checkout), the current selection, and focus indication. Never decorative,
  never on inactive states. Target under 10% of any screen.
  `[exact ramp to be resolved during implementation]`

### Neutral
- **Ink** (warm near-black, approx oklch(22% 0.01 75)): Primary text and high
  emphasis. Tinted toward the amber hue, never pure black.
- **Counter White** (warm off-white, approx oklch(98% 0.005 75)): The primary
  content surface. Tinted warm, never pure white.
- **Panel** (a second slightly cooler/warmer neutral layer): Sidebars,
  toolbars, and the POS panel, to separate chrome from content.
- **Line** (low-contrast warm gray): Borders, dividers, table rules.
  `[full neutral ramp to be resolved during implementation]`

### Semantic (to standardize during implementation)
- **Success / Error / Warning / Info**: A complete state vocabulary is required
  (sale complete, payment failed, low stock, info). Resolve these as muted,
  high-legibility tones that never compete with Signal Amber for attention.
  `[to be resolved during implementation]`

### Named Rules
**The One Signal Rule.** Amber appears on at most one primary thing per view: the
action that completes the task, the row that is selected, or the field that has
focus. If two amber things compete on a screen, one is wrong.

**The No Pure Extremes Rule.** Never `#fff`, never `#000`. Every neutral is
tinted toward the amber hue (chroma 0.005 to 0.01). A pure-gray surface reads as
legacy ERP.

## 3. Typography

**Display Font:** System sans (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`)
**Body Font:** Same system sans (one family carries everything)
**Numeric:** Same family with tabular figures enforced (`font-variant-numeric: tabular-nums`)

**Character:** One well-tuned system sans, native on every platform, zero font
load, instant render. The personality comes from precision and tabular numerals,
not from a distinctive typeface. Prices, quantities, SKUs, and totals must align
in columns and never shift width as digits change.

### Hierarchy
- **Display** (600, ~1.75rem, 1.1): Screen titles and the running total at the
  POS. Used sparingly.
- **Headline** (600, ~1.25rem, 1.2): Section and panel headers.
- **Title** (500, ~1rem, 1.3): Card and row titles, part names.
- **Body** (400, ~0.875rem, 1.5): Default UI text and prose. Prose capped at
  65 to 75ch; data and tables may run denser.
- **Label** (500, ~0.75rem, 0.02em tracking): Field labels, table headers,
  chips. Sentence case, not all-caps shouting.

Fixed rem scale, not fluid clamps. Scale ratio kept tight (~1.2) since a product
UI has many type elements and exaggerated contrast creates noise.

### Named Rules
**The Tabular Numerals Rule.** Every number that represents money, quantity, or
an identifier uses tabular figures. Columns of prices and counts must align to
the digit. This is non-negotiable; proportional digits in a price column are a
defect.

## 4. Elevation

Flat by default, with tonal layering instead of shadows. Depth is conveyed by
the warm-neutral layers (Counter White content surface against a distinct Panel
neutral for chrome) and by 1px borders, not by drop shadows. Shadows, when they
appear at all, are reserved for genuinely floating surfaces (a dropdown,
a transient popover) and stay soft and shallow. A flat, layered surface reads
faster and avoids the dated-app look.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Separation comes from
tonal neutral layers and hairline borders. A shadow only appears on something
that genuinely floats above the page, never as decoration on a resting card.

## 5. Components

`[No component library exists yet. Components, including the PrimeNG theme preset
and Tailwind token mapping, will be documented on the next scan-mode run once
they are built. The rules below are the direction they must follow.]`

- **Buttons:** One consistent shape and vocabulary across the whole app. Primary
  action carries Signal Amber; everything else is neutral (ghost or outline).
  Full keyboard operability and a clearly visible focus ring at all times.
- **Inputs / Fields:** 1px border, warm-neutral, amber focus ring. The search /
  scan field is the signature input: the barcode scanner is treated as keyboard
  entry, so focus management must guarantee scanned input lands in the right
  field every time.
- **Tables:** The core surface for finding and managing assets. Dense rows,
  tabular numerals, selected row marked with the amber signal, sortable headers,
  fully keyboard navigable.
- **Navigation:** Standard product patterns (top bar and/or side nav). Familiar,
  predictable, never reinvented for flavor.
- Every interactive component ships with the full state set: default, hover,
  focus, active, disabled, loading, error. Loading uses skeletons on content,
  not center-screen spinners on the critical path.

## 6. Do's and Don'ts

### Do:
- **Do** keep Signal Amber on under 10% of any screen, the primary action,
  current selection, and focus only. Its scarcity is the point.
- **Do** tint every neutral toward the amber hue; use a warm off-white surface
  and a warm near-black ink.
- **Do** enforce tabular numerals on every price, quantity, and SKU.
- **Do** make every core action fully operable by keyboard and scanner, with a
  visible focus ring at all times and predictable focus so scanned input never
  lands in the wrong field.
- **Do** keep motion responsive and state-only (150 to 250ms), and respect
  `prefers-reduced-motion`.
- **Do** stay flat by default; separate surfaces with tonal neutral layers and
  hairline borders.

### Don't:
- **Don't** ship the clunky legacy ERP look: no gray-on-gray, no cramped
  2010-era forms, no pure-gray surfaces, no SAP/old-POS-terminal aesthetic.
- **Don't** fall into the generic SaaS template: no purple gradients, no
  identical icon-heading-text card grids, no hero-metric dashboard, no AI-slop
  defaults.
- **Don't** let it read as a toy or consumer app; this handles money and
  inventory and must stay businesslike.
- **Don't** over-animate; no choreographed entrances, no decorative motion, no
  bounce or elastic easing. Motion that slows the counter is a defect.
- **Don't** use `#fff` or `#000` anywhere.
- **Don't** use a colored side-stripe border (`border-left`/`border-right` over
  1px) as an accent, gradient text, or decorative glassmorphism.
- **Don't** use proportional digits in any column of prices or counts.
