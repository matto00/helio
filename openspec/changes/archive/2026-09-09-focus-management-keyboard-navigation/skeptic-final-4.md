## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Narrow round exactly as scoped: re-check round 3's single Change Request (the
`specs/accessible-focus-indicator/spec.md:33` ownership pointer), plus confirm nothing else moved.

### What I verified (with evidence)

**Nothing moved.** `git rev-parse HEAD` → `79431f21f7d23a5f928fcce39b39ce1b90a18dc7`, the HEAD rounds 2
and 3 gated. `git status --porcelain` → one line, `?? .../skeptic-final-3.md` (round 3's own untracked
report). No tracked-file modification, no new commit. Round 3's fix was correctly applied where it said
it would be — in Linear, not in the tree — so the code, gates and mutation proofs it certified stand
byte-identical. I did not re-run them and do not imply I did.

**CR1 — SATISFIED. HEL-1063 now genuinely owns the occlusion detector.** Fetched the live issue. It
carries a new `## Part 3 — rendered occlusion detection` section. This is ownership, not a mention: it
states the problem (an indicator painted behind a sibling is invisible and HEL-520's guard does not
detect it), records the failed approach and *why* it failed, names what a sound version requires
(stacking-context comparison or pixel-level screenshot diffing), and adds a scoping instruction drawn
from this ticket's own history ("a plausible-looking detector that false-positives on a correct site is
worse than no detector"). That is a workable brief, not a placeholder.

**I checked Part 3's technical account against the source rather than against the summary I was given.**
`e2e/support/focusPresenceProbe.ts:130-149` — the module comment says the `elementsFromPoint` sampler
"was implemented and run against the live app", produced "a confirmed FALSE POSITIVE: `.app-skip-link`'s
outline ring, correctly stacked above `.app-command-bar` by z-index (App.css), still sampled as '100%
occluded'", because "neither `outline` nor `box-shadow` ever expands an element's HIT-TEST box; both are
paint-only effects", so it "cannot distinguish 'painted behind a sibling' ... from 'correctly painted on
top of something unclickable'", and a sound version "needs real paint-order resolution
(z-index/stacking-context comparison, or pixel-level screenshot diffing)". Part 3's account reproduces
every one of those claims accurately, including the `.app-skip-link` citation and the line reference.
No detail is overstated and none is invented.

**The one claim in Part 3 I could not take on trust, checked separately.** Part 3 says HEL-520's delta
"narrowed its clipping requirement to clipping only and dropped the 'An indicator painted behind a
sibling is not credited' scenario". True: the delta's `### Requirement: Clipping counts as absence`
(line 17) carries exactly one scenario, `#### Scenario: An indicator clipped by an ancestor is not
credited` (line 21); no sibling/paint-order scenario exists anywhere in the delta. So the restoration
Part 3 assigns is real, unowned-until-now work, not a no-op.

**The pointer now resolves.** `spec.md:33` reads "...is owned by **HEL-1063**". HEL-1063 Part 3 opens by
recording that HEL-520's delta names it as owner "rather than being an unbacked pointer". Both ends
agree, and the text `openspec archive` copies into the permanent spec no longer asserts an owner for
work nobody holds. That was the whole of round 3's objection and it is closed.

### Verdict: CONFIRM

Round 3's block was narrow and its fix is complete and accurate. I share rounds 2 and 3's substantive
judgement that this is a coherent, honestly-described increment: AC2 delivered and measured, AC1/AC3
explicitly de-scoped to filed and now fully-scoped owners, and the unshipped occlusion detector named
with its reason in three places (`files-modified.md`, the probe module comment, the spec delta) rather
than quietly dropped. Ships.

### Non-blocking notes

- `files-modified.md:134` still describes CR3 as having added "an inline note naming occlusion as an
  **unowned** follow-up". That was accurate when written and is now stale — the spec comment names an
  owner and HEL-1063 Part 3 accepts it. It is a historical change-log entry rather than a live claim, so
  it misleads nobody who reads the surrounding section as the log it is; not worth a commit on its own.
- Rounds 1–3's carried notes stand unchanged: `readBackdrop`'s ~30-line duplication of
  `state-surface-contrast-guard.spec.ts`, the detached-trigger case being a labelled wrong-add guard
  rather than proof, and `evaluation-4.md`'s slightly misattributed "added after skeptic-final-1.md"
  heading.
