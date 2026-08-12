---
name: keep inv
description: A fast, RFID- and barcode-driven inventory and point-of-sale tool built for the counter.
colors:
  counter: "oklch(98% 0.006 75)"
  panel: "oklch(96.2% 0.007 75)"
  ink: "oklch(24% 0.014 75)"
  muted: "oklch(50% 0.014 75)"
  line: "oklch(90% 0.008 75)"
  field: "oklch(62% 0.013 75)"
  signal: "oklch(72% 0.15 75)"
  signal-hover: "oklch(66% 0.155 75)"
  danger: "oklch(52% 0.17 27)"
  success: "oklch(53% 0.13 150)"
  info: "oklch(54% 0.13 264)"
  brand: "oklch(52% 0.15 148)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.1
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.03em"
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
  full: "9999px"
spacing:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  button-primary-hover:
    backgroundColor: "{colors.signal-hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  input-field:
    backgroundColor: "{colors.counter}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  card:
    backgroundColor: "{colors.counter}"
    rounded: "{rounded.lg}"
---

# Design System: keep inv

## Overview

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
makes it readable at a glance. Everything else is structure and type. A single
quiet green ("brand") appears only in the "keep" wordmark — identity, never an
interactive signal, so amber's exclusivity as the one actionable color holds.

This system explicitly rejects the clunky legacy ERP look (gray-on-gray,
cramped 2010-era forms), the generic SaaS template (purple gradients, identical
card grids, hero-metric dashboards), anything that reads as a toy or consumer
app, and over-animated or flashy motion that would slow a high-volume counter.
It is closer to a well-built terminal or Linear than to a marketing site. The
implementation confirms the seed direction and adds one real refinement: even
elevation stays warm — floating shadows are tinted with Ink, not generic black.

**Key Characteristics:**
- Light, high-contrast surface tuned for bright retail-counter lighting.
- One amber signal accent, on under 10% of any screen.
- Warm-tinted neutrals, never pure `#fff` or `#000` — including shadows.
- System sans with tabular numerals for prices, quantities, and SKUs.
- Dense but legible; hierarchy stays obvious. Headers run smaller than a
  typical dashboard (screen titles sit at 1rem, not 1.75rem+) — display scale
  is reserved for the one number that matters: the sale total.
- Two responsive tiers only (`sm` 640px, `lg` 1024px): stacked forms below
  `sm`, two-pane list/detail and the persistent sidebar from `lg` up.
- Responsive, state-only motion; no choreography. `prefers-reduced-motion` is
  honored everywhere motion appears (transitions, skeletons, progress fills).

## Colors

A near-neutral, warm-tinted light palette carrying a single amber signal
accent, plus a compact non-amber semantic set for stateful outcomes.

### Primary
- **Signal Amber** (`oklch(72% 0.15 75)`, hover `oklch(66% 0.155 75)`, approx
  `#d99a2b`): The one signal on the workbench. Used for the primary action in a
  flow (complete sale, confirm), the current selection, focus rings, active nav
  items, and the single hero total on the POS screen. Never decorative, never
  on inactive states. Ships as a full 50–950 tonal ramp in the PrimeNG preset
  (`keep-inv-preset.ts`) for hover/active/disabled derivations.

### Neutral
- **Ink** (`oklch(24% 0.014 75)`): Primary text, high-emphasis labels, and the
  base for tinted shadows (`shadow-ink/5`). Tinted toward the amber hue, never
  pure black.
- **Muted** (`oklch(50% 0.014 75)`): Secondary text, captions, placeholder
  text, disabled icons.
- **Counter** (`oklch(98% 0.006 75)`): The primary content surface — page
  background, cards, table rows, input backgrounds. Tinted warm, never pure
  white.
- **Panel** (`oklch(96.2% 0.007 75)`): A second, slightly deeper neutral layer
  for icon-circle backgrounds and empty-state accents that sit on top of
  Counter.
- **Line** (`oklch(90% 0.008 75)`): Borders, dividers, table rules, skeleton
  fill, disabled-badge borders.
- **Field** (`oklch(62% 0.013 75)`): Input and form-field borders specifically
  — kept a step darker than Line so it clears the ≥3:1 non-text contrast
  requirement against Counter.

### Semantic
- **Danger** (`oklch(52% 0.17 27)`): Out-of-stock states, form errors, invalid
  field borders, destructive outcomes (audit "missing").
