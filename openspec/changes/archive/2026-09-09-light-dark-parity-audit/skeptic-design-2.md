## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn. Every figure below was recomputed by me from `frontend/src/theme/theme.ts` ×
`frontend/src/theme/theme.css` with a brace-matched block extractor and a WCAG relative-luminance
implementation — parsed, never transcribed from the artifacts. No visual observation was needed at
this gate, so no server was started and no provenance claim is made.

### What I verified (with evidence)

**CR1 (D5 restated from runtime values) — CLOSED.** `ThemeProvider.tsx:89-92` is an unconditional
`useEffect(() => { applyAccentTokens(accentColor); ... }, [accentColor])`; `appearance.ts:331` writes
`document.documentElement.style.setProperty(key, value)` — inline style on `<html>`, outranking both
`:root[data-theme=...]` blocks. `theme.css:161-162` carries the comment saying so. `design.md` D5,
`ticket.md` "THE REAL FINDING", and `proposal.md`'s What-Changes bullet all now state this. Recomputed
independently: `#f97316` on the five light surfaces = **2.38 / 2.73 / 2.38 / 2.80 / 2.80** → min 2.38,
max 2.80; dark 5.58–6.73. Exact match, and the "fails 3:1 as well as 4.5:1" framing is correct.

**CR2 (borders/outlines are a first-class finding) — CLOSED.** `design.md` D3's third row and
`proposal.md`'s enumeration table now read "measured — light accent is 2.38-2.80, so these FAIL 3:1
too"; `tasks.md` 4.2 says "borders count as findings too". Nothing still implies that group passes.

**CR3 (task 3.1 source of truth) — CLOSED.** `tasks.md` 3.1 now says to parse the eight hexes from
`ACCENT_PRESETS` in `theme.ts` and the surfaces from `theme.css`, and 3.1a requires re-deriving the
adversarial pair rather than carrying numbers forward. I confirmed the presets do live in
`theme.ts:23-30` and that `#ea580c` is not among them.

**CR4 (D8a) — CLOSED and numerically correct.** Recomputed: dark default ink `#16130f` on `#f97316` =
**6.61**; light default `#ffffff` = **2.80**; the runtime-written `#181511` = **6.49**. All three match
D8a exactly, and task 5.1a routes it.

**CR5 (computed-style per-surface walk) — CLOSED.** `tasks.md` 4.2 now requires per-surface
computed-style enumeration with the observed surface recorded per site, and explicitly warns a static
classification would report sites the walk never saw.

**Stale-copy sweep (done myself, not taken on account).** `grep -rn "ea580c|asymmetr|3\.02|3\.56"`
across the change dir and the persisted evidence tree. `.concertino/runs/HEL-444/evidence/premise-validation.md`
contains **no** accent-default claim at all (zero hits for `ea580c`/`f97316`/`asymmetr`) — it never
carried the retracted figure, so it needs no correction. The persisted mirror at
`.concertino/runs/HEL-444/evidence/openspec/changes/light-dark-parity-audit/` is byte-current with the
worktree artifacts (both carry the correction). **One stale copy survives** — see CR1 below.

**8-preset matrix, recomputed from scratch (min–max over the five surfaces):**

| preset | light | 3:1 | dark | 4.5:1 |
| -- | -- | -- | -- | -- |
| Orange `#f97316` | 2.38–2.80 | **FAIL** | 5.58–6.73 | pass |
| Red `#ef4444` | 3.19–3.76 | pass | 4.15–5.01 | **fails at min** |
| Pink `#ec4899` | 2.99–3.53 | straddles | 4.43–5.35 | **fails at min** |
| Purple `#a855f7` | 3.36–3.96 | pass | 3.95–4.77 | **fails at min** |
| Blue `#3b82f6` | 3.12–3.68 | pass | 4.25–5.13 | **fails at min** |
| Cyan `#06b6d4` | 2.06–2.43 | **FAIL** | 6.44–7.77 | pass |
| Green `#22c55e` | 1.93–2.28 | **FAIL** | 6.86–8.28 | pass |
| Yellow `#eab308` | 1.63–1.92 | **FAIL** | 8.15–9.83 | pass |

The load-bearing light-theme row of the artifacts is **exactly right** (four fail 3:1, Pink straddles,
shipped default Orange is one of the four). The dark-theme claim is not — see CR2.

### Ruling on the scope question (report-don't-fix at this severity)

**Report-don't-fix remains correct. This is not a BLOCKER and not an escalation.** Reasons, in order:

1. The disposition the plan proposes is already the one an escalation would produce. Retuning a
   saturated 8-preset accent ramp so it clears 3:1 on near-white surfaces means changing the product's
   visual identity across every preset; that is the owner's call, and the plan routes it to the owner
   rather than guessing. An escalation asking "may I retune the accent?" has one predictable answer at
   a design gate ("not inside a parity audit"), and would burn a round.
