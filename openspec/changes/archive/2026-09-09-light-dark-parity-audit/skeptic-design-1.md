## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Provenance.** `ss -lptn 'sport = :5876'` → listener pid 1802114; `/proc/1802114/cwd` =
`.../light-dark-parity-audit/HEL-444/frontend` — THIS worktree. (Three other vite processes exist in
other worktrees; none owns 5876.) No branch-unique served string exists to curl at the design gate —
the branch carries zero code changes, only untracked `openspec/`. Every browser observation below was
re-checked with `location.port` read INSIDE the evaluated function; two reads that came back from port
5935 (a parallel lane hijacking the shared Playwright session) were DISCARDED and re-taken, not used.

**AC1 token parity — CONFIRMED, reproduced independently.** Parsed both theme blocks out of
`frontend/src/theme/theme.css` with a brace-matched extractor (script, not transcription): dark 30,
light 30, `dark - light` = `[]`, `light - dark` = `[]`. The orchestrator's figure is exact.

**AC1's gap vs HEL-1037 — CONFIRMED.** `scripts/check-tokens.mjs:103` accumulates `const definitions =
new Set()` flat across the whole scanned set; there is no `data-theme` awareness anywhere in the file.
A dark-only token therefore resolves and passes. The claim is right, and the guard is not duplicative.

**AC3 text contrast — CONFIRMED, computed from parsed values.** All 20 pairs clear AA. Thinnest is light
`--app-text-muted` (#6c655c) on `--app-surface-soft` at **4.87** — exactly as claimed.

**AC4 ink selection — CONFIRMED structurally.** `theme/appearance.ts:305-326` picks the higher-contrast
of two fixed inks against the accent; `theme` is not an input.

---

### THE FINDING THAT REFUTES THIS PLAN'S CENTRE (D5)

**`theme.css`'s per-theme accent defaults are DEAD AT RUNTIME. Every figure in D5, in ticket.md's "THE
REAL FINDING" table, and in task 4.2 is measured against a value the application never renders.**

`ThemeProvider.tsx:89-92` runs `applyAccentTokens(accentColor)` in an unconditional mount effect, and
`applyAccentTokens` (`appearance.ts:327-332`) writes `--app-accent` / `--app-accent-ink` as **inline
style on `<html>`**. Inline style beats both `:root[data-theme=...]` blocks. Measured on the running app
at port 5876, on a fresh page load (reproduced twice, second time after a hard navigation):

```
inline style attr: "color-scheme: dark; --app-accent: #f97316; --app-accent-ink: #181511;"
data-theme=light  → computed --app-accent #f97316   --app-accent-ink #181511
data-theme=dark   → computed --app-accent #f97316   --app-accent-ink #181511
```

`#ea580c` (theme.css:209) and the light `--app-accent-ink: #ffffff` (theme.css:210) are **never
computed in either theme**. `#ea580c` is not even in the preset list (`theme/theme.ts`).

Consequences, all of which the plan currently gets wrong:

1. **There is no light/dark accent asymmetry.** The app ships ONE accent in both themes. The framing
   "dark clears AA, light was knowingly tuned to 3:1" is not what runs.
2. **The real light-theme numbers are worse than reported.** `#f97316` as text on the five light
   surfaces: bg 2.51, surface 2.73, **surface-soft 2.38**, raised 2.80, strong 2.80. Not 3.02–3.56.
3. **This crosses a threshold the plan assumed safe.** At 2.38–2.80 the default accent fails **3:1**,
   so D3's third group — accent borders/outlines/rings, 63 uses, explicitly assigned "3:1 threshold" —
   is failing too. The plan's own classification says that group was the safe one.
4. This is precisely the D6 class ("what no source text carries"): no declaration expresses it, grep
   cannot see it, and only a computed-style read on the running app shows it. The plan predicted this
   category and then built its headline finding on a source read anyway.

I count this as the plan's premise being wrong, not the product being broken: the product renders one
accent, and whether 2.38 is acceptable for the 41 text sites is the owner's identity call (D5's
report-don't-retune posture remains correct).

