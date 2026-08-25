## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All numeric/citation claims re-derived directly from the archived HEL-772 change
(`openspec/changes/archive/2026-08-21-anchor-mobile-command-bar/`), not from the
planning artifacts' assertions.

| Claim in design.md / tasks.md | Ground truth | Verdict |
|---|---|---|
| `.app-command-bar__right` gapped by `var(--space-2)` (8px); design.md line 119 | archived `design.md:119` — "gaps its controls by `var(--space-2)` (8px). A 44px hit region around a 28px box extends 8px per side" | CONFIRMED |
| Real extent **35.75px** at 8px gap while `::after` still computes 44px; line 122 | archived `design.md:122-123`; corroborated `evaluation-1.md:178`, `tasks.md:36` (4.7), `skeptic-design-5.md:36` | CONFIRMED (4 independent sources) |
| Gap widened to `var(--space-4)` (16px); lines 123-124 | archived `design.md:123`, `tasks.md:36`, `tasks.md:61` (6.10 static guard) | CONFIRMED |
| Tiling `294..338 \| 338..382 \| 382..426`, zero overlap | archived `skeptic-design-5.md:82` — "294.00..338.00 \| 338.00..382.00 \| 382.00..426.00 abut exactly, 0 overlap"; `design.md:124` | CONFIRMED (exact) |
| `elementFromPoint` bisection at 0.25px step; `tasks.md` line 78 = task 7.11 | archived `tasks.md:78` is indeed 7.11 and states the method, the `>= 44 - samplingStep` assertion, and the never-widen-the-gap rule verbatim | CONFIRMED |
| `evaluation-1.md` line 177 carries the readings | archived `evaluation-1.md:177` — "43.75 horizontal for the abutting icon buttons, 44.5 for the last-in-row user menu" | CONFIRMED |
| ~43.75px is the legitimate correct-build abutting reading | `evaluation-1.md:35-36,177`, `evaluation-2.md:133-134`, `skeptic-design-5.md:34` (43.75 @0.25px, 43 @1px, 43.999 @1e-3) | CONFIRMED |
| Painted-box sampling reports **zero** violations despite the real defect (D3) | archived `skeptic-design-4.md:44` ("neighbour-painted-box overlaps: **0**"), `:133` ("grid-sampling every painted box reports **0 stolen**"), `design.md:120,128` | CONFIRMED |
| `--control-sm` 28 / `--control-md` 32 / `--control-lg` 40 (D2 rationale) | live `DESIGN.md:196-197`; corroborated `skeptic-design-3.md:112` | CONFIRMED |
| PR #409 merged as `98862321` | `git log --oneline -1 98862321` → "HEL-772 Anchor the mobile command bar… (#409)" | CONFIRMED |

Target-clause ground truth: `DESIGN.md:192-210` (`### Control metrics`). The `::after`
clause is a single sentence at **lines 205-208** — design.md's "line ~207" is accurate.
The paragraph does mix multi-sentence rules (the 44px floor sentence, the color-swatch
exemption) in one block, so **D1**'s justification for appending inline rather than
adding a `####` subheading is factually grounded, not asserted.

Scope/AC coverage traced: ticket AC1-3 → task 1.3; AC4 → task 1.4; all four re-traced
at task 2.1. `proposal.md` Non-goals correctly fence off HEL-778 (selector scoping) and
re-litigation of the 44px floor. Spec delta declares one ADDED requirement with three
scenarios, each of which maps to a distinct AC and is checkable by reading `DESIGN.md`
— appropriate for a documentation-content capability. No placeholders, no `TODO`/`TBD`,
no unresolved decision, no internal contradiction between proposal/design/tasks found.

`git status` in the worktree shows only the untracked change dir — no code touched,
consistent with the documentation-only claim.

### Verdict: CONFIRM

Every number the plan cites survives independent re-derivation, most from two or more
archived sources. I specifically tried to break the two most load-bearing figures
(35.75 and 43.75) and both are multiply corroborated across design.md, tasks.md,
evaluation-1.md, and skeptic-design-5.md. The plan is sound enough to implement.

### Non-blocking notes

- **Mis-citation (cosmetic, planning-only).** design.md attributes the quote "the
  threshold takes the epsilon, not the gap" to `skeptic-design-5.md line 232`. That
  exact string is in archived `tasks.md:78`; `skeptic-design-5.md:232` reads "16px is
  right; the threshold is what needs the epsilon." Same substance, wrong source. This
  lives in design.md's Context, not in prose that ships into `DESIGN.md`, so it is not
  blocking — but correct the attribution so a later reader isn't sent to the wrong file.
- **Placement vs. the `[mechanical]` tag.** The paragraph ends at `DESIGN.md:210` with
  `**[mechanical]** No other control heights.` — per `DESIGN.md:19`, that tag marks
  deterministically-checkable rules. D1 says "append directly to the existing `::after`
  sentence," which places the addition at ~line 208, *before* line 210 — correct. Worth
  making explicit in execution so the new (partly judgment-based, partly procedural)
  prose is not accidentally placed after line 210 where the `[mechanical]` tag would
  appear to scope it.
- **Environment observation, not a blocker.** At the worktree's commit (`3ecfad26`)
  `scripts/concertino/` tracks only 8 files; `next-report-number.sh`,
  `persist-evidence.sh`, and `emit-event.sh` are absent from the worktree and exist only
  in the main checkout. I ran the main checkout's `next-report-number.sh` against this
  change dir (returned `number=1`; no prior `skeptic-design-*` existed, so numbering is
  unambiguous) rather than guessing a filename.
