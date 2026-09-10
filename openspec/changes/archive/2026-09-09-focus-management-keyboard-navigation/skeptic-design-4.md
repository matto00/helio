## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold pass at `7b872db9`. Every claim below is re-derived from the tree. I read the three prior
skeptic reports as claims only.

### Correction to the premise I was given

**Round 3 did NOT return REFUTE.** I read `skeptic-design-3.md` twice. On my first read (mtime
`11:49`) it carried `### Verdict: REFUTE` with four change requests about document state. It was
rewritten at `11:50:55` — during my own pass — and now carries `### Verdict: CONFIRM`, with CR1/CR2/
CR3 folded into "verified fixed" and CR4 downgraded to non-blocking note 1.

This is not tampering: the rewritten report explains it itself, in a "Note on the corruption window"
it added — that skeptic saw the duplicated-`D1c` corruption live, drafted CRs against it, then
re-read after the planner repaired the file and revised its own verdict before finishing. It was
still writing when I was spawned. The orchestrator's "three prior REFUTEs" was read from an
intermediate snapshot. **The standing record is CONFIRM, CONFIRM-worthy on my independent check
too.** Flagging because the round count drives the escalation budget.

### What I verified (with evidence)

**Document state — all four orchestrator checklist items hold.**
- `grep -n "^\*\*D1" design.md` gives exactly one each of D1a(54)/D1b(60)/D1d(64)/D1e(81)/D1f(90)/
  D1c(94). 258 lines. No duplicated block. D1d/D1e/D1f preceding D1c is id-ordering, not corruption,
  as stated.
- The retracted "reaches the outline colour channel only" claim is **gone from every artifact**.
  Greps for `colour channel only`, `colour only, never`, `outside it entirely`, `Nothing enforces
  those`, `newly in reach` across `design.md`/`tasks.md`/`ticket.md`/`proposal.md`/`specs/` return
  zero. `ticket.md:52` now reads "**BOTH the `outline` channel AND the border/box-shadow channel are
  already guarded in source**" and cites part 2 at line ~600 correctly. `tasks.md` 3.1a now
  describes both guards and names the residue. Corrections replaced text; they did not accumulate.
- Round-3 CR4 applied: `tasks.md` 3.2b now says "the LIKELIEST — not the expected — finds. A green
  result on them is a perfectly acceptable outcome." (One stale tail survives — note 1 below.)
- Round-3 note on D2b applied: D2b now says outright "**Do not expect a faster run overall**...
  total run cost may well rise", citing the 36-vs-24 `/settings` count.
- Round-3 note on D1c applied: the "§3 never re-measures a token-valued outline" carve-out is gone;
  residue item 2 explicitly covers token-valued indicators re-measured against the real composited
  backdrop.

**The central question: AC2's residue is REAL. All three items survive, and item 3 has a live
instance.** I read `frontend/src/theme/focusRingTokenGuard.css.test.ts` (914 lines) directly.
1. *Paint.* Both guards are `fs.readFileSync` + regex source parses (`:276`, `:301`, `:508`).
   Neither can establish perceivability. A conforming token-referencing `box-shadow` that is clipped
   or occluded passes both. Genuinely unguarded.
2. *Composited backdrop.* The token is derived against surfaces **declared in `theme.css`**; no
   source parse can resolve a paint-time stack. `stateContrast.mjs`'s `compositeStack` exists for
   exactly this. Genuinely unguarded.
