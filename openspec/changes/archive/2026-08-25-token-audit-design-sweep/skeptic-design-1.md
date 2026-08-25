## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All commands run in `frontend/src` of the worktree.

**1. DESIGN.md §3 is the standard the plan claims it is — confirmed.** Read §3
directly. The four mechanical categories (color / spacing / typography / family),
the ≤4px optical-tweak allowance, the 4px-base scale, and the documented data
exceptions (AccentPicker swatches, appearance presets, chart series palettes) are
all quoted accurately in `design.md`. No misquotation found.

**2. Precedent guard tests exist and the pattern is real — confirmed.** Read
`shared/ui/Modal.css.test.ts`. It is a `fs.readFileSync` + static-source-assert
test with brace-matching helpers, and it explicitly cites `inputs.css.test.ts` as
its own precedent. 22 `*.css.test.ts` files already exist. The plan's guard-test
approach is genuinely grounded in existing practice.

**3. HEL-729 guard-placement reasoning — confirmed correct.** HEL-729 targets a
different rule pair (unstyled BEM classes, Modal-footer props) via a repo-wide CI
script; this ticket's guard is a per-file Jest test. Non-overlapping. No objection.

**4. Ran the design's own five grep patterns over the real tree.** 96 `.css` +
373 `.tsx` files. Raw hits: color 147, spacing 197, font-size 0, font-weight 0,
font-family 91. That is where the plan starts diverging from ground truth:

**5. Categories 3 and 4 are already clean — no-ops.**
`grep -rEn "font-size:" | grep -v "var(--text"` and the `font-weight` equivalent
return only `var(--eyebrow-size)` / `var(--eyebrow-weight)` indirections. Zero
literal px/rem font-sizes and zero numeric font-weights exist. Two of the five
planned patterns will find nothing.

**6. Category 5 (font-family) is 100% false positives.** All 10 non-token hits are
`font-family: inherit` (`inputs.css:17,140`, `EmptyState.css:114,143`,
`toast.css:120`, `OnboardingChecklist.css:152,210`, `AddSourceModal.css:134`,
`StatusMessage.css:42`, `InlineError.css:43`). `inherit` is not an ad-hoc family.
The design's pattern 5 ("every hit not referencing `var(--font-*)`") flags all 10
as violations.

**7. Color category is ~96/147 test-file noise plus non-styling data.** Test files
account for 96 of 147 hits; `theme/theme.css` another 39. The entire non-test,
non-theme candidate set is 12 lines, and on inspection nearly none are styling
violations: `MfaEnrollModal.tsx:113-114` `bgColor="#ffffff"`/`fgColor="#000000"`
are QR-code scannability values (functional, not themeable);
`PreferencesEditor.tsx:28-30` are appearance defaults; and 3 of the 6
`DividerEditor.tsx` hits are inside **code comments**. None of these categories —
test files, code comments, QR codes, `PreferencesEditor` defaults — are in
`design.md`'s exclusion list, which names only `theme.css`, `theme/appearance.ts`,
`AccentPicker.*`, and chart palettes.

**8. The false-negative-impossibility claim is disproven (reproduced).**
`design.md` asserts false negatives "would require a token being expressed in a
form these patterns don't match (e.g. `0x` hex without `#`, which isn't valid
CSS)". Patterns 2 and 3 are anchored to `(px|rem)` and miss em units:
`font-size: 0.85em` (`MarkdownPanel.css:79`), `0.8em` (`MobileNavSheet.css:161`,
`EmptyState.css:171`), and 6 em-unit spacing declarations in `MarkdownPanel.css`
(lines 81, 92, 99, 109, 117, 133). Reproduced on a second run.
(To the plan's credit: I probed the mixed-shorthand form `var(--space-2) 8px`,
which pattern 2 would also miss — 0 instances exist, so that specific gap is not
live.)

**9. The core premise "the vast majority are safe 1:1 swaps" is empirically
false — the load-bearing finding, reproduced twice.** I classified every
`margin`/`padding`/`gap` px/rem literal against the §3 scale
{4,8,12,16,20,24,32,40,48,64}:

| bucket | run 1 | run 2 |
| --- | --- | --- |
| on-scale (fixable 1:1) | 108 | 84 |
| ≤4px (allowed optical tweak) | 75 | 75 |
| **off-scale >4px (no token exists)** | **120** | **120** |

The off-scale count is stable at 120 across both extraction methods and **exceeds
the fixable set either way**. Off-scale values by frequency: `6px` ×44, `10px`
×34, `14px` ×12, `7px` ×11, `5px` ×9, then `6.4/5.6/4.8/18/30/60px`. `ticket.md`
and `proposal.md` both assert the fixable cases are "the vast majority"; they are
at best a slim minority of the >4px population.

### Verdict: REFUTE

The methodology is genuinely mechanical and the HEL-729 reasoning is sound, but
the plan rests on a factual premise about the codebase that ground truth
contradicts, and that error propagates into an unachievable acceptance criterion,
an unimplementable guard test, and a tolerance rule that contradicts a second
acceptance criterion. These are cheap to fix now and expensive to discover
mid-execution.

