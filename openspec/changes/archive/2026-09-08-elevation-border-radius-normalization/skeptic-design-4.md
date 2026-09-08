## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**1. The evidence-file correction landed.** `cat /home/matt/Development/helio/.concertino/runs/HEL-442/evidence/premise-validation.md`
(the file `ticket.md:26`, `design.md:3`, `workflow-state.md:43` cite as "Full evidence"; it lives in the MAIN
repo's `.concertino/runs/`, NOT in this worktree — the worktree has no `.concertino/runs/HEL-442`). Claim (1)
now reads "CORRECTED at design gate rounds 1-2; my original finding here was WRONG", carries the 47 = 25
token/`none` + 22 non-token split, the 9 rings / 13 insets in four distinct values, and the "not one carries a
y-offset with a blur" positive evidence. The "Already-done scope" paragraph now reads "The shadow half is NOT
'complete' in the sense first reported". Both retracted passages are gone.

**2. Sixth-copy hunt — clean.** Case-insensitive sweep for `0/47|zero (carrying|literal)|no literal|already
complete|shadow half is complete|complete \(0|literal-free` across (a) the whole change dir, (b) the whole
`.concertino/runs/HEL-442/` tree including the persisted `evidence/openspec/**` mirror, (c) `workflow-state.md`.
Every surviving hit is one of: an explicitly-labelled retraction inside `skeptic-design-1/2/3.md` (historical
record, correct to keep), `design.md:31`/`proposal.md:7`/`ticket.md:30`/`workflow-state.md:46` narrating the
correction, or `tasks.md:51`'s explicit **"Do NOT publish the retracted '0/47 literal' figure"** instruction.
No live assertion of the retracted figure remains anywhere. I also confirmed the persisted `evidence/openspec/**`
copies are byte-identical to the live change-dir files (`diff -q` on all 8: `same` for every one), so the mirror
cannot become a stale sixth copy either.

**3. Ground truth re-measured independently** (Python, comment-stripped, multi-line-aware, over
`frontend/src/**/*.css`, 110 files — not a line grep):
```
shadow 47   token-or-none 25   non-token 22
rings (0 0 0 ...) 9   insets 13   other 0   distinct inset values 4
radius literal (excluding var()) 22, of which 50% = 12
  remaining 10 = five sub-scale (1px DividerPanel, 1px PipelineDetailPage, 3px MarkdownPanel,
  4px MarkdownPanel, 4px PipelineDetailPage) + four `0` + one `inherit`
```
Every figure in the corrected artifacts reproduces exactly. The plan's "17 literal radii" = my 22 minus the five
`0`/`inherit` values, which task 2.1 explicitly lists as ALLOWED — internally consistent, not a discrepancy. The
"22 partition exhaustively into 9 + 13" claim is verified: `other 0`. The "four distinct values" claim is verified.

**4. The four mutation arms are genuinely distinct** (`tasks.md:2.4`): (1) literal shadow in a file carrying NO
exception; (2) off-scale radius; (3) STALE exception matching nothing, run against a SHADOW exception; (4) literal
shadow inserted INTO an exception-bearing file. Arms 1 and 4 differ in the property under test (unexcepted vs
excepted file — 4 is the only per-file/pattern-allowance detector, and the task says so); 2 differs in property;
3 differs in mechanism (expiry, not detection). Shadow exceptions are shown expirable by arm 3; radius exceptions
are shown detectable by arm 2. Task 2.1a forecloses the loosening that would make arm 1 pass green
("contains any `var(`"), which is the exact flaw that produced the retracted audit.

**5. Guardrails held.** `Modal.css:60` fenced to HEL-1035 (3.3, with a `git diff` check); focus rings fenced to
HEL-1022 with the correct reason recorded (`--app-focus-ring` is an OUTLINE token, a different mechanism —
2.1b); `PipelineDetailPage.css`'s `var(--radius-sm)` defects fenced to HEL-1037; the 46 accent borders fenced
by 3.4 + documented by 5.1 so a later reviewer cannot "fix" them; the scroll-fade duplication is REPORTED as a
spinoff candidate, not absorbed (2.1b).

**6. Does the plan still protect against the real risk?** The risk profile of a normalization ticket is
confidently changing correct code. The plan's defenses against that are: D1 makes `50%` an ALLOWED value rather
than an exception (2.2 — so no future ticket "resolves" it and breaks avatars/spinner/toggle); 3.1 sets
**LEAVE as the default** for all five sub-scale radii with a per-item running-app decision in both themes; 3.2
turns BottomNav from a decision into a verification against the HEL-774 carve-out; 3.3/3.4 are pure
`git diff`-asserted no-touch fences. Sections 4.2/4.3 are the only open-ended work, and both are structured as
FIXED inventories with per-item recorded results and "report, file a spinoff, do not absorb". Task 1.3 proves the
RED arm reachable before the guard exists, so the guard cannot be a vacuous pass; 2.5 checks what it scans.
I could not find a path by which this plan changes correct code silently.

No environmental blocker; no visual observation was needed at a design gate, so no provenance claim is made.

### Verdict: CONFIRM

### Non-blocking notes

- **Radius-exception staleness is now untested.** Round 3's tightening moved arm 3 from a radius exception to a
  shadow one. That was the right trade (shadow exceptions are the ones that certainly exist — 22 of them), and
  task 2.3 means radius exceptions may well number zero once 3.1's LEAVE default runs. But if 3.1 does produce a
  radius exception, no arm demonstrates it is expirable. Cheap fix if it comes up: have arm 3 stale one exception
  of each kind. Not blocking — the expiry mechanism is shared, and arm 3 proves the mechanism works.
- Task 2.1b calls the ConnectorsPage inset `inset 8px 0 8px -8px`. I count 13 insets across 4 distinct values,
  consistent with that, but the executor should pin from a fresh re-measurement rather than transcribing these
  literals — a transcription typo would produce an exception matching nothing, which arm 3 would (correctly)
  turn RED and cost a cycle.
- My independent radius total was 281 vs the artifacts' 283; the delta is comment-stripping, not substance, and
  the literal counts agree exactly. No correction needed.
