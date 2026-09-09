## Evaluation Report — Cycle 3 (evaluation-3.md)

Scope: **CR-3 only**, over `88096648..245fcac9`. CR-1 and CR-2 were proven resolved in cycle 2 and
this diff does not touch their mechanisms.

> **The D4 dark-theme perceptibility BLOCKER from cycle 1 remains open with the owner. This PASS is
> on the three change requests only and does not clear it. The ticket cannot deliver until the owner
> rules on whether `accept-hue-shift` stands on the actual shipped dark values.**

### CR-3 — RESOLVED

The pin now parses. Every claim below is from my own run, not the executor's report.

**1. Garbage probe against the real file — red, for the stated reason.** I set the live `:root` pair
to `#ff0000` / `#0000ff` and both real assertions failed on the **parsed** value:

```
● ... :root --app-accent-text equals the live derivation ...
  Expected: "#fa8737"   Received: "#ff0000"
● ... :root --app-selection-bg equals the live derivation ...
  Expected: "#572e12"   Received: "#0000ff"
```

That is the exact probe that left cycle 2's version fully green at 141/141. It now fails, and it
fails by comparing a value read out of `theme.css` against the live derivation — not by comparing two
literals. The cycle-1→cycle-2 defect is genuinely closed.

(Bonus observation: the self-test *also* failed under that probe, because its `expect(corrupted).not
.toBe(realThemeCss)` sanity line noticed its replacement had become a no-op once the file already
held the garbage values. That sanity assertion is therefore live, not decorative.)

**2. Is the self-test vacuous if the *parser* breaks rather than the value? No — it throws.** This
was the right thing to ask; it is the shape I found twice already. I broke the property regex
(`--app-accent-text` → `--app-accent-textZZZ` inside `parseRootAccentTextFallbacks`) and all three
tests in the block went red with an explicit message:

```
could not parse --app-accent-text/--app-selection-bg out of theme.css's bare :root block
```

The parse helpers `throw` on failure rather than returning `null`/`[]`/`""`, so a malformed file or
a broken pattern cannot degrade into a quiet pass. The "assertion fires on bad input while the parser
silently finds nothing" disease is absent.

**3. The anchor — fails loudly, never silently.** Removing the anchor token entirely
(`--app-focus-ring-color` → `--app-ring-hue` everywhere in `theme.css`) produces:

```
could not find the :root { ... } block containing --app-focus-ring-color in theme.css
```

So a future HEL-1046 change that moves or renames that token breaks this guard **loudly**, with a
message naming exactly what to fix. That is the correct failure mode for a cross-ticket coupling.

One nuance worth recording rather than acting on: the anchor is a **substring** test against the
block body, and the same block also contains `--app-focus-ring: 2px solid var(--app-focus-ring-color)`.
So renaming only the *declaration* still finds the block via the shorthand's reference — I confirmed
this (suite stayed green). That is benign (it still selects the right block) but means the anchor is
really "the bare `:root` block that mentions this string" rather than "the block that declares it".
Choosing it over "first/last bare `:root`" was still the right call, given `theme.css` has three.

**4. The removal is safe — dead in fact, not merely by analysis.** The decisive fact: `data-theme`
is set at `ThemeProvider.tsx:74` **inside an effect**, and `index.html` carries no pre-paint inline
theme script (I read it end to end). So at first paint `<html>` has no `data-theme` attribute at all
and **neither** `:root[data-theme=...]` block can match — the removed declarations could never have
governed a painted frame. They were not merely outranked after hydration; they were unreachable
before it too. The theme effect (`:74`) and the accent effect (`:89`) also flush together, so no
paint occurs between them.

Consumers: every reference is a `var(--app-accent-text)` / `var(--app-selection-bg)` read that
resolves from the surviving bare `:root` fallback pre-effect and from inline style after; no
stylesheet, test, or runtime `getPropertyValue` reads the removed per-theme declarations
specifically. Root `check:tokens` confirms every `var(--*)` still resolves.

Confirmed live on the running app (real `AccentPicker`, 1200ms settle, dark → light → dark with
Orange selected): `#fa8737`/`#572e12` in dark, `#98460d`/`#f5d1b5` in light, restored exactly on
toggle back. Rendering is unchanged in both themes and D10's re-apply-on-theme-change still works.
(`#98460d` rather than `#9d3b08` is correct here — the latter derives from
`DefaultAccentColorByTheme.light` `#ea580c`, which applies only when the user has not picked an
accent; this session has Orange `#f97316` explicitly selected.)

**5. The falling test count masks nothing.** `295 suites / 3075 tests` confirmed by my own explicit
frontend run. The diff touches exactly **one** test file, `accentTextSourceSyncGuard.css.test.ts`,
whose `it(` count goes **8 → 6** — precisely the −2 that takes 3077 to 3075. The D14 block went 5 → 3
(the two duplicate/vacuous per-theme assertions removed, the garbage self-test added), and CR-2's
three parsing tests are untouched: 5+3=8 → 3+3=6. No other test file in the diff, so no removal is
hidden behind the drop.

**6. The `theme.css` comment is now true.** It describes the mechanism — that the pin re-reads this
block's values with `fs.readFileSync` and compares them to the live derivation — rather than naming
a check and overstating it. I verified each clause against the code. This was the third occurrence of
that pattern on this ticket and it is the first version that survives being checked.

Gates, all re-run by me: frontend suite explicit **295 / 3075**, `npm run lint`, `npm run typecheck`,
`npm run format:check`, root `npm run check:tokens` — all clean. Every mutation restored; working
tree clean at `245fcac9`.

### Overall: PASS (on the change requests)

CR-1, CR-2 and CR-3 are all resolved, each proven by mutation rather than by report. Stated plainly,
as asked: **there is no outstanding change request.**

**Equally plainly: this does not make the ticket deliverable.** The cycle-1 D4 BLOCKER is untouched
and unresolved — four of eight presets (Red, Pink, Purple, Blue, at 25–28% dark lightening) are
plainly distinguishable from their raw accents at 14px on `--app-surface`, while the owner's
`accept-hue-shift` ruling was made against contact sheets characterising dark-theme change as
imperceptible. Evidence:
`.concertino/runs/HEL-1048/evidence/evaluator-d4-dark-perceptibility.png`. That is a brand ruling for
the owner, not a defect for the executor: the derivation is correct, and it is correct *because* D2's
scored set was widened as the plan required. Nothing here should be re-derived to dodge the gate —
lowering the dark adjustments means dropping a background class, which is the exact defect D6's
tombstone records.
