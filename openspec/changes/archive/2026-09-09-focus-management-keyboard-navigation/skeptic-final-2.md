## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Gated `3f636ae6` on base `7b872db9` (8 commits, 27 files). `git status --porcelain` empty at
start, after every probe, and at the end. Servers confirmed as THIS worktree's before any rendered
reading: `ss -ltnp` → java 3732398:8859, node 3732729:5952; `readlink /proc/<pid>/cwd` →
`.../HEL-520/backend` and `.../HEL-520/frontend`; `assert-phase.sh servers` → `PASS servers`. All
browser readings taken with `location.port === "5952"` asserted.

### What I verified (with evidence)

**CR1 — FIXED, and I proved it by running the mutation myself (not by reading the transcript).**
Baseline: `npx jest --config jest.config.cjs src/shared/ui/Modal.test.tsx` → 23 passed. I then
deleted `previouslyFocusedRef.current?.focus();` from `frontend/src/shared/ui/Modal.tsx` (verified
present-then-absent by `grep -n previouslyFocusedRef`: lines 83/108/116 collapsed to the `= null`
assignment) and re-ran:

```
● Modal › focus restore › ... 
> 324 |       expect(document.activeElement).toBe(trigger);
      |                                      ^
  (received: the "Close" icon button)
Tests: 1 failed, 22 passed, 23 total
```

That is RED **for the stated reason** — the restore assertion itself, naming the exact line, with
`activeElement` stuck on the dialog's Close button because restore never ran. Exactly one test
failed; the other 22 passed on their own merits, so the stub change did not weaken them. Restored
the file from backup: 23 passed, tree clean. The specific risk you flagged — a stub that makes the
test pass for a new wrong reason — does not materialise: the new stub moves focus to the dialog's
first focusable descendant (real `showModal()` behaviour), the test asserts focus has LEFT the
trigger *while open* (`not.toBe(trigger)` + `toBe(Close)`), and only then asserts it returns. The
first assertion is what makes the second falsifiable, and the mutation confirms it now is.

On the second ("detached trigger") case: it is still not falsifiable by *deleting* the restore line
— with restore gone, focus also stays on Close, so it passes either way. But it is falsifiable by a
wrong *addition* (an unconditional `?? document.body.focus()` fallback), and the file's comment says
precisely that, in those terms. That is a labelled guard rather than proof, which is the correct
category for it; AC4's proof rests on case 1, which is genuinely red. I confirmed jsdom's behaviour
matches the comment's premise (a disconnected element's `focus()` is a true no-op, not a body
fallback) — the executor's self-correction there was right.

**Regression harness — still RED for the stated reasons, my own run at this HEAD.** Byte-identical
ratios to round 1: Case A `pass 4.9596 → no-indicator → pass 4.9596`; Case B `pass 5.1090 →
clipped: outline: clipped on X by ancestor box [302.0,553.3] → pass 5.1090`. 2 passed (19.0s),
`git status` clean afterwards (the Case B tracked-source mutation reverted correctly).

**Main sweep — still 196 / 8 views / 0 residuals.** `/`(19), `/sources`(21), `/pipelines/<id>`(24),
`/settings`(34), each x dark+light, uncapped; `total measured: 196 across 8 view(s)`; 1 passed
(1.7m).

**The shipped fix is still correct — measured live, by me, not inherited.** On
`/pipelines/236b13e7-...`: `.pipeline-detail-header__add-source-btn` box top/bottom 57.0/77.0
(20px) inside `.pipeline-detail-header__group-value` 56.0/78.0 (22px, `overflow: hidden`). At the
global `outline-offset: 2px` the ring would span 53–81 and clip at both edges; computed style is
`outline: rgb(168,129,6) solid 2px; outline-offset: -2px`, keeping the ring inside the 20x20 box.

**Gates, at this HEAD, run by me.** `lint` (eslint --max-warnings=0), `typecheck`, `format:check`,
`check:tokens`, `check:state-contrast:selftest` (35 passed / 0 failed), `npm test`
(**299 suites, 3143 tests, all passing**) — all green.

**UI / design judgement (mine).** Element screenshots of the focused add-source button with its
clipping wrapper, both themes: `.playwright-mcp/skeptic2-hel520-dark.png`,
`.playwright-mcp/skeptic2-hel520-light.png`. A clean, unbroken 2px gold ring fully inside the
control, no edge clipped, reading clearly against both the dark and the light header surface and
consistent with the sibling chip/close affordances. Light/dark parity holds; the ring uses the
shared contrast-derived token with only the offset overridden, and `-2px` is DESIGN.md §8's own
documented carve-out for clip-prone flush children rather than a hand-rolled value. No new
component, no one-off pattern. I have no visual objection to the shipped diff.

**Round 1's non-blocking notes** are genuinely fixed: the stale `#email` "real baseline verdict is
fail" comment and both stale "occlusion sampling" comments are gone (`3f636ae6` touches
`e2e/focus-presence-guard.spec.ts` and `hel520-focus-presence-guard.regression.spec.ts` comments
only). `readBackdrop` duplication left as-is, as agreed.

