# UI rebuild — v2 (post-Cam-review)

> Cam reviewed v1, made calls on every open question, and reframed the whole thing. This doc is the consolidated direction. Old per-question debates are deleted; decisions only. Open questions are marked `❓`.

---

## The reframe (this is the most important section)

I had the mission wrong. I thought job #1 was "log a drink fast." Cam corrected me:

> **Job #1 is recognising patterns.** Logging is just data collection — and the *weakest* point in the whole system is the user not being consistent with logging.

That changes everything. The UI is not a logger with a chart attached. It's **a pattern-recognition surface that you can also write on**. The heatmap isn't a "history view," it's the home screen, the centerpiece, the entire room.

**Tone word: Honest.** Not cheerful, not stern, not coachy. Honest.

---

## The vision, described back

Cam asked me to describe their "big grid of tiny coloured dots, magnify and scrub" idea back. Here's what I see:

### The default state
You open the app. You see a **dense grid of small, round, coloured dots** — one per day, weeks running down, days-of-week running across (or vice versa, TBD). Like the GitHub commit graph, but circular dots instead of squares, and using a traffic-light scale (green → yellow → orange → red) instead of green-on-green. Empty days are a soft neutral — visible but quiet. **No numbers anywhere.** You take it in as a single gestalt: "huh, my Wednesdays are orange." The pattern *is* the UI.

### The hover/scrub
You move a finger or cursor over the grid. The dot under your touch (and a little neighbourhood around it, falling off smoothly) **magnifies** — Mac-dock style, but more restrained. The magnified dot shows the **date** and the **drink count** in a tiny floating label. Drag your finger across the grid and the magnification follows you. This is the discoverable version of the old "scrub gesture" — you can't *not* discover it, because the dot literally grows under your finger.

CSS-wise: this is `transform: scale()` driven by pointer position, with `transition` on the dot itself but the cascade computed in JS. Reduced-motion users get a static highlight ring instead of the bloom — still readable, still works.

### The tap (the "dig in")
You tap a dot. It **blooms into a card** in place — pushing the surrounding grid aside slightly with `grid` reflow, or floating above with a backdrop. The card shows:

