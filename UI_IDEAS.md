# UI rebuild — v3 (decisions locked, ready to build)

> Cam answered A through F. Everything below is now a build spec, not a debate. One open item remains — the A/B/C orientation prototype — and it's an *implementation* question, not a design one.

---

## The mission (settled)

**Job #1 is recognising patterns. Logging is just data collection.** The weakest point in the system is users not being consistent with logging, so the UI's job is to make pattern-recognition the reward and logging a frictionless side-effect of it.

Tone word: **Honest.** Not cheerful, not stern, not coachy.

---

## The interaction model (settled)

The whole app is one screen: a **dense grid of small coloured dots**, one per day, traffic-light ramp (green → yellow → orange → red). No numbers on the grid itself. Around the grid: a small avatar (top corner), a quiet "last logged" microcopy, and a FAB on mobile for +1-today.

### Hover / scrub (desktop pointer, mobile touch)
- **Neighbourhood magnify, dock-style.** Dot under the cursor/finger grows; adjacent dots scale slightly with a soft falloff. `prefers-reduced-motion` users get a static highlight ring instead.
- **Mobile offset is mandatory.** The magnified dot and its label render **above and slightly left of the finger** (or right, for left-handed mode if we ship one) — never directly under the touch point. The thumb must not block what it's trying to see.
- A small floating label follows the magnify: **date + drink count**. That's it.

### The tap / click (selection vs. open — this is the nuance)
- **Mouse**: a normal click on a dot opens it for editing (blooms into the day card).
- **Touch**: scrubbing magnifies but doesn't open anything. **Releasing your finger over a dot** opens that dot for editing. So you can drag across the grid, browse the magnified label, and only commit to editing by letting go. Drag off the grid before releasing → nothing happens. This makes scrubbing safe to explore.

### The bloom card (the editor)
When a dot is opened:
- It **blooms in place** into a card showing: full date, `−` / `+` drink stepper + numeric input (keyboard-accessible), note textarea (auto-grows, ≤500 chars, char count appears only when close to limit), and a `Delete` button only when there's something to delete.
- **No Save button.** Auto-save on blur, or after 800ms of inactivity inside a field. A small `saved ✓` indicator fades in and out.
- Hit Escape, tap outside, or open another day → collapses back into a dot. The dot's colour updates in real time as you edit.
- Editing and viewing are the same gesture. **The grid is the editor.**

**Accessibility note on auto-save:** auto-save on blur is fine for sighted/keyboard users. Screen reader announcements will say "saved" via an `aria-live="polite"` region so the user gets confirmation without a button. The only accessibility scenario where this gets weird is voice-control software that may move focus unexpectedly — we'll handle that with a debounce that ignores focus moves shorter than ~300ms.

---

## Locked decisions

| Topic | Call |
|---|---|
| **Layout** | One screen. Heatmap centre, avatar corner, FAB on mobile. No tabs, no bottom nav. |
| **Primary visual** | The dot grid is the home screen. |
| **Streaks** | Killed entirely. |
| **Stats strip** | Killed for now. Day-of-week and month aggregate strips along the grid edges (built from the same dots) carry the pattern weight instead. |
| **Notes** | Inline inside the per-day bloom card. No separate journal screen. |
| **Quick-add (mobile)** | FAB, bottom-right. +1 for today. Toast: *"+1 for today · Undo"*. Today's dot pulses + recolours. |
| **Quick-add (desktop)** | A small real button near the grid. Same behaviour. |
| **Selection model** | Mouse: click to open. Touch: scrub to browse, **release to open**. |
| **Save behaviour** | Auto-save on blur / after 800ms idle. Subtle `saved ✓`. No Save button. |
| **Magnify style** | Neighbourhood magnify (dock-style). Reduced-motion → static ring. |
| **Mobile magnify offset** | Magnified dot + label render *offset from the finger* so thumbs never occlude. |
| **Today affordance** | Today's dot has a persistent subtle ring. You always know where you are. |
| **Account / settings** | Small avatar/initial in a corner. Opens a sheet (mobile) / popover (desktop). Houses: change email, change password, log out, delete account, **plus a Settings section** with room to grow. |
| **Consistency nudge** | If the user opens the app and hasn't logged in N days, today's bloom card opens automatically. **Setting: "Auto-open today when I've been away" — on by default.** Lives in the avatar sheet. |
| **Logged-0 vs unlogged** | Visual distinction via *shape*, not colour. Logged-0 = filled soft-green dot. Unlogged = hollow ring. Backend behaviour unchanged. |
| **Theme** | Respect `prefers-color-scheme`. Light + dark both designed properly. Traffic-light ramp for the heatmap. |
| **Numbers on cells** | None. Numbers only in the magnify label and the bloom card. Aria-labels carry full info. |
| **No-go list** | River timeline, "avg per session", Chart.js, npm, build step, framework. |
| **Microcopy** | "last logged Xh ago" type lines — quiet, neutral, never naggy. |
| **Reduced motion** | Respected throughout. Magnify, bloom, toast — all have static fallbacks. |

