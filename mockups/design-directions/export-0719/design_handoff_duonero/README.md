# Handoff: Duonero — Couples Personal-Finance App (Direction B9)

## Overview
Duonero is a bilingual (Hebrew / English, RTL-first) personal-finance app for couples. It shows one person their money picture — what's left this month, where it goes, goals, the paycheck story, and net worth — then lets them flip to a **Couple** view that combines only what each partner chose to share. The emotional design goal: make facing money together feel **warm and welcoming, not stressful**. The visual world is a **nature scene at dusk** — a dark botanical backdrop, frosted-glass panels, falling leaves that react to clicks, a reflective pond, growing goal-trees, and a playful frog "what-if" game.

This document describes **Direction B9**, the approved final direction.

## About the Design Files
The files in this bundle are **design references authored in HTML/CSS/JS** — a working prototype that demonstrates the intended look, motion, and behavior. **They are not production code to ship directly.** Your task is to **recreate this design inside the target codebase**, using its established framework, component patterns, state management, styling system, and i18n library (React, React Native, SwiftUI, Flutter, etc.). If no codebase exists yet, choose the framework best suited to the product (a cross-platform mobile stack is the natural fit given the RTL-first, mobile-first layout) and implement the design there.

Treat the HTML as the **source of truth for visuals and interactions**. Re-implement the layout, tokens, animations, and copy faithfully; wire the data and business logic to real services in place of the demo data.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, iconography, motion, and copy are all specified below and present in the prototype. Recreate the UI as closely as the target platform allows, matching the exact hex values, radii, shadows, easing curves, and Hebrew/English strings. Where a platform can't reproduce an effect (e.g. CSS `backdrop-filter`, `color-mix`, SVG caustics), substitute the nearest native equivalent and preserve the intent (frosted translucency, layered depth, living motion).

---

## Global Design Language

### Theme
The app ships in a **dusk / dark botanical** theme by default (`<body class="dusk">`). A daytime light theme exists in the tokens but B9 presents the dusk theme as the shipping look. Implement dusk as the default; the light palette can be a later light-mode.

- **Backdrop:** deep forest green (`#0B241A` base) with a blurred, layered leaf-silhouette SVG (radial vignette + soft green blobs) covering the viewport, fixed behind all content. Fireflies (small glowing gold dots) drift upward in the dusk theme only.
- **Panels:** content sits in a single rounded frosted-glass container (`backdrop-filter: blur(22px) saturate(1.15)`, translucent white fill, subtle inner top highlight). Individual cards inside are **borderless** in dusk — separated by thin centered gradient hairlines rather than boxes.
- **Depth everywhere:** multi-layer shadows, inner highlights (`inset 0 1px 0 rgba(255,255,255,…)`), and gradient fills give a soft, tactile, 3D feel. Avoid flat fills on interactive elements.

### Color Tokens (hex)
Neutrals & surfaces (light theme base values):
- `--paper #FBF3E7`  · `--card #FFFFFF`  · `--ink #2C2620` (text)  · `--soft #8A7E6D` (muted text)  · `--line #EEE3D2` (hairlines)

Brand / accent:
- `--teal #0F8E75`  · `--teal-ink #085E4E`  · `--teal-deep #04443A`
- `--coral #F2795B`  · `--gold #F7C843`  · `--berry #C76699`
- `--pos #17835F` (positive amounts)  · `--bark #8A5F3C`

Dusk overrides (applied when theme = dusk):
- `--ink #EFF7EF`  · `--soft #BDD2BD`  · `--line rgba(255,255,255,.12)`
- Background base `#0B241A` / `#0A2416`
- Mint highlights for headings & active states: `#EAF7EC`, `#D6F3DC`, `#AEDDBA`, `#CFF3DC`, `#BFE8C8`
- Gold text on dark: `#FFD86B`