**CR3 — tickets are real, but cited in only one of the four places round 1 named.** `grep -rn
"HEL-1062\|HEL-1063"` across the change dir returns hits in `files-modified.md` (a good, specific
ownership block at lines 341–363) and one comment in `e2e/support/focusPresenceProbe.ts` — and
nowhere else. `proposal.md:50` "Scope amendment" still reads "split into follow-up tickets" with no
identifier. `specs/accessible-focus-indicator/spec.md`'s occlusion comment still ends "an owned,
unimplemented follow-up" with no identifier — and that comment is the text that gets archived into
the permanent spec, where it is the pointer the "unfixed sites are named rather than omitted"
requirement depends on. `tasks.md` §4 (line 128) and §5 (line 141) still have no head note, so
their unchecked boxes still read as unfinished work in this change.

**CR2 — narrowed in `files-modified.md`, but `evaluation-4.md` still overclaims.**
`files-modified.md`'s AC accounting is now exemplary and even self-corrects its own earlier line
("until then this line overclaimed"). But `evaluation-4.md`'s per-AC table — explicitly headed
"**(independent), for the delivery report**" — still records AC2 as "**Delivered by this change**",
and line 136 still states "of the four ACs, this change delivers **AC2 in full**". Nothing in the
change dir marks that as superseded. Whichever artifact the delivery report is written from, the
tree currently says both things.

### Verdict: REFUTE

The decisive objection is resolved: CR1's AC4 restore coverage is now real, and I proved it red
myself rather than trusting the recorded transcript. The measurement spine, the RED harness, the
one real found-and-fixed defect and every gate re-confirm cleanly at this HEAD. **No code change is
required.** What remains is that the artifact set still contains the exact overclaim CR2 asked to
remove, and three of the four deferral pointers CR3 enumerated are still unnamed — including the
one that gets archived into the permanent spec. On a ticket whose entire review history is
completion claims outrunning their evidence, shipping a tree that says "AC2 in full" in one file and
"met for the measured population" in another is the inconsistency itself, not a nit about it. This
should be one small documentation commit and a round-3 re-check, not another execution cycle.

### Change Requests

1. **Cite HEL-1062/HEL-1063 in the three remaining places round 1 named.** (a)
   `proposal.md:50`'s "Scope amendment" — replace "split into follow-up tickets" with the two IDs
   and which AC each owns. (b) `specs/accessible-focus-indicator/spec.md`'s occlusion comment —
   replace "an owned, unimplemented follow-up" with the owning ticket ID; this comment is archived
   into the permanent spec, so it is the one that most needs a dereferenceable pointer. (c) A
   one-line pointer at the head of `tasks.md` §4 (line 128) and §5 (line 141) stating the section is
   de-scoped to HEL-1062 / HEL-1063 respectively, so the unchecked boxes are not read as unfinished
   work in this change.

2. **Resolve `evaluation-4.md`'s surviving "AC2 in full" claim.** Its per-AC table (AC2 row:
   "Delivered by this change") and line 136 ("delivers **AC2 in full**") are the only remaining
   statements in the tree that CR2 asked to narrow, and the table is explicitly labelled as the
   delivery report's source. Do **not** silently rewrite a past evaluator's report — prefer a dated
   superseding note at the head of `evaluation-4.md` pointing at `files-modified.md`'s
   "AC accounting as delivered" and stating that AC2 is claimed met-for-the-measured-population
   only, with the unmeasured surfaces owned by HEL-1063. Then confirm no artifact still asserts AC2
   unqualified.

### Non-blocking notes

- The detached-trigger case is a wrong-add guard, not proof (deleting the restore line leaves it
  green). Its comment already says exactly this, which is the right handling — flagged only so the
  delivery report does not count it as a second piece of restore *proof*.
- `readBackdrop` in `focusPresenceProbe.ts` still duplicates ~30 lines of
  `state-surface-contrast-guard.spec.ts`. Carried forward from round 1; still non-blocking.

### On the subjective call: yes, this should ship as HEL-520 (once CR1/CR2 above land)

I was asked whether this is a coherent, honestly-described increment given AC1 and AC3 are not
delivered and AC2 is narrowed. It is. What ships is a rendered focus-indicator measurement
capability that did not exist on base (source parses only), a demonstrated-RED harness for both of
its failure branches, 196 elements measured across both themes at the real 3:1 non-text floor, one
genuine clipped-ring defect found by that measurement and correctly fixed, and an AC4 restore test
that is now falsifiable. That is a real, self-consistent unit of work with a real spec delta behind
it. AC1 was already satisfied in behaviour on base and only its rendered verification is deferred;
AC3 was never started and is honestly not claimed. Both now have filed owners. I would not re-scope
or re-title the ticket — the only thing standing between this and delivery is making every artifact
say the same true thing.