### Verdict: REFUTE

### Change Requests

1. **Restate D5 from runtime values.** Replace the "different default accent per theme" finding in
   `ticket.md`, `proposal.md` (What Changes, 3rd bullet) and `design.md` D5 with the measured truth:
   `ThemeProvider.tsx:89-92` → `applyAccentTokens` writes `--app-accent` inline on `<html>`, overriding
   both theme blocks, so `theme.css:209` `#ea580c` and `theme.css:210` `#ffffff` are unreachable. Report
   the default-accent light-theme ratios as **2.38–2.80** (`#f97316` on the five light surfaces), and
   state explicitly that this fails **3:1 as well as 4.5:1**.
2. **Re-scope the border/outline group.** D3 assigns the 63 accent border/outline/ring uses a 3:1
   threshold and treats them as unproblematic. At 2.38–2.80 they are not. Either measure that group in
   light theme as a first-class finding, or justify in writing why a non-text accent border below 3:1 is
   acceptable here. Do not leave the current "measured, 3:1 threshold" line implying it passes.
3. **Fix task 3.1's source of truth.** It says to compute the matrix "PARSING values from `theme.css`".
   For accents that is the wrong file — the eight preset hexes live in `frontend/src/theme/theme.ts`
   (`{ label: "Purple", hex: "#a855f7" }`, `{ label: "Yellow", hex: "#eab308" }`, …) and are what
   actually get written inline. Task 3.1 must parse accents from `theme.ts` × surfaces from `theme.css`.
   D4's "Yellow 1.63:1 on light surface-soft" is downstream of the same matrix and must be re-derived,
   not carried forward.
4. **Add the `--app-accent-ink` default inconsistency as a finding.** Light `theme.css:210` sets
   `#ffffff`, which measures **3.56:1** on `#ea580c` and would fail AA; dark sets `#16130f`. Runtime
   writes `#181511` (6.49:1 on `#f97316`) in both themes, so this is dead except in any pre-mount paint.
   It also contradicts its own comment at `theme.css:161-162` ("Defaults below match DefaultAccentColor")
   — the light default matches neither the dark default nor what `buildAccentTokens` computes. This is
   the same class as D8 and belongs beside it. Either correct the defaults or record it as a routed
   finding; do not leave the comment asserting something false.
5. **Make the walk enumerate rendered accent-text sites by computed style, not by the grep count.** On
   the Dashboards view in light theme, a computed-style sweep found **zero** elements with
   `color: rgb(249,115,22)` — the 41 grep sites concentrate elsewhere (20 of them in
   `PipelineDetailPage.css`). Task 4.2's "classify each of the 41" must therefore be discharged
   per-surface against the running app; a purely static classification would report sites the walk never
   actually saw. State per-site which surface it was observed on.

### Non-blocking notes

- **The guard (D1/D2) IS worth building.** The gap is real, unprotected (CR-verified above), the guard is
  cheap, and task 1.3's "prove the RED arm is reachable before it exists" is the right construction.
  Keep it, and keep D2's expirable-exception rule. This part of the plan needs no change.
- **D3's enumeration is sound and correctly classified** apart from CR2's threshold error — splitting
  the ink group (analytic) from the three accent-against-surface groups is the right call, and
  collapsing 8× to 1× would indeed overreach the ink proof. I found no fifth relationship.
- **Two adversarial presets are sufficient**, once re-derived per CR3. Purple (thinnest ink) and Yellow
  (worst accent-on-surface) bracket both failure axes; no third preset exposes a relationship these two
  do not, since the ink axis is theme-independent and the surface axis is monotone in accent luminance.
- **D7 (HEL-866) is well-placed.** I re-derived it: light `--app-surface-raised` and `--app-surface-strong`
  are both `#ffffff`, byte-identical; dark is #232019 vs #262320. Testing reach-past-modals here and
  reporting INTO HEL-866 is correct.
- **"Guards over conversions" is the right read again** — three ACs hold. Nothing here justifies
  manufacturing conversions, and the REFUTE above is a correction to the plan's claims, not a demand
  for more diff.