Category colors (used for donut segments, transaction icons, legends):
- housing `#C05840` · groceries `#E8A820` · dining `#F06048` · shopping `#8848C8` · health `#D44878` · transport `#2AA8C4` · utilities `#5578C0` · entertainment `#7038B8` · investment `#1870B8` · income `#1B9E76` · transfer `#8A9E78` · other `#9E8A70`

The gold **progress gradient** (all bars, rings, cycle meter) runs `#FFD86B → #F7C843 (60%) → #DE9C1E`; SVG ring gradient `#FFD86B → #D9A210`.

### Typography
- **Display / headings / numbers ("round"):** `Poppins` (weights 400/500/600/700), falling back to `Assistant`, sans-serif. Used for the logo, all headings, big amounts, chip values — anything numeric or titular.
- **Body:** `Assistant` (400/600/700), system-ui fallback. Hebrew-first font; renders both scripts.
- Numbers always use `font-variant-numeric: tabular-nums`.
- Hero amount: `clamp(46px, 7.5vw, 70px)`, line-height 1, currency symbol at `.44em` superscript. Card headings 18px. Sub-labels 13px. Never below ~11px for meta text.

### Iconography
All icons are **simple geometric line SVGs** (24×24 viewBox, `stroke: currentColor`, `stroke-width 1.9`, round caps/joins, no fill). The full set is defined as the `I{}` object in the prototype's script — copy those exact paths. Icons: eye/eyeoff, up/down (arrows into tray), leaf, gem, wallet, chart, pie, home, heart, flag, target, doc, gift, safe, list, bank, trend, tree, cal, piggy, and one per category. Recreate them as a shared icon component/set; do **not** substitute an off-the-shelf icon font — the geometric, hand-tuned style is part of the brand.

### Motion & Easing
- Entrance: elements fade + rise (`translateY(14–18px) → 0`), staggered by ~0.1s per card. Easing `cubic-bezier(.2,.9,.3,1.15)` (a gentle overshoot). Hero uses a slightly longer settle.
- Buttons/chips lift on hover (`translateY(-2/-3px)`) with a springy `cubic-bezier(.2,.9,.3,1.4)`; press scales to ~.95.
- Progress fills/rings animate width / `stroke-dashoffset` over ~1.3–1.4s with a delay, so numbers count while bars grow.
- Numbers **count up** from previous value over ~950ms (cubic ease-out); respect a token so re-renders don't re-animate spuriously.
- **Respect `prefers-reduced-motion`:** disable leaf spawning, fireflies, causics, count-ups, and cap all animation/transition durations to ~0.01ms.

---

## Screens / Views

The app is a **single scrolling screen** with two top-level modes (**Me** / **Couple**) and, within Me, a **tab trail** (Home · Goals · Salary · Wealth) that filters which cards are visible. A period switcher (Since paycheck · 30 days · 3 months · This year) appears only on the Home tab.

### Header (persistent)
- **Logo (`duonero`):** two overlapping ring shapes (a coin-slot "duo" ring in teal-ink `#085E4E` / white in dusk, and a gold `#F7C843` ring), then wordmark: "duo" in teal-ink (mint/white in dusk) + "nero" in a gold gradient text fill (`#FFD86B → #F7C843 → #DE9C1E`). Logo mark 34×34, drop-shadowed.
- **View segmented control:** Me / Couple (`אני` / `זוגי`). Pill group, active pill has a raised white/mint gradient.
- **Language segmented control:** `עברית` / `EN`. Switches `lang`, `dir` (rtl/ltr), and every string.
- **Eye button (privacy):** round icon button; toggles masking of all wealth/balance figures to `₪ ••••`. Persisted.