2. `BLOCKER` is environmental-only by this role's definition. Nothing here blocks verification.
3. The severity change (below 3:1, not merely below 4.5:1) widens the *finding*, which the plan has
   already absorbed correctly in D3/D5/4.2. Severity does not by itself convert a visual-identity
   decision into something a delivery lane may take unilaterally.

**But severity does change one thing, and the plan has not absorbed it: AC2 can no longer be honestly
marked satisfied by this change.** AC2 requires every surface be "legible and on-brand in both light and
dark across all 8 accent presets". The walk will now find the default preset rendering accent text and
accent borders below 3:1 in light, and report-don't-fix means that is not fixed here. Per this lane's
own rule — a deferral is real only if a ticket owns it — the accent retune needs a filed ticket, and no
task currently requires one (5.1 covers `readableLightText`, 5.1a covers D8a, and 5.2 covers defects
*outside* AC2's scope, which this is not). That is CR3.

### Verdict: REFUTE

Both blocking items are small, factual corrections plus one one-line task; nothing in the plan's shape
needs rework.

### Change Requests

1. **`proposal.md:5-6` still states the retracted claim as the change's headline rationale.** The Why
   section reads: "surfaced a real asymmetry the ticket did not anticipate: **`theme.css` ships a
   different default accent per theme, and only the dark one clears AA as normal text.**" That is the
   exact D5 claim round 1 refuted; it is contradicted eight lines later by the corrected What-Changes
   bullet. An executor reading Why first takes the wrong premise. Replace it with the corrected finding
   (one accent renders in both themes; light `#f97316` measures 2.38–2.80, failing 3:1 and 4.5:1).
   Apply the same edit to the persisted mirror at
   `.concertino/runs/HEL-444/evidence/openspec/changes/light-dark-parity-audit/proposal.md`, which
   carries the identical line. Also fix the residual "the accent asymmetry" wording in `tasks.md:47`
   (task 7.2), which would put the retracted word into the PR body.
2. **`ticket.md`'s dark-theme claim is wrong.** It states "in dark all eight clear 3:1 and **all but
   Purple clear 4.5:1**". Recomputed over all five dark surfaces, the minimum ratio fails 4.5:1 for
   **four** presets, not one: Purple 3.95, Red 4.15, Blue 4.25, Pink 4.43. (All eight do clear 3:1 —
   that half is right.) Restate it as "all eight clear 3:1; four (Purple 3.95, Red 4.15, Blue 4.25,
   Pink 4.43) fall below 4.5:1 at their thinnest dark surface", or state the figure per-surface instead
   of as a min. This matters because task 7.2 puts these numbers in the PR body and task 3.1's expected
   result is stated in the same terms.
3. **Add a task that gives the accent finding an owning ticket.** Task 5.2 only routes defects *outside*
   AC2's scope; the accent failure is inside it, so nothing currently requires filing it. Add a task
   under §5: file (or explicitly record with a named existing ticket) the light-theme accent contrast
   finding — default Orange at 2.38–2.80 failing both 3:1 and 4.5:1, plus the four presets failing 3:1
   — as an owner-decision ticket for the retune, and require task 7.2's PR body to state plainly that
   **AC2 is reported-not-satisfied** and to name that ticket. Without this the lane closes with an AC
   silently unmet and a deferral no ticket owns.

### Non-blocking notes

- **Round 1's endorsements re-checked and unchanged** where I touched them: the light `#ffffff`
  raised/strong collision (D7/HEL-866) reproduces from source; the guard gap and D3's enumeration I did
  not re-litigate, per instruction.
- **Evidence path is worktree-invisible.** `design.md` and `ticket.md` cite
  `.concertino/runs/HEL-444/evidence/premise-validation.md`, but `.concertino/runs/` does not exist
  inside this worktree — the file lives only under the main checkout at
  `/home/matt/Development/helio/.concertino/runs/HEL-444/`. An executor running in the worktree that
  follows the citation relatively will find nothing. Consider citing it as repo-root-absolute.
- **Two ink-selection sites, one cited.** `appearance.ts` picks between `readableLightText` /
  `readableDarkText` at **both** 255-265 and 315-320. D3/3.2 cite only "305-326". If the 255-265 site is
  a second, independent contrast path it should be named too — otherwise D8's "the `readableLightText`
  branch is dead" is a claim about one of two branches. Worth a look during task 3.2; not a design
  defect.
- D8a's "pre-mount frame" reasoning is sound but the plan never asks anyone to check whether that frame
  is actually observable (SSR-less Vite app, effect runs same tick). If it is not observable, D8a is
  purely a false-comment defect, which is still worth fixing — just say so.
