## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md and specs/e2e-ci-sharding/spec.md. These files are untracked in
the worktree at HEAD 2b33217e1a49aa31d0598380913c2fff0ac3e89a. I also re-read skeptic-design-1.md and checked the
design against the repo and the GitHub jobs API.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-remaining-heavy-e2e/hel-1789`.
- **Round 1 CR1 (scope-chain and hook parity) is resolved.**
  - Decision 3(d) adds a per-test scope-chain comparison. It covers enclosing `test.use`, `describe.configure`,
    `setTimeout` and `slow` at file or describe level, `skip` and `fixme` outside the test body, and every hook's
    source.
  - Decision 3(e) counts `expect(` in test bodies and in hook bodies.
  - The proof names three checks: hel1684's `beforeEach` `attachApiRequestCounter`, its `afterEach` `count429` check,
    and hel1582's MAXIMAL `test.skip` gate plus the mobile `test.use` on both 375 parts and on 390 and 768.
  - The proof must also be shown able to fail, by one mutation.
  - Task 3.5 mirrors all of this, and it is promoted to standing constraint C19 (workflow-state.md `CONSTRAINTS`).
- **Round 1 CR2 (references and "no product code") is resolved.**
  - Decision 2 now repoints `package.json:65` `e2e:state-contrast-guard` to the stem path filter. It is checked by
    running `npm run e2e:state-contrast-guard -- --list`.
  - It also states the rule for comment-only references: they are allowed as comment/doc-only edits, and each one is
    listed in files-modified.md.
  - Task 3.4 names every site I found.
  - My grep of the six old names outside the archive matches the design's list. The only extra hits are comments that
    the grep-zero rule will catch: `ci.yml:87`, `e2e/focus-presence-guard.spec.ts:49`,
    `e2e/hel1573-motion-grid-chart.spec.ts:12`, `e2e/support/{hel1582Phone.ts:1, stateContrast.mjs, stateContrastProbe.ts, forceFocusVisible.ts, focusPresenceProbe.ts}`
    and `state-surface-contrast-guard.spec.ts:694`.
- **Round 1 CR3 (sampler bound against the job limit) is resolved, taking option (a).** The sampler starts as the first
  step after checkout with a 1440 s bound, and the spec delta now says it is "started before setup with a fixed
  self-stop bound shorter than the job limit". I checked the timing on run 44660016746 (jobs API, all 7 e2e legs):
  - The job starts at 02:20:04Z.
  - Checkout ends at 02:20:32-02:20:36Z, so the sampler would start about 28-32 s into the job.
  - It would then exit at about 1468-1472 s, before the 1500 s limit.
  - The e2e-setup step runs 117-167 s, so the record covers setup as well as the suite.
- **The sampler can run before e2e-setup.** `scripts/ci-load-sampler.cjs` has no dependencies (only `fs`), and the
  `ubuntu-24.04` image ships a node. The frontend job's pattern (`ci.yml:168-190`: nohup, PID file, `if: always()`
  stop) is what the design reuses.
- **The 390/768 sweeps and e2e-slow are safe.** `e2e-slow.yml:68` runs `hel1582-sweep-390.spec.ts` and
  `hel1582-sweep-768.spec.ts` by path. Keeping `registerHeavySweeps` as the composition of the two narrower functions,
  in the same order, leaves both files discovering the same tests, and the Decision 3 lists cover them.
- **Fresh review: AC coverage and contradictions.**
  - AC1 is covered by Decisions 1-3 and tasks 1 and 3. AC2 by Decision 4 and tasks 2 and 4. AC3 by Decision 6 and
    task 6.2, which now escalates if 8 runs give fewer than 5 counting runs.
  - I found no placeholder that blocks implementation.
  - The proposal, design, tasks and spec delta agree with each other.
  - The round 1 non-blocking notes are folded in: the `HELIO_E2E_SLOW=1` list caveat, the sibling-describe note, the
    rule that no `results.json` may appear in the runner artifact, and the shortfall escalation.

### Verdict: CONFIRM

### Non-blocking notes

1. **The bound's margin is real, but the design's description of the offset is wrong.** Decision 4(b) says "only
   checkout precedes it (a few seconds)". The measured offset is about 28-32 s: Set up job takes 1-2 s, Initialize
   containers 21-26 s (postgres service plus health check) and checkout 3-8 s. 1440 s still clears the limit by about
   28 s, but a slow image pull or health wait would eat that. Either correct the sentence or take the bound down to
   about 1400 s. The cost either way is at most the last few seconds of a leg that has already timed out.
2. **Say which form of the name the grep-zero rule checks.** "A grep for each old file name … is zero" should be read
   as the full `<stem>.spec.ts`. The bare stems legitimately remain in several places:
   - the new part file names;
   - the `package.json` path filter;
   - the capability `openspec/specs/state-surface-contrast-guard/`;
   - DESIGN.md's `openspec/changes/state-surface-contrast-guard/design.md` citations;
   - the `e2e-shard.mjs:9` history comment;
   - `PipelineSpine.css:388`.

   Saying so stops an executor from "fixing" `scripts/e2e-shard.mjs`, which would trigger the Gate-Chain checklist for
   no reason, or from renaming a capability.
3. **One comment edit sits outside the e2e job.** `ci.yml:87` is in the **frontend** job and is only a comment
   reference. Editing it under the grep rule slightly exceeds the proposal's "`ci.yml` (`e2e` job only)". List it in
   files-modified.md as comment-only.
4. **One reference sits inside a helper that moves verbatim.** `state-surface-contrast-guard.spec.ts:694` is a comment
   inside the `finishCell` helper, and that helper moves verbatim to `e2e/support/`. Updating the comment (it names
   hel1582-mobile-pipeline, which is itself split) is fine, because the AST body proof covers `test(...)` bodies and
   hooks, not helpers. Mention it in variance.md so the "verbatim move" claim stays accurate.
5. `e2e/hel1573-motion-grid-chart.spec.ts:12` ("Split from hel1573-motion-primitives.spec.ts") records where that file
   came from. Reword it to name the new parts or the stem, rather than deleting the provenance.