### Hero (persistent, top card)
Deep-teal radial-gradient card (dusk: translucent glass) with **falling autumn leaves** overlaid (see Interactions) and a pond reflection at the very bottom of the page.
- Greeting line with a leaf icon, time-of-day aware ("Good morning/afternoon/evening").
- Sub-line: reassurance copy ("Here's the picture, at your pace — no pressure.").
- **Big number:** amount left this month (₪ + count-up). Label: "left this month — after spending & saving".
- **Cycle meter:** a gold gradient progress bar with a moving sheen, showing days since the paycheck (`day {d} since your paycheck on {date}`).
- **Four hero chips** (frosted): Income ↓, Spent ↑, Saved (piggy icon, with a small dropping-coin animation, shows "% of income"), Saved & invested (gem icon, "incl. payroll"). Each is a translucent rounded tile that lifts on hover.
- In Couple view the chips/cycle meter hide and the big number becomes the combined shared total.

### Tab: Home
1. **Where it goes** (spend spotlight) — a **donut chart** (larger here, 216px) of spending by category for the selected period, center shows the total. A two-column **legend** lists each category with its colored icon tile and amount; clicking a row (or a donut segment) opens the **category drill-down modal**.
2. **Recent** — scrollable transaction list (max-height ~430px). Each row: category icon tile, merchant + "category · date", amount (positive amounts in green `--pos`).

### Tab: Goals ("garden")
1. **Your goals** — each goal is a row with: a **gold progress ring** (SVG, 56px, animated dash), a **goal-tree SVG that grows with progress** (sprout at <18% → trunk+branches → full canopy → three gold fruit at 100%), the goal name, percent, and `current / target` amounts. Tapping a goal expands a **smart tip** (teal bubble) — facts + one concrete, non-judgmental option to hit the target on time (see Business Logic → goalTip).
2. **The frog game** (what-if) — a playful savings simulator:
   - Pick a category chip (top 6 by spend), a **Trim by** slider (5–50%), and a **For how many years** slider (1–30).
   - Result panel: a **frog character SVG** sitting by a little pond (crown, and when you interact it dons a royal cape + sparkles and **hops** — the "prince/royal" state). Coins drop into it at a rate tied to the monthly amount freed.
   - Shows "≈ ₪X freed up monthly" and a big future-value number ("worth in {y} years, if invested"), computed with 4% annual compounding. Note clarifies it's "a fact to compare — not advice."

### Tab: Salary ("pay")
**The paycheck story** — a **donut pie chart** with gross salary in the center, segments animating in: Tax (`#8A7E6D`), Pension+study fund (`#C76699`), ESPP (`#DE9C1E`), Net to bank (`#16A78C`). A flat legend lists each segment + amount. Below, a gold **gift callout**: "Your employer adds ₪X on top of gross — pension, severance & study fund. An actual gift."

### Tab: Wealth
Dark bark-brown card (`#453A2B → #2C2620 → #231D16`).
- **Net worth** big number (maskable via eye).
- Hint line: trend icon + "+₪X since November" (or "tap the eye to reveal" when hidden).
- **Sparkline** (gold line + gradient area, draws in over 1.8s). Hover shows a guide line, dot, and a tooltip with the interpolated balance + date. The monthly series is densified into a weekly "roller-coaster" (mid-month dip, paycheck jump, small market wobble) — see `densify()`.
- **Three horizon tiles:** Day-to-day (wallet), 5–10 years (leaf), Long-term (tree), each with its amount.
- **Accounts list:** bank/investment/fund rows with icon, name, "as of" date, and balance.

### Couple view
Shown when the view control is set to Couple. Header note flags it as a **demo with simulated partner data**.
- **Together / You / Partner tiles** — combined net worth split three ways (Together tile highlighted teal).
- **What each side shares** — horizontal stacked bars per holding, colored teal (you) vs gold (partner), with a legend. Emphasizes "private stays private — only what you each chose to share."
- **Shared spending** — per-category rows with two stacked fills (you gold-gradient / partner gold), summed amount.
- **Shared goal** ("Italy trip") — same ring + growing tree as personal goals, tappable for a tip that splits the monthly contribution between the two partners.