### Change Requests

1. **Reconcile AC #1 with "do not invent new tokens" — they are mutually
   exclusive as written.** AC #1 demands "zero hardcoded color/size/weight/family
   literals outside the documented §3 exceptions", but 120 off-scale >4px spacing
   literals have no corresponding token, and the ticket forbids adding tokens.
   The sweep therefore *cannot* reach zero. Pick one and write it into
   `ticket.md`/`design.md` explicitly: (a) restate AC #1 as "zero literals **for
   which a matching token exists**", with the off-scale residual enumerated as
   the deliverable; or (b) widen scope to add tokens (contradicts Non-Goals and
   HEL-680); or (c) split. Option (a) looks correct — but it must be stated, not
   left implicit.

2. **Correct the "vast majority" premise in `ticket.md` (Deliverable shape) and
   `proposal.md` (What Changes).** Replace the claim that fixable 1:1 swaps are
   "the vast majority — px/rem values matching existing token values almost
   exactly" with the measured distribution (finding 9). The executor will size its
   work off this sentence; as written it will expect ~all-fix and encounter
   ~60%-flag.

3. **Drop the "~1px tolerance" or reconcile it with AC #2.** `design.md`
   ("Nothing wrongly flagged") permits substituting a literal "within ~1px of a
   real token's value". That licenses `5px→--space-1` (×9) and `7px→--space-2`
   (×11) — 20 real, visible geometry changes — which directly violates AC #2
   ("light and dark render identically to pre-change"). Require **exact** value
   match for a `fix` disposition, or explicitly carve out and sign off the near-
   miss substitutions as intentional visual changes.

4. **Fix the guard test's specification — as written it cannot pass.** The guard
   is specified to assert "the five grep patterns find zero disallowed hits" in
   each swept file, "accounting for the same documented exceptions". But ~120
   flagged residuals will legitimately remain in swept files and are *not*
   documented exceptions. Specify the actual mechanism: an explicit
   allowlist/baseline of known-residual literals (file+line+value) that the test
   pins, so reintroduction of anything *new* fails while the known residual
   passes. Without this, task 3.1 is unimplementable.

5. **Expand the exclusion list to match ground truth.** Add to `design.md`'s
   enumeration exclusions, with justification: (a) `**/*.test.ts(x)` — 96 of 147
   color hits, fixtures not styling; (b) CSS/JS **comments** — 3 of 6
   `DividerEditor.tsx` hits; (c) `MfaEnrollModal` QR-code `bgColor`/`fgColor`
   (functional black/white, not themeable); (d) `PreferencesEditor.tsx:28-30`
   appearance defaults (same "data, not styling" rationale §3 grants
   `theme/appearance.ts`). Without these the enumeration reports mostly noise.

6. **Fix pattern 5 (font-family) to not flag `font-family: inherit`.** All 10
   current non-token hits are `inherit`, which is correct CSS and not an ad-hoc
   family. Exclude `inherit`/`unset`/`initial`, or the category reports 10/10
   false positives.

7. **Repair or retract the false-negative-impossibility argument.** Either widen
   patterns 2 and 3 beyond `(px|rem)` to cover `em`/`%` (9 live instances,
   finding 8), or state explicitly that relative units are an accepted form and
   out of scope — but delete the claim that false negatives are structurally
   impossible, which is false as written and is currently the *entire* basis of
   the "nothing missed" verification direction.

8. **Correct the HEL-680 reconciliation.** `ticket.md` and `proposal.md` describe
   HEL-680 as covering "the one already-known case, the compact-chip padding
   literal" (`padding: 2px 7px`). The audit will actually produce ~120 off-scale
   literals needing token decisions, dominated by `6px` (×44) and `10px` (×34) —
   not one case. Either broaden HEL-680's stated remit or note that this audit is
   expected to spawn a larger token-scale follow-up, so the residual isn't
   silently dropped at PR review.

### Non-blocking notes

- Record in `design.md` that categories 3 (font-size) and 4 (font-weight) are
  **already clean** (finding 5). Keeping the greps as regression guards is
  correct; the executor should just know upfront they are expected no-ops rather
  than suspecting a broken pattern.
- `tasks.md` 4.3 asks for a visual spot-check of "every touched page/component,
  light + dark". Once CR#1/#2 land, the touched set is roughly 84-108 spacing
  substitutions; consider naming the concrete surface list in tasks so the
  executor can't quietly narrow it.
- The RED-first requirement (task 3.2, mirroring HEL-813's `touchTargetProbe.ts`)
  is correctly specified and should be kept exactly as-is.
- Environmental note, not blocking: this worktree's `scripts/concertino/` predates
  `next-report-number.sh` (it has only assert-phase/cleanup/setup-worktree/
  start-servers). I used the canonical copy at
  `/home/matt/Development/helio/scripts/concertino/next-report-number.sh` rather
  than guess a filename; it returned `number=1`.