- The full date
- A drink count with `−` / `+` stepper (and a numeric input for the keyboard people)
- A note field (auto-grows, ≤500 chars, character count appears only when you're close to the limit)
- A subtle `Save` (or auto-save on blur — `❓` to decide)
- A `Delete` only when there's something to delete

Hit Escape, tap outside, or hit Save → it collapses back into a dot. You see the dot's colour update in real time. **Editing and viewing are the same gesture.** No modals, no separate journal screen, no "edit log" page. The grid *is* the editor.

### Pattern-spotting, without a stats strip
Cam wants to see things like "Saturdays are heavy" and "Jan was massive" without a wall of numbers. My proposal — built from the *same dots*, no new visual language:

- **Day-of-week aggregate strip** along one edge of the grid. Seven dots, each the average colour of that weekday across the visible range. "My Saturdays are red" jumps out without a single digit.
- **Month aggregate strip** along the other edge. One dot per month, same idea. "Jan was rough" / "March is greener" — visible at a glance.

These aren't separate widgets. They're the same dots, aggregated. Same shape, same scale, same colour ramp. The whole UI speaks one visual sentence.

### The "log right now" path
On a night out, Cam wants minimum friction. So:

- **Mobile: a FAB** anchored bottom-right. Tap it → drink count for *today* increments by 1. A small toast appears: *"+1 for today · Undo"*. The dot for today on the grid pulses or fills in — confirmation without ceremony.
- **Desktop: a small, real button** somewhere near the grid (probably top-right of the card). Same behaviour.

No modal, no "what kind of drink", no questions. One tap. Done.

### Empty / sparse states
A new user opens the app and sees an almost-empty grid. We do **not** apologise for it or tell them to "start logging!" We just show the grid honestly with one quiet line of text near the top: *"Tap any day to log it. Tap today to start."* Then we get out of the way.

---

## Decisions locked in (from Cam's review)

| # | Topic | Call |
|---|---|---|
| 1 | Layout | **One screen.** No tabs, no bottom nav. Heatmap + log-today affordance + (eventually) account access. That's it. |
| 2 | Primary visual | **Heatmap-first.** The grid *is* the home screen. |
| 3 | Quick add | **Keep the FAB on mobile.** +1 for today, toast with undo. |
| 4 | Heatmap scope | **Keep it.** Year-ish view by default. Specific framing TBD (`❓` see below). |
| 5 | Streaks | **Killed entirely.** No current streak, no longest streak, no "X days sober." User-defined goals are a roadmap item, not now. |
| 6 | Notes | **Inline inside the day's bloom-card.** Not on the grid itself, not in a separate journal screen. |
| 7 | Stats strip | **Killed for now.** Roadmap: bring back select stats (e.g. month aggregate, weekday aggregate) — but as part of the dot grid's visual language, not a row of numbers. |
| 8 | Auth | **Two clear forms** (login / register). No combined-form magic. Demo mode → roadmap. |
| 9 | Theme | **Respect `prefers-color-scheme`** — light and dark, both designed properly. New palette, but keep the green→yellow→orange→red traffic-light ramp for the heatmap. |
| 10 | Numbers on cells | **No numbers on the grid itself.** Numbers only appear in the magnify label and the bloom-card. Aria-labels carry full info for screen readers. |
| — | River timeline | **Removed.** |
| — | Undiscoverable scrub gesture | **Replaced** with the magnify-on-hover, which is self-discovering. |
| — | "avg per session" stat | **Removed.** |
| — | Chart.js | **Out.** No CDN, no JS libraries. Vanilla all the way. |
| — | Small adds | **All in:** "last logged Xh ago" microcopy, inline editing on the grid (covered by the bloom-card), genuinely kind empty states, `prefers-reduced-motion` respect. |

---

## Open questions for Cam (`❓`)

A small handful of things I genuinely need a call on before I start drawing rectangles:

### A. Grid orientation & range

Three reasonable defaults:

1. **Year view, weeks-as-columns** (GitHub-style: 7 rows × 52 columns). Familiar. Wide. Awkward on a 320px phone — it'll need horizontal scroll.
2. **Year view, weeks-as-rows** (52 rows × 7 columns). Tall. Scrolls *vertically*, which phones do natively. Less familiar, but maybe better for one-handed late-night use.
3. **Rolling 26 weeks** (about 6 months) by default, with a "see more" that expands to the full year. Less daunting for new users; still rich for veterans.

I lean **(2) for mobile, (1) for desktop, with a CSS container query swapping orientation at the breakpoint.** Same data, two layouts. Cam — does that feel right or precious?

### B. "Today" affordance

The FAB handles fast-logging. But should the "today" dot also have a **persistent visual treatment** — e.g. a subtle ring around it — so you can always find it on the grid without scrolling? I think yes. Confirm?

### C. Account / settings

We still need somewhere for: change email, change password, delete account, log out. Options:

1. A small avatar/initial in a corner that opens a sheet.
2. A `…` menu button.
3. Push it behind a route (`/account`) accessed from a tiny link in the corner.

I lean **(1)** — single icon, opens a slide-up sheet on mobile / a popover on desktop. Confirm?

### D. Save behaviour in the bloom-card

When editing a day's drink count or note, do we:

1. **Auto-save on change** (with debounce + a tiny "saved" indicator)
2. Require an explicit **Save** button

Auto-save is calmer and more honest; explicit-save is more forgiving of misclicks. I lean **auto-save on blur or after 800ms of inactivity**, with a "saved ✓" that fades. Confirm?

### E. The magnify falloff

Two flavours:

1. **Single-dot magnify** (only the dot under the cursor grows)
2. **Neighbourhood magnify** (the dot grows + adjacent dots scale slightly, dock-style)

(2) is prettier and helps you see context. (1) is simpler and faster. I want to prototype both, but if Cam has a gut feel, that saves me a round-trip.

### F. The "consistency" problem

Cam's framing: *"the weakest point is the user not being consistent with logging."* I have a heretical idea here:

> What if, when you open the app and you haven't logged anything for the last N days, the bloom-card for *today* is **already open** — pre-expanded, ready for input? Not a popup, not a notification. Just: "you're here, and there's a day waiting for you." Honest, not naggy.

Worth trying? Or does it cross into "the app is bugging me"?

---

## A note on the empty-day / no-nag rule

Cam wrote (re: unlogged-days-treated-as-sober): *"if you can think of other ideas, let me know."*

The current backend rule is fine and I wouldn't change it. But here's a thought for the **UI** layer that complements it without nagging:

> Distinguish visually between **"logged as 0 drinks"** and **"not logged"** — using *shape* or *opacity*, not colour. E.g. a logged-zero is a **filled** soft-green dot; an unlogged day is a **hollow ring**. Both are "treated as sober" by the backend, both look calm and positive — but the user can see which days they actively confirmed vs. just didn't open the app. No judgement, just data honesty.

This is purely visual; the backend behaviour stays exactly the same. Worth trying?

---

## Updated next-step deliverable

Same as v1, just with the new direction baked in:

1. **Grid skeleton** — semantic HTML for the dot grid, no styling, no JS, with realistic mock data. Confirm structure.
2. **CSS pass 1** — palette, traffic-light ramp, dot rendering, layout (with the orientation-swap container query), light/dark via `prefers-color-scheme`. No interaction yet.
3. **Magnify + bloom interaction** — JS for hover/scrub magnify, tap-to-bloom inline editor. Reduced-motion fallback.
4. **API wiring** — connect the bloom-card to `POST /api/logs`, the FAB to `POST /api/drinks/add`, etc.
5. **Account sheet + auth screens** — minimal, clean.
6. **QA pass** — 320px mobile, 200% zoom, keyboard-only, screen reader (the aria-labels on dots are make-or-break here), slow network, empty / sparse / dense data states.

Each is a commit. Each is reviewable on its own.

---

## TL;DR for Cam

- I had the mission wrong. Patterns first, logging second. Got it.
- Heatmap is the home screen. The dot grid + magnify + tap-to-bloom interaction *is* the app.
- Streaks are dead. Stats strip is dead. River is dead. Chart.js is dead.
- FAB lives. Inline editing lives. Light + dark live. Traffic-light heatmap lives.
- I need calls on **A through F** above before I write a line of CSS.
- Roadmap parking lot: user-defined goals, demo mode, richer aggregations, shareable export.

Tell me which of A–F you want to answer now and I'll start on the grid skeleton.

— Pixel