### Category drill-down modal
Centered dialog over a blurred scrim. Header: category icon tile + name + close ✕. Sub: "₪X total · N transactions". Then the filtered transaction list for the selected category and period. Closes on scrim click, ✕, or Escape.

---

## Interactions & Behavior

### Falling leaves + click breeze (signature interaction)
- Leaves continuously spawn at the top of the hero and **fall in a near-horizontal drift** with a gentle pendulum **sway/flutter** (each leaf flutters via `rotate` around a base angle). Cap ~14 leaves at once; spawn a burst on load, then ~every 2.6s.
- Leaf colors cycle through four palettes: **gold** (`#FFE9A8/#F7C843/#D9A210`), **green** (`#DFF3E0/#9CCFA6/#5E9468`), **white/cream** (`#FFFFFF/#F4EEDD/#CFC5A6`), and deep green. In **Couple** view leaves become **heart-shaped** with a soft gold glow.
- **Click anywhere** (outside interactive elements) sends a **breeze**: every leaf gets pushed in the click's horizontal direction; **strength falls off with distance** from the click point (`k = max(.25, 1 - d/900)`). Leaves add a windy tumble/spin for ~2.6s, then settle back.
- When a leaf's fall completes over the **pond**, it triggers a **ripple ring** at the landing point, then **fades out and dissolves**. Leaves landing off-pond just remove.

### Pond
A turquoise ellipse rendered in **3D perspective** (`perspective(700px) rotateX(38deg)`) with a grassy rim (radial green ring behind), inner light/dark shading for depth, an animated moving **glint**, drifting **caustics**, and periodic expanding **ripple rings**. Fixed at the bottom of the page, behind content.

### Other behaviors
- **Period switch** re-renders the spend donut, legend, and drill-down source range. Home tab only.
- **Language switch** flips direction (RTL/LTR), swaps all copy, reformats numbers/dates to `he-IL` / `en-US`, and mirrors hover transforms.
- **Privacy eye** masks every balance/wealth figure app-wide; persisted in storage.
- **Goal tap** toggles its smart-tip bubble. **Frog sliders/chips** live-update the freed amount, future value, coin-drop rate, pond size, and trigger the frog's royal hop.
- **Sparkline hover** interpolates and shows a tooltip.
- **Modal** opens from legend rows / donut segments; closes on scrim / ✕ / Escape.

### Responsive
Mobile-first, RTL-first. Two-column card grid collapses to one column ≤820px. Dedicated ≤560px rules: logo centers, seg controls stretch full-width, hero radius shrinks, chips become a 2-col grid, donut rows stack, hit targets ≥44px. Everything must work in both `dir=rtl` and `dir=ltr` — use logical properties (inline-start/end), not left/right.

---

## State Management
Persisted (survive reload):
- `lang` — `'he' | 'en'` (default `'he'`)
- `privacyOn` — boolean (default off)
- `tab` — `'home' | 'garden' | 'pay' | 'wealth'` (default `'home'`)

Ephemeral runtime state:
- `view` — `'me' | 'couple'`
- `period` — `'cycle' | 'last30' | 'last90' | 'year'`
- Frog game: `pgCat` (category), `pgCut` (5–50), `pgYr` (1–30)
- Modal open/close + current category
- Leaf pool (count, DOM/render nodes), breeze transforms
- Count-up animation tokens (to cancel superseded animations)

### Data model & fetching
All app data comes from a single object (`window.__KESEF__` in the prototype; see `kesef-data.js`). In production this should be fetched from the user's own aggregated financial data (the app is positioned "local-first"). Shape (key fields):
- `netWorth`, `netWorthSeries` [{date, balance}], `composition` {daily, medium, long}
- `cycle` {start, income, spent, saved, savedInvested, byCategory[{category, amount}]}
- `spending` {last30, last90, year} each with the same shape
- `leftThisMonth`
- `accounts` [{id, name, institution, type, balance, asOf}]
- `goals` [{name, currentAmount, targetAmount, targetDate?}]
- `payslips` [{month, gross, tax, net, espp, pensionEmp, kerenEmp, employerPension, employerSeverance, employerKeren}]
- `recent` / `transactions` [{merchant, category, date, amount}]
- Couple/partner data is **simulated** in the prototype (`PARTNER` object) — replace with a real pairing/sharing service, respecting that each partner only exposes what they opt to share.

