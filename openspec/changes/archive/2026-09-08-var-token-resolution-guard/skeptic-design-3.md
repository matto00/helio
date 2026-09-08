## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Base verified: `git log --oneline -1` → `3a0c0fe8 HEL-441 ...`, `git merge-base HEAD origin/main` →
`3a0c0fe8ab5c...`. Worktree is at the declared base with no drift.

### HALT RULE: NOT TRIGGERED

I looked specifically for a third fix-interaction defect — two individually-correct decisions in
these artifacts that are jointly broken. **I did not find one.** The round-2 fixes hold up jointly,
and one of them demonstrably *saves* a case I expected to break (see "Interactions checked", item 4).
CR1 below is adjacent to an interaction but is not one: it is an under-specified arm of a
disjunction the design deliberately left open, not two correct fixes colliding. The run should
continue.

### What I verified (with evidence)

**Premise, re-measured independently** (own script over 110 `.css` files under `frontend/src`, not
inherited from either prior report):

| claim | measured | verdict |
| --- | --- | --- |
| 81 tokens in `theme.css` | 81 (declaration-anchored) | ✓ |
| 83 across `frontend/src` | 83 | ✓ |
| 89 unique `var(--*)` refs | **89 pre-strip / 88 post-strip** | see CR3 |
| 8 unresolved = 3 defects + 5 runtime | 8, exactly as itemised | ✓ |
| naive matcher 99/16 post-strip, 100/17 pre-strip | 99/16 and 100/17; the pre-strip extra is exactly `--error` | ✓ |
| the 16 spurious names | identical set, name for name | ✓ |

The 8 unresolved resolve exactly as documented: `--radius-sm` ×2 (`PipelineDetailPage.css:524,543`),
`--text-small` ×1 (`:538`), `--space-sm` ×1 (`AddSourceModal.css:111`), plus the 5 runtime tokens.

**Round-1/round-2 CRs actually addressed, not merely acknowledged:**
- R2-CR1 (exit code is one bit) → design D3a point 2 and task 4.2b both name the token each case must
  see in the output (`--decoy`, `--nope`, "nothing"). Present in both documents, consistently.
- R2-CR2 (live count is a maintenance trap) → task 1.3a explicitly REJECTS `definitions == 83`;
  design D3a point 1 rejects it with reasoning; the detector moved to task 4.2a's controlled fixture;
  the spec requirement is mechanism-neutral ("SHALL NOT be expressed as a fixed count"). Genuinely
  moved, not restated.
- R2-NB-1 (`--error` precondition) → carried into design D3a and task 1.2a with "QUOTE THE
  PRECONDITION". Verified `ToolCallIndicator.css:81` is prose in a comment, not a selector.
- R2-NB-2 (seam precedent) → verified at source: `check-dependabot-groups.mjs:392` is literally
  `process.argv[2] ?? join(...)`, the main guard is at `:421`, and the file has 6 `export`s.

**Every other checkable factual claim, verified at source:** `motionTokenGuard.css.test.ts` has ZERO
exports and its `stripComments` at `:40-42` matches the regex tasks.md quotes character for
character; `MobileNavSheet.css:54-55` wraps `var(--app-top-chrome-` mid-token exactly as described;
`toast.css` defines `--toast-exit-duration:49` and `--toast-intent-color:72,76,80,84`;
`check-node-root-encoding.mjs:49` is a membership list of exceptions, not a count;
`check-no-credential-in-agent-surface.selftest.mjs` is `finally`-guarded AND startup-cleaned
(`:128-135`), confirming task 4.3b's "take the startup-cleanup half" precedent.

**Is the exact-set fixture sufficient?** I enumerated the source line of every one of the 16 spurious
definitions. All 16 are `--modifier` followed by a pseudo-class (`:hover`, `:disabled`,
`:focus-visible`, `:hover:not(:disabled)`) or a pseudo-element (`::before`,
`::-webkit-scrollbar`). The fixture's two decoys (`.a__b--decoy:hover`, `.x--other::before`) cover
both structural shapes; no real-corpus shape places the `--x:` any closer to declaration position
than the decoys do (none follows a `{` or `;` on the same line). **A declaration-anchored matcher
that rejects both decoys cannot admit any of the 16.** The mechanism is sufficient, subject to CR1.

**Fifth cause of red-on-`main`?** None. With comment-stripping + full source set + the 5-token
allowlist + the 3 defect fixes, my measurement yields exactly zero findings. Empirically the three
documented causes are the complete set.

**Gate-chain wiring is real and needed.** `.husky/pre-commit` and `.github/workflows/ci.yml` both
exist with `check:*` blocks; CI carries three comments (`ci.yml:32`, `:47`, `:56` — HEL-913,
HEL-846, HEL-996) each recording a check that existed as an npm script but was wired into only one
of the two places. Task 5.1 wires both. Precedent supports it directly.

**AC coverage is complete and evidence-producing.** Each of the ticket's five ACs traces to a task
that yields output, not an assertion: mutation → 6.2; first-run pass distinguishable from the
defect-fix → 6.1's untouched-`main` run; `MobileNavSheet:54-55` specifically → 4.2; setter-named
allowlist → 2.1/2.2; CI → 5.1.

**D5 is tractable and correctly framed.** `--app-radius-sm: 6px` exists, so `--radius-sm` has a
direct target. `--text-sm`/`--text-xs` both exist, so `--text-small` needs judgment. Critically the
space scale is purely numeric (`--space-1`…`--space-10`) — **`--space-sm` has no nearest-name
target at all**, so task 3.2's "read the declaration, don't pick by nearest name" is load-bearing
rather than boilerplate, and 3.3 correctly fences the resulting judgment off from HEL-830.