- **Success** (`oklch(53% 0.13 150)`): Completed / verified states (audit
  "matched", completed movement status).
- **Info** (`oklch(54% 0.13 264)`): Neutral-but-notable outcomes that are not
  errors (audit "misplaced" — relocate, not lost).
- All three render two ways: as text directly, or as a tint badge
  (`bg-{color}/10 text-{color}`) for status chips. Kept at a lightness that
  reads as text on the Counter surface and tints cleanly at 10% opacity. None
  is amber — a status badge never competes with the One Signal Rule.

### Identity (non-interactive)
- **Brand Green** (`oklch(52% 0.15 148)`): A quiet nod to Minecraft's
  "keepInventory" in the "keep" half of the wordmark, on the sign-in screen and
  sidebar only. Identity color, never used for an interactive or status signal.

### Named Rules
**The One Signal Rule.** Amber appears on at most one primary thing per view:
the action that completes the task, the row that is selected, or the field
that has focus. If two amber things compete on a screen, one is wrong.

**The No Pure Extremes Rule.** Never `#fff`, never `#000`. Every neutral is
tinted toward the amber hue (chroma 0.006 to 0.014). A pure-gray surface reads
as legacy ERP.

**The Tinted Shadow Rule.** Shadows are colored with Ink, not a generic black
(`shadow-ink/5`, `shadow-xl` on the warm Counter surface). Elevation stays
warm even when it lifts off the page.

## Typography