---

## Business Logic (recreate exactly)

- **Count-up:** animate from previous shown value to target, cubic ease-out ~950ms, cancel-on-supersede via a token.
- **Net-worth densify:** interpolate the monthly series to weekly points, adding a mid-month spend dip (`-sin(t·π)·.45·Δ`), and a small deterministic market wobble — creates the "roller-coaster" sparkline.
- **Frog future value:** `monthly = categoryAmount · cut%`; `FV = monthly · ((1+r)^n − 1) / r` with `r = 0.04/12`, `n = years·12`.
- **Smart goal tip (`goalTip`)** — never shame; always a fact + one option:
  - remaining ≤ 0 → "Goal reached."
  - has target date: `need = remaining / months`. If `need ≤ pace` (pace = income − spent) → "on track" copy with the date. Else find flexible categories (dining, shopping, entertainment, groceries), propose trimming up to 25% of each until the gap is covered → "one option: {parts}"; if impossible → "stretch the date, or play the frog game."
  - no target date: `months = ceil(remaining / pace)` → "at your pace you'll get there in ~{m} months."
- **Couple goal tip:** split the remaining evenly between partners over ~6 months, show each partner's monthly contribution.

All user-facing strings live in the `T{}` dictionary with `he`/`en` variants and `{token}` interpolation — port this as your i18n resource file. Copy is deliberate and warm; keep it verbatim.

---

## Design Tokens (quick reference)
- **Radii:** cards/hero 26–36px, chips 20px, icon tiles 9–13px, pills 999px, modal 24px. Master `--r: 34px`.
- **Shadows:** `--sh-1` (resting) and `--sh-2` (hover) are layered multi-stop shadows — see `:root`. Colored elements use color-matched shadows via `color-mix`.
- **Spacing:** card padding ~30px (18px mobile); grid gap 6px×44px; chip gap 12px.
- **Progress gradient:** `#FFD86B → #F7C843 → #DE9C1E`. **Ring gradient:** `#FFD86B → #D9A210`.
- **Fonts:** Poppins (round), Assistant (body).

## Assets
- **Fonts:** Google Fonts — Poppins & Assistant (loaded via `<link>` in the prototype). Use the equivalent in the target platform.
- **Icons:** inline geometric SVGs defined in the prototype's `I{}` map — copy the path data.
- **Backdrop, pond, leaves, frog, goal-trees:** all drawn as inline SVG / CSS gradients in the prototype — no external image assets. Recreate as SVG or the platform's vector/canvas equivalent. No raster assets are required.

## Screenshots
Reference captures of the approved B9 states live in `screenshots/`:
- `01-b9.png` — Home tab (hero + spend spotlight donut)
- `02-b9.png` — Goals tab (progress rings + growing goal-trees)
- `03-b9.png` — Goals tab, frog what-if game
- `04-b9.png` — Salary tab (paycheck-story donut + gift callout)
- `05-b9.png` — Wealth tab (net-worth sparkline + horizon tiles + accounts)
- `06-b9.png` — Couple view (Together/You/Partner, shared holdings & goal)

> Captured from the live prototype. Some GPU-only effects (blurred SVG backdrop filters) render slightly flatter in these captures than in a browser — the HTML file is the true visual reference.

## Files
- `direction-b9-duonero.html` — the complete, approved B9 prototype (all screens, styles, logic). Primary reference.
- `kesef-data.js` — the demo data module (the `__KESEF__` shape). Reference for the data model.

> Earlier explorations (directions A, B–B8, C) exist in the parent project but are **superseded** — build from B9 only.