### Interactions checked jointly (the halt-rule question)

1. exact-set fixture × comment-stripping — the comment case needs no definitions post-strip; no
   collision.
2. allowlist × scan-root seam — the allowlist is hardcoded in the guard and is scan-root-independent;
   no collision.
3. "must pass" cases × scan root — any green case must define its own tokens inside the fixture,
   since `theme.css` is outside the temp root. Consistent with 4.2a's fixture as written.
4. **scan-root seam × fixture directory layout** — the cited precedent's seam is a *repo root*, so
   the guard derives `<root>/frontend/src/**/*.css`. A fixture laid out as `<tmp>/fixture.css` would
   scan zero files, exit 0, and silently neuter every "must fail" case. **Round 2's fix catches
   exactly this**: an empty scan names no token, so the `--decoy` case goes red loudly. This is the
   one place I expected a third interaction and instead found the round-2 rule working as intended.

### Verdict: REFUTE

Three revisions. All are cheap; none is a structural rethink; none triggers the halt rule.

### Change Requests

1. **The seam is offered as a disjunction, but only one arm can carry task 4.2a's exact-set
   assertion — and that assertion is the sole protection against the round-1 fail-open hole.**
   design.md's Gate-Chain checklist says the guard must expose "**either** an explicit scan-root
   argument **or** a pure extractor function", and task 4.3a says "Say in your report which you used
   and why" — so scan-root-only is a permitted choice. But task 4.2a asserts on "the extracted
   definition set", which a scan-root-only implementation cannot observe: the guard's stdout lists
   *unresolved references*, never definitions. An executor who legitimately picks the scan-root arm
   finds 4.2a unimplementable as written and will improvise. Given the orchestrator's own framing —
   this assertion is the only thing standing between the guard and the fail-open hole — the choice
   must not be left open. **Required:** either (a) mandate the exported pure extractor in D3a point 1
   and task 4.3a (drop the "either/or"), or (b) if the output-only path is to remain permitted, spell
   out its full equivalent in 4.2a — the fixture must reference **all three** of `var(--real)`,
   `var(--decoy)` and `var(--other)`, and the case must assert the output names `--decoy` AND
   `--other` AND **does not** name `--real`. As written 4.2a asserts only the `--decoy` half, which
   is cardinality-blind. Make design.md and tasks.md say the same thing either way. (This is the
   design/tasks-disagreement class that was round 1's CR3 and has now recurred; it is the third
   sighting in this lane.)

2. **`var(--token, fallback)` semantics are undecided in all three artifacts, and 11 of the 12
   allowlisted-token usages depend on it.** Measured: every `var()` with a fallback in the entire
   frontend (11 occurrences) is an allowlisted runtime token — `var(--panel-surface-override,
   var(--app-surface))` and siblings — and `--mobile-panel-height` (`MobilePanelStack.css:26`) is the
   sole allowlisted token used *without* one. Neither proposal.md, design.md, tasks.md nor spec.md
   mentions the fallback form at all, yet it materially changes the guard's coverage: a
   fallback-bearing reference does **not** fail open (it resolves deterministically to the fallback),
   so a defensible implementer could exempt it — and a `var(--typo, 4px)` would then pass forever.
   The opposite choice is equally defensible. Two readings, durable consequence, no stated decision.
   **Required:** add a decision (suggest D3b) stating whether a fallback-bearing reference is still
   subject to the resolution rule, with the reasoning; add a matching selftest case in section 4; and
   note in D4 that the allowlist is still required regardless, because `--mobile-panel-height` has no
   fallback. This does not change the red-on-`main` analysis — all 11 are allowlisted anyway, so
   first-run pass is unaffected either way.

3. **"89 unique `var(--*)` references" is a pre-strip count quoted in the same sentence as the
   post-strip "8 unresolved", with no precondition attached.** Measured: 89 pre-strip, **88**
   post-strip; the difference is exactly `--app-top-chrome-`, the same comment fragment this ticket
   exists to handle. This is the identical defect class as round 2's NB-1 (99/16 vs 100/17), which
   was fixed for the definition counts but not for the reference count. It appears in ticket.md
   ("Measured scope"), design.md ("Context"), and workflow-state.md ("PREMISE RE-MEASURED"). Under
   this lane's own recorded lesson, a re-measurement post-strip yields 88 against a document saying
   89 and the reader rightly distrusts the rest. **Required:** state it as "89 pre-strip / 88
   post-strip (the difference is `--app-top-chrome-`)" in all three places, or quote 88 with the
   post-strip precondition named, matching the 8-unresolved figure it sits beside.

### Non-blocking notes

- design.md D3a/NB-2 and task 4.3a describe the precedent's main guard as
  `import.meta.url === process.argv[1]`. The actual code at `check-dependabot-groups.mjs:421` is
  `process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]`. The paraphrase, copied
  literally, is always false (a `file://` URL never equals a path) — `main()` would never run and the
  guard would exit 0 on everything. Both documents do point the executor at the file, and task 4.2b's
  output-naming assertions would catch it in the selftest, so this is not blocking — but the
  paraphrase is worth correcting to the real expression rather than leaving a fail-open one-liner in
  the instructions.
- Task 4.3a's phrase "task 1.1's scan root is `frontend/src/**/*.css`" plus a repo-root-style seam
  leaves the fixture's directory layout unstated (see Interactions item 4). Round 2's rule catches
  the failure, so this costs an execution cycle at worst; a one-line note that the fixture must be
  laid out under `<tmp>/frontend/src/` (or that the seam takes the CSS root directly) would save it.
- design.md D1 says four existing guards ship a selftest; there are five npm selftest scripts
  (`check:node-root-encoding:ts:selftest` is the fifth). Immaterial to any decision.