**Display Font:** System sans (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`)
**Body Font:** Same system sans (one family carries everything)
**Numeric:** Same family with tabular figures enforced (`font-variant-numeric: tabular-nums` / Tailwind `tabular-nums`)

**Character:** One well-tuned system sans, native on every platform, zero font
load, instant render. The personality comes from precision and tabular
numerals, not from a distinctive typeface. Prices, quantities, SKUs, and totals
must align in columns and never shift width as digits change.

### Hierarchy
- **Display** (600, 1.875rem, 1.1, tabular-nums): The single hero readout on a
  screen. Confirmed use: the POS running total only. Reserve it — it does not
  mean "biggest heading available."
- **Headline** (600, 1.5rem, 1.2, tabular-nums where numeric): Large stat
  callouts — audit outcome counts (matched / missing / misplaced), summary
  totals.
- **Title** (600, 0.875–1rem, 1.3): Screen titles (page header `h1`, 1rem) and
  section/dialog titles (dialog `h2`, card section headers, 0.875rem). Both
  weights are semibold; the size step signals hierarchy depth, not importance.
- **Body** (400–500, 0.875rem, 1.5): Default UI text, table cell content,
  descriptions. Row/card titles (e.g. a product name) use Body size at medium
  weight rather than promoting to Title. Prose capped at 65–75ch; tables run
  denser.
- **Label** (500, 0.6875–0.75rem, 0.02–0.03em tracking): Field labels, table
  headers, nav section captions, badges, keyboard-shortcut hints. Sentence
  case for most labels; uppercase with wide tracking reserved for nav section
  captions and small status/role badges.

Fixed rem scale, not fluid clamps. Scale ratio kept tight since a product UI
has many type elements and exaggerated contrast creates noise. In practice the
implementation runs *more* restrained than a typical dashboard: only one
element on the entire app (the POS total) uses Display scale.

### Named Rules
**The Tabular Numerals Rule.** Every number that represents money, quantity,
or an identifier uses tabular figures. Columns of prices and counts must align
to the digit. This is non-negotiable; proportional digits in a price column
are a defect.

**The One Display Rule.** Display scale (1.875rem/600) is reserved for the
single most important number on a screen — today, only the POS total. A second
Display-scale element on the same screen is a defect, not emphasis.

## Layout

Two responsive tiers, confirmed across the app (no `md`, `xl`, or `2xl` usage
anywhere):

- **`sm` (640px):** Forms and detail panels go from stacked single-column to
  side-by-side field groups. The POS unit-picker dialog changes from an
  edge-to-edge bottom sheet to a centered, max-width panel at this tier.
- **`lg` (1024px):** The primary structural breakpoint. Below it, the sidebar
  collapses to an overlay drawer and list/detail screens show one pane at a
  time (list, then detail, with a back affordance). At and above it, the
  persistent sidebar is visible and master-detail screens split into a fixed
  list pane (typically `26rem`–`28rem`) beside a flexible detail pane
  (`lg:grid-cols-[26rem_minmax(0,1fr)]`).

**Page container:** every routed page wraps its content in a shared `.page`
utility class — `margin-inline: auto; max-width: 80rem` (Tailwind's
`max-w-7xl`) — so navigating between pages never shifts the content column.

**App shell:** fixed-height header (`h-16` / 4rem) and sidebar, independently
scrollable content area (`main` scrolls, header stays sticky). Gutter padding
is `px-4` on mobile, `px-6` at `lg`, applied on the shell rather than per-page.

**Density:** table rows and list items favor tight vertical rhythm (`py-3`
cell padding) over generous whitespace; forms favor grouped field clusters
over one-field-per-row spacing. Density serves speed, not compactness for its
own sake.

## Elevation & Depth

Flat by default, with tonal layering instead of shadows. Depth is conveyed by
the warm-neutral layers (Counter content surface against a distinct Panel
neutral for icon accents) and by 1px hairline borders (`border-line`), not by
drop shadows on resting surfaces. Confirmed shadow use is limited to three
genuinely floating cases, all tinted with Ink rather than a generic black:

### Shadow Vocabulary
- **Dropdown / overlay result list** (`shadow-lg shadow-ink/5`): search-result
  and autocomplete popovers anchored to an input.
- **Modal / sheet** (`shadow-xl`): the POS unit-picker and similar hand-rolled
  dialogs.
- **Floating status hint** (`shadow-sm`): the fixed bottom-center keyboard-
  shortcut hint bar.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Separation comes from
tonal neutral layers and hairline borders. A shadow only appears on something
that genuinely floats above the page — a popover, a dialog, a fixed hint —
never as decoration on a resting card or table row.

## Shapes

- **`sm` (0.25rem):** Skeleton bars, small inline fills, the smallest chip
  corners.
- **`md` (0.375rem):** The default interactive-control radius — buttons, form
  fields (matches the PrimeNG preset's `formField.borderRadius`), icon
  buttons, nav items, small role/status badges.
- **`lg` (0.5rem):** Cards, list/detail panes, empty-state containers — the
  standard content-container radius.
- **`xl` / **top-only `xl`** (0.75rem):** Dialogs and sheets. Mobile renders
  the top corners only (`rounded-t-xl`, edge-to-edge bottom sheet); at `sm`
  and up it becomes a fully rounded centered panel (`sm:rounded-xl`).
- **`full` (9999px):** Avatars, icon circles, pill badges, progress-bar fill.

**Borders:** 1px solid `border-line` is the default border everywhere
(cards, inputs, dividers, badges). `border-dashed` is reserved for empty-state
placeholder containers (e.g. an empty catalog), signaling "nothing here yet"
distinctly from a populated bordered container.

## Components

### Buttons
- **Shape:** `rounded-md` (0.375rem), matching form fields.
- **Primary:** Signal Amber background via the PrimeNG preset's
  `colorScheme.light.primary`, Ink text (not white — keeps contrast on amber
  without introducing a pure extreme), semibold label. Used once per view for
  the action that completes the task (e.g. "Complete sale", "New product").
- **Ghost / Text:** `[text]="true"` PrimeNG variant — transparent background,
  Muted text, used for secondary actions (Retry, Clear filters) so only one
  filled amber button competes for attention per view.
- **States:** default, hover (amber ramp step 600), focus-visible (2px Signal
  ring, 2px offset against the Counter surface), disabled, loading (PrimeNG's
  built-in spinner swap via `[loading]`).

### Inputs / Fields
- **Style:** 1px `border-field`, Counter background, `rounded-md`, PrimeNG
  `formField` tokens (`padding: 0.75rem / 0.5rem`).
- **Focus:** 2px Signal ring, 0 offset, no shadow — set once in the PrimeNG
  preset so every PrimeNG form control (input, select, checkbox) shares it.
- **Invalid:** border switches to Danger.
- **Signature pattern — search/scan field:** leading search icon inset in the
  field (`pl-9`), placeholder explicitly invites scanning ("Search or scan
  name, SKU, barcode…"). The scanner is treated as keyboard entry, so focus
  management must guarantee scanned input always lands here, never elsewhere.

### Tables
- **Style:** PrimeNG `p-table` at `text-sm`, row hover highlight, single-
  select rows, fixed layout for predictable column widths. Cell padding
  `px-4 py-3`.
- **Content:** tabular-nums on every price/quantity/SKU cell (via `money` and
  `number` pipes). Status is inline text + icon in the semantic color
  (Danger/Ink+warning-icon), not a separate column.
- **Empty:** a centered one-line message, not a blank table body.
- **Loading:** skeleton rows (see Skeletons), not a spinner over the table.

### Cards / Panes
- **Corner:** `rounded-lg` (0.5rem).
- **Background:** Counter, 1px `border-line`.
- **Shadow:** none at rest — see Elevation & Depth.
- **Internal padding:** content-dependent, typically `p-4` to `px-6 py-12` for
  full-pane states (empty, error).

### Empty / Error States
A confirmed, reused pattern across catalog, audits, and lists: an
`h-11 w-11` icon circle (`rounded-full bg-panel`, PrimeIcon inside) above a
semibold title (`text-sm text-ink`) and a muted one-line explanation
(`max-w-xs`/`max-w-sm`), followed by a single CTA button when there's a next
action. Error states reuse the identical layout with a Danger-adjacent message
instead of an icon-circle illustration change — the shape stays constant so
the eye doesn't have to relearn it.

### Skeletons
Loading uses skeleton fills (`animate-pulse rounded bg-line
motion-reduce:animate-none`) shaped like the content they replace (a name-
width bar, a price-width bar), not center-screen spinners. A small inline
spinner (`pi-spin pi-spinner`) is used only for short, localized loads inside
an already-open panel (e.g. a unit list inside a dialog) — never for a full
page or table.

### Badges / Chips
Two confirmed variants, both `rounded-md`, both Label typography:
- **Neutral / outline:** `border border-line text-muted`, e.g. "Soon"
  (disabled nav items) or a role tag. Uppercase, wide tracking.
- **Semantic / tint:** `bg-{success|danger|info}/10 text-{success|danger|info}`
  for status outcomes (audit result, movement status). No border. Never amber.

### Navigation
- **Shell:** persistent sidebar (`lg`+) collapsing to an overlay drawer below
  it; sticky top header with breadcrumb + page title.
- **Item state:** active item gets Signal-colored icon + label; default and
  hover states use Ink/Muted text with a subtle `bg-line/60` hover fill.
  Standard product patterns throughout — familiar, never reinvented for
  flavor.
- **Focus:** every interactive nav element (links, icon buttons, the account
  menu trigger) shares the same 2px Signal focus-visible ring, offset against
  whatever surface it sits on.

### Dialog / Sheet (signature component)
Hand-rolled rather than PrimeNG's generic dialog, because the app needs a
mobile bottom-sheet that becomes a centered desktop dialog at `sm`. Backdrop
is `bg-ink/40` (never pure black); the panel is `rounded-t-xl` edge-to-edge on
mobile, `sm:rounded-xl sm:max-w-lg` centered above `sm`; `shadow-xl`; proper
`role="dialog"` / `aria-modal` / `Escape`-to-close / focus placed on the panel.
Reserve this pattern for genuinely transient choices (e.g. picking a
serialized unit); it is not the first tool reached for — inline and
progressive disclosure are tried first per product-wide UI conventions.

## Do's and Don'ts

### Do:
- **Do** keep Signal Amber on under 10% of any screen, the primary action,
  current selection, and focus only. Its scarcity is the point.
- **Do** tint every neutral toward the amber hue; use a warm off-white surface
  and a warm near-black ink — including shadows (Ink-tinted, never generic
  black).
- **Do** enforce tabular numerals on every price, quantity, and SKU.
- **Do** make every core action fully operable by keyboard and scanner, with a
  visible focus ring at all times and predictable focus so scanned input never
  lands in the wrong field.
- **Do** keep motion responsive and state-only (150–300ms), and respect
  `prefers-reduced-motion` on every transition, skeleton, and progress fill.
- **Do** stay flat by default; separate surfaces with tonal neutral layers and
  hairline borders; reserve shadows for things that genuinely float
  (dropdown, dialog, fixed hint).
- **Do** reserve Display-scale type (1.875rem) for the one number that matters
  on a screen — don't promote ordinary headings to it.

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
- **Don't** use `#fff` or `#000` anywhere, including in shadows (no generic
  `rgba(0,0,0,...)`).
- **Don't** use a colored side-stripe border (`border-left`/`border-right`
  over 1px) as an accent, gradient text, or decorative glassmorphism.
- **Don't** use proportional digits in any column of prices or counts.
- **Don't** reach for a full-page or table-wide spinner; use skeletons shaped
  like the content instead. A small inline spinner is only acceptable for a
  short, localized load already inside an open panel.