3. *Outside part 2's trigger.* `checkBorderIndicatorGuard` opens `if (!groupDeclaresOutlineNone
   (decls)) continue;` (`:548`). Confirmed.

**I verified the planner's 3.2c lead independently, and it holds — including the specificity step.**
`selectorBase` (`:453-466`) strips only trailing `:hover|:focus-visible|:focus|:disabled|:not(...)`.
It does **not** strip attribute selectors, so `.ui-input[aria-invalid="true"]` is a group key
distinct from `.ui-input`. That group (`inputs.css:55-64`) declares no `outline`, so `:548` skips it.
Meanwhile `.ui-input:focus-visible` (`inputs.css:36-42`) also matches a focused invalid input and is
the only rule declaring `outline: none` — uncontested, so the outline IS suppressed at paint. The
attribute-qualified rule (specificity 0,3,0, and later in the file) then overrides both
`border-color` and `box-shadow` with `var(--app-error)` / `var(--app-error-surface)`. Net: the whole
focus indicator of a focused invalid input is error-toned and has never been measured against the
3:1 floor by anything. The chain is sound as written. 3.2c correctly files it as a lead to measure,
not a defect.

So the answer to the question I was asked to test is: **not a null result — AC2 is not already
discharged, and the plan's own framing ("expect this to find little") is if anything conservative.**

**Base-rule tally — re-derived.** `grep -rn "outline:\s*\(none\|0\)" frontend/src --include=*.css` =
11 sites. Base-rule suppressions: `auth.css:107`, `AccentPicker.css:19`, `AddSourceModal.css:165`,
`PipelineDetailPage.css:885` = **four**, matching the artifacts. The other seven are inside
`:focus-visible` rules.

**Constraints I was asked to confirm — all hold.**
- *No pinned site is edited.* `BORDER_INDICATOR_PINS` (`:402-418`) has exactly two entries, both
  `features/sources/ui/AddSourceModal.css`, `owner: "HEL-1052"`. `tasks.md` 3.2 forbids touching it
  with the correct reason; 7.3 adds "Patch no file carrying a `BORDER_INDICATOR_PINS` entry"; 3.2a
  only reads it. No instruction anywhere would edit a pinned site.
- *Jest/RTL scoped to AC4 only.* §6 is the only RTL section; 6.3 states "Do not use Jest/RTL as
  evidence for AC2 or AC3."
- *AC3 real keyboard, AC2 CDP.* 5.0 "Use REAL `keyboard.press("Tab")` here — NOT the CDP
  `forcePseudoState` mechanism §2 uses"; 2.6a mandates `CSS.forcePseudoState` for AC2. Correctly
  split, with 5.3's negative control.
- *Red for the stated reason.* 7.1/7.3 patch **real rendering source** (not fixtures); 7.4 requires
  each arm go red "for the stated reason, not merely red"; 7.5 requires the transcript and states a
  guard that cannot be shown red does not ship.

### Verdict: CONFIRM

The plan is sound enough to implement. The three planner errors this round (base-rule tally twice,
the "border channel unguarded" claim, the splice corruption) are all corrected in the current files —
I re-derived each rather than accepting the correction. The central premise is not just intact, it
is stronger than the plan claims.

### Non-blocking notes

1. **`tasks.md` 3.2b: CR4's softening was applied above a surviving stale tail.** The task now ends
   "...the LIKELIEST — not the expected — finds. A green result on them is a perfectly acceptable
   outcome; do not read this task as a prediction that they will fail. Measure; do not assume either
   way. **That is the thinnest indicator in the app and the most likely genuine AC2 finding.**
   Measure it; do not assume either way." The bolded sentence is the pre-softening text, contradicts
   the sentence before it, has an ambiguous antecedent (3.2b names *two* sites), and its superlative
   is now contestable against 3.2c. Not blocking — the surrounding text and 3.4 both authorize a
   zero-find outcome, and the tail's own last clause is the correct instruction — but it is one
   line's deletion and it is the same append-instead-of-replace defect that cost this round three
   reviews. Delete from "That is the thinnest" to the end of 3.2b.
2. **`tasks.md` 3.1 carries a splice artifact.** "Cite §8 for each call — that guard already covers
   the `outline` colour channel..." — "that guard" has no antecedent (§8 is a DESIGN.md section, not
   a guard), and the clause describes only part 1. 3.1a immediately supplies the correct two-guard
   picture, so an executor is not misled, but the sentence is incoherent as written.
3. **The attribute-qualified-variant blind spot may be broader than 3.2c's one site.** Because
   `selectorBase` does not strip attribute selectors, *any* `[attr]`-qualified `:focus-visible`
   variant whose base rule supplies the `outline: none` is invisible to part 2. Worth a cheap
   enumeration during §3 (grep `\[[a-z-]*=.*\]:focus`) rather than measuring only the one named
   lead; that would also tell the executor whether this is a one-off or a systematic gap worth a
   spinoff against the guard itself.
4. `design.md` D2b reads as two edits joined mid-paragraph ("...expensive. **The focus-presence
   measurement is cheaper PER ELEMENT**..." and "...guessed. So the presence spec takes **no
   per-view cap**"). Content is correct; only the prose seams show.