---

## The one remaining open item: grid orientation (A/B/C prototype)

Cam wants to A/B/C test these:

- **A.** Year view, weeks-as-columns (7 rows × 52 columns, GitHub-style). Horizontal scroll on mobile.
- **B.** Year view, weeks-as-rows (52 rows × 7 columns). Vertical scroll. Native mobile gesture.
- **C.** Rolling 26 weeks by default, with "see more" → full year. Less daunting on a new account.

Plan: build the dot grid as a single component that takes an `orientation` (`horizontal | vertical`) and a `range` (`year | rolling26`) prop. Render all three layouts behind a hidden URL param (`?layout=A|B|C`) so Cam can flip between them on the same data and judge with their actual hands.

This stays open until we have real pixels to look at.

---

## Roadmap parking lot (explicitly *not now*)

- User-defined goals and metrics
- Demo mode (no-account first-run)
- Richer aggregations / insights view
- Shareable export
- Left-handed mode for the touch offset
- More items in the Settings section as they come up

---

## Build order

1. **Grid skeleton.** Semantic HTML + mock data for all three orientations behind `?layout=`. No styling, no JS interaction yet — just structure, sizes, scroll behaviour, and screen-reader correctness.
2. **CSS pass 1.** New palette (indigo base, single accent), traffic-light ramp, dot rendering (filled vs hollow for logged-0 vs unlogged), light/dark via `prefers-color-scheme`, today-ring, container-query orientation swap.
3. **Magnify + bloom interaction.** JS for neighbourhood magnify with thumb-offset on touch, scrub-and-release-to-open, click-to-open on mouse, bloom-card auto-save, `prefers-reduced-motion` fallbacks.
4. **API wiring.** Bloom card → `POST /api/logs`. FAB → `POST /api/drinks/add`. Grid fetch → `GET /api/logs`. Auto-open-today behaviour with the on-by-default setting.
5. **Avatar sheet.** Account info, password, log out, delete account, Settings (with the auto-open toggle as the first setting). Auth screens.
6. **QA pass.** 320px mobile, 200% zoom, keyboard-only nav, screen reader (aria-labels on every dot must read like sentences, not codes), slow network, empty/sparse/dense data, light + dark, reduced-motion, the touch-release-to-open vs scroll-cancel edge cases.

Each step is a commit. Each is reviewable on its own.

---

## TL;DR for Cam

- Every design call you made is in the decisions table. Nothing's vague anymore.
- Mouse = click to open. Touch = scrub-and-release to open. Magnify offsets above the finger so your thumb doesn't block the bloom. Auto-save on blur. Today gets a persistent ring. Avatar in the corner opens a sheet with room for Settings to grow.
- Auto-open-today-when-away ships **on by default with a toggle** in Settings.
- Hollow-ring-for-unlogged vs filled-dot-for-logged-zero is in.
- One thing left: A/B/C grid orientation. I'll build all three behind `?layout=` so we can judge with real pixels.

Ready to start on the grid skeleton when you say go.

— Pixel xoxo
