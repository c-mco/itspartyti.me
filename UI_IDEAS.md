# UI rebuild — ideas, questions, and options

> Pixel's brain dump. Nothing here is committed-to. We pick what we like, kill what we don't, and **then** I write code.

---

## What the backend gives us (these are constraints, not suggestions)

The Go API is staying. New UI must work with exactly these endpoints:

| Endpoint                      | What it does                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /api/register`          | Create account (email, password, optional display name)                                                    |
| `POST /api/login`             | Cookie-based session                                                                                       |
| `POST /api/logout`            | Kill session                                                                                               |
| `GET  /api/me`                | Who am I                                                                                                   |
| `GET  /api/logs`              | List logs (with `?from=&to=` date filter)                                                                  |
| `POST /api/logs`              | Upsert a log for a date (drinks, note)                                                                     |
| `DELETE /api/logs/{id}`       | Delete a log                                                                                               |
| `POST /api/drinks/add`        | Quick "+1" for today                                                                                       |
| `GET  /api/stats`             | Week / month / all-time totals, current + longest streak, avg drinking days, % sober days, weekly_totals[] |
| `PATCH /api/account`          | Change email / display name                                                                                |
| `POST  /api/account/password` | Change password                                                                                            |
| `DELETE /api/account`         | Nuke account                                                                                               |

A "log" is `{ date (YYYY-MM-DD), drinks (int), note (≤500 chars) }`. **Unlogged days are treated as sober** — the backend does this on purpose. The UI should respect that and not nag.
note from cam: This is because if I don't drink for a few days, but also don't bother to log, I don't want to open the app and be told my streak is broken. if you can think of other ideas, let me konw.

Stack rules from CLAUDE.md (still in force):

- Vanilla HTML/CSS/JS. No build step. No framework. No bundler.
  note from cam: all about the speed and simplicity for me!
- Three files: `index.html`, `style.css`, `app.js`.
- Chart.js via CDN is allowed (already in use elsewhere historically).
  note from cam: I don't know if that's true. If there's no good reason for it, leave it out.

---

## The mission, in one sentence

> A tired person opens this on their phone at 11pm. The app should feel like it's on their side — not their parent, not their coach, not a streak-bro pep-talker. A mirror, not a judge.

If a design choice fails that sentence, it's wrong.

---

## The job-to-be-done, ranked

I think there are basically four jobs, and the UI's hierarchy should reflect their actual frequency:

1. **Log a drink, fast.** This happens at a bar, one-handed, possibly tipsy. Two taps max. No "what kind of drink?" Don't make me think.
2. **See how I'm doing this week / this month.** A glance. No interpretation required.
3. **Understand my pattern over time.** Slower, more reflective. Done at home on a Sunday morning.
4. **Write down what happened.** Often skipped. Optional. But when used, it's the most valuable data in the app — for the user, not for us.

**Open question for you:** is this ranking right? If you reorder it, the whole layout changes.
note from cam: First and formost, it's about reckognising the patterns. Logging drinks and fast is just about making it easier to collect the data for it - the weakest point is the user not being consistent with logging.

---

## Hard questions I need answered before I draw a single rectangle

Pick the answers you want. "I don't know" is also a valid answer — it means we should prototype both.

### 1. Single screen or multiple views?

The old UI had three tabs (Year / River / Journal) plus a stats strip plus a quick-add FAB plus an account screen plus a modal. That's a lot of surfaces.

- **Option A — One screen, everything visible.** A "today" focus card at top, a small stats line, a calendar/heatmap below. No tabs. Scroll for history. Honest, simple, mobile-friendly. My current favorite.
- **Option B — Two screens.** "Today" (log + this week) and "History" (calendar + journal). Bottom nav with two icons. Almost as simple, gives history more breathing room.
- **Option C — Keep the three-tab thing but better.** Year / River / Journal felt like three different interpretations of the same data. Maybe that's overkill.

note from cam: Simplify! As stated earlier - the main thing is about understanding patterns. This all started as a single excel with color formatted cells. that's not a bad approach but we want simpler for the user, more beautiful and more useful and connected down the line.

### 2. What's the primary visual?

The old UI led with a year heatmap. That's beautiful but it's the _wrong question_ for the daily user. The daily user wants to know: "did I log today?" and "how's this week?"

- **Option A — Today first.** Big "today" card. Drink count, +/− stepper, note field, save. Stats and history below.
- **Option B — Week-at-a-glance.** Seven cells (Mon–Sun), each showing today's drinks, the empty ones tappable to backfill. Calendar/heatmap collapsed by default.
- **Option C — Heatmap-first.** What we had. Pretty, but means logging today is buried.

I lean **A or B**. A is more honest about what the app is for. B is more visually distinctive.
note from cam: I don't think you're right about what the main question is - I think the most important bit is "look at how your drinking is trending", and then actually logging the data is seperate.

### 3. What about the "+1 quick add"?

The old UI had a floating action button. I love a FAB on mobile. But it raises questions:

- Does +1 just add to today's log, or open the modal?
- If +1 silently adds, do we show a toast with undo? (We did. It worked.)
- Does the FAB stay on every screen?

My take: **keep it, mobile-only, anchored bottom-right, with toast-and-undo.** On desktop it's redundant — there's room for a real button.
note from cam: the thinking here is on a night out I want as little obsitcles as possible to logging a drink.

### 4. Heatmap: keep, kill, or simplify?

The year heatmap is gorgeous-on-paper and a UX trap. It only makes sense once a user has months of data. For a new user, it's an empty grid — depressing and confusing.

- **Empty state matters.** If we keep it, the empty state must say something kind, not just be a wall of grey. ("Your year will fill in here. Start with today.")
- **Option A — Keep it, but only show the last N weeks** (12? 26?), not the whole year. Less daunting. Scroll-back for more.
- **Option B — Replace with a simpler week strip + month chart.** Cheaper visually, more useful early.
- **Option C — Both.** Week strip always, year heatmap as a "history" view you opt into.

note from cam: the heatmap sort of vibe is my favourite piece and the main point, I think. I open it up and see: Oh I'm getting more oranges on wednesdays... or hey I'm tren ding greener and greener as expected!"

### 5. Streak treatment

This is the most dangerous part of the app. Streak UI is where alcohol-tracking apps go wrong — they accidentally become sobriety apps that shame you when you slip.

Rules I'd like to commit to:

- **No fire emoji.** No "🔥 12 day streak." This isn't Snapchat.
- **No "you broke your streak" notification, popup, color change, anything.** A streak ending is a fact, not a failure.
- **Show "longest streak" as a quiet record, not a target.** No "X days to beat your record."
- **Current streak should be visible but not loud.** Same weight as "this week" stat. Maybe smaller.
- Possibly: don't show streaks on the main view at all, tuck them in stats. Streaks are a lagging indicator and not actionable.

**Open question:** does the user want streaks at all? They were in the old UI. We could ship without them and see if they're missed.
note from cam: Let's get rid of streaks entirely. you're absolutely right, it's not the vibe. maybe we can let users define their own goals and metrics later.

### 6. The note / journal

The note is the soul of the app. "What happened? How do you feel about it?" The old UI had a Journal tab that listed entries. That's right. Questions:

- Should the note input be inline with the day (always visible) or behind a "details" tap?
- Inline is honest but visually busier. Tap-to-reveal is cleaner but the note gets forgotten.
- I lean **inline, but auto-collapsed when empty** — a "+ add a note" affordance that expands to a textarea. Visible weight only when there's content.

note from cam: Yeah, inline makes the most sense, but since the heatmap is the main point... I dunno!

### 7. Stats strip

The old UI had **seven stats** in a row: this week, this month, all time, sober streak, longest, avg per session, dry days. That is _a lot_.

Pixel's opinion: that's a dashboard, not a UI. Three stats max on the main screen. The rest live in a "stats" / "insights" detail screen if the user wants them.

Proposal for the main screen:

- **This week** (drinks total)
- **Sober days this month** (more useful than "dry days all time" — recent context)
- **One contextual stat** that changes (e.g. "down 4 from last week" or "first dry Friday in a while" — only when there's something kind to say)

**Hard question:** are insights worth building if the user is the only person who'll ever see them? Or is the calendar enough?

note from cam: yep, let's ditch it entirely for now, but put on the roadmap to add some of those.

### 8. Auth UX

Login/register works. It's fine. Two opinions though:

- **Single combined form** that switches mode based on whether the email exists could be slicker than tabs. Less to think about. (But: more API round-trips and harder to error-handle. Probably not worth it.)
- **Demo mode / no-account-needed first run** — let someone log a drink without registering, then prompt for an account when they have data to lose. Big UX win, real engineering cost. Probably out of scope for this rebuild but worth flagging.

Add demo mode to the roadmap.
note from cam: I don't love single login forms as I use a password manager so it just adds more clicks and waits to log in... but maybe i can be convinced?

### 9. Theme

Dark by default per the existing convention. But:

- **Should we offer light mode?** Mobile users at 11pm definitely want dark. Mobile users at the beach might want light. `prefers-color-scheme` respect would be nice. Let's at least _design_ with both in mind.
- **Color**: the old palette was deep indigo. I love it. Proposal — keep indigo as the base, but pick a single accent color and use it surgically. No rainbow stat-strip.

note from cam: We should have it use the user's preference by default. I agree, let's redesign the colours - but I still want the sort of green - yellow - orange - red traffic light sort of vibe for the heatmap.

### 10. The numbers-on-cells question

The old design intentionally **hid drink counts on the year grid** — color only. That's a strong choice. Pros: pretty, meditative. Cons: relies on color alone (accessibility yellow flag — needs a non-color fallback like tooltip/aria-label, which we did via scrub bubble). I'd keep this principle but make sure non-visual access to counts is bulletproof.

note from cam: THis has been an onging back and forth battle. So what I _invisioned_ is a big grid of tiny coloured dots. an easy way to recognise trends from a birds-eye sort of view. and then visually 'dig in' - i invision a magnifying and scrubbing sort of vibe, with the card/day's details magnifing for reading and editing when clicked/tapped. Try and describe this back to me and tell me your thoughts on it.

---

## What I'd like to remove unless you object

These were in the old UI and I'm not sure they earn their place:

- **The "river" timeline view.** It was a third interpretation of the same data the heatmap already shows. Cool, but redundant.
- **Six of the seven stats** in the strip. (See #7.)
- **The undiscoverable scrub gesture.** Marked in CLAUDE.md as intentional. Pixel respectfully disagrees with intentional undiscoverability. If a feature only exists for users who know about it, it doesn't exist. Either make it discoverable or cut it.
- **"avg per session"** as a primary stat. What does it even mean for a personal tracker?

note from cam: yep. remove the stuff you don't get.

---

## What I'd like to add (small)

- A **today timestamp** — show "you last logged 3 hours ago" or "nothing logged today yet" in a quiet, neutral way. Helps the user know where they stand without thinking.
- **Inline editing on history** — tap a past day, edit drinks/note in place. The old modal worked but was heavy.
- **Empty states everywhere.** Each screen should have a genuinely kind, honest empty state. Not "no data yet :(" — something like "Today's blank. That's fine."
- **Reduced motion respect** — `prefers-reduced-motion` for any transitions.

note from cam: go for it. love it.

---

## What I want to _not_ add

- Goals, targets, weekly limits, "daily allowance"
- Notifications / reminders ("you haven't logged today!")
- Achievements, badges, milestones
- Social anything
- Comparison to other users / population averages
- Anything that uses the words "challenge", "score", "rank"

---

## Proposed next-step deliverable

Once you've reacted to the above, I'd like to do this in roughly this order:

1. **Wireframe** the chosen layout in plain HTML — no styling, no JS — just structure. Confirm IA before pixel-pushing.
2. **CSS pass 1** — typography, color, spacing tokens. Get the _feel_ right with placeholder content.
3. **JS** — wire up the API, make it work, no animations yet.
4. **Polish pass** — focus states, transitions, reduced-motion, mobile-specific tweaks, empty states.
5. **QA pass** — mobile (320px), zoom (200%), keyboard-only nav, screen reader, slow network, no-data and lots-of-data extremes.

Each of those is a commit.

---

## Things I need from you to start

Bare minimum:

1. **Answer Q1** (one screen vs. tabs vs. bottom nav).
2. **Answer Q2** (today-first vs. week-strip vs. heatmap-first).
3. **Streak position** (Q5): keep, demote, or kill?
4. **Anything in "what I'd like to remove" that you want me to keep.**

Nice to have: 5. **Visual reference** — a screenshot, an app you like, a mood, anything. Even "I want it to feel like a notebook" or "I want it to feel like a watch face" would help. 6. **One word** for the emotional tone you want when someone opens it. ("Calm"? "Honest"? "Quiet"? "Friendly"?)
note from cam: 5. I kind of imagine the commit graph/heatmap thing that github offers... but it's a bit hard to figure out how to edit data and also see things like "satrudays are heavy drinking days" or "Jan was a massive month". 6. "Honest"

---

That's it. I'm going to go stare at a wall and think about border-radius until you write back.

— Pixel
