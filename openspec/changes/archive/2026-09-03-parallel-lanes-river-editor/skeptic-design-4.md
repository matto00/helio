## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Fresh spawn. Every claim re-derived from the current artifacts and the shipped tree.

**Round-3 CR1 (Playwright blast radius) — addressed by mechanism, but on a partly false premise.**
`tasks.md` §3.5 now exists and enumerates both specs. The line numbers check out exactly:
`grep -n '"Add tail step"' e2e/hel908-tail-attach.spec.ts` → `76,79,171,245,343` (exactly as claimed);
`grep -n 'tail-chain-item' e2e/hel908-trunk-reorder-drag.spec.ts` → `110,116,206,209,226` (exactly as
claimed). `:93-95` is verbatim the single-tail-per-node assertion (`toHaveCount(1)` with the comment
"single-tail-per-node enforcement"). The task requires `LaneColumn`'s compact branch to preserve the
`.pipeline-detail-page__tail-chain-item` class and nesting, on the stated grounds that it is the only
machine-checkable expression of AC2. A repo-wide
`grep -rln "tail-chain-item\|Add tail step\|Branch" e2e/` returns those two files and no others, so the
enumeration is complete. **But see CR1 — one of the two files does not run.**

**Round-3 CR2 — RESOLVED.** `design.md` Risks now reads "There are NO frontend Jest snapshots, so 'tails
render identically' is not verifiable against snapshots (AC2's literal wording is unsatisfiable — see task
3.3). What IS machine-checkable is the `.pipeline-detail-page__tail-chain-item` DOM contract…". The
snapshot claim is gone. Re-confirmed the premise independently: no `*.snap` / `__snapshots__` outside
`node_modules`.

**Round-3 CR3 — RESOLVED.** `design.md` Planner Notes now reads "the stale SPEC TEXT is removed here via a
`REMOVED` block in this change's `pipeline-step-tree` delta (an openspec edit, inside the boundary), rather
than left flagged with no task." The delta indeed carries a full `## REMOVED Requirements` block for "At
most one trunk child per node" with reason and a "no frontend or backend change accompanies this removal"
migration.

**Round-3 non-blocking type mis-attribution — RESOLVED and verified.** `UnionConfigValue` is declared at
`ui/stepConfigs/UnionConfig.tsx:18`; `LookupConfigValue` at `ui/stepConfigs/LookupConfig.tsx:23` (both
confirmed by `grep -n`). Task 5.1 now names both files correctly, says `stepNarrowing.ts` only imports
them, and names `UnionConfig.test.tsx` / `LookupConfig.test.tsx` as constructing the flat shape — confirmed
at `UnionConfig.test.tsx:37` (`{ otherDataSourceId: "", mode: "byPosition" }`) and
`LookupConfig.test.tsx:44` (`referenceDataSourceId: ""`), with the lesson-1 "state why" requirement attached.

**Premise spot-checks against the shipped tree (not taken on prior rounds' word).**
`stepNarrowing.ts:498-530` — both degrade-to-`""` branches present exactly as described, with the
"P2.2/HEL-912" deferral comments. `OP_TYPES` (`:112-119`) lists `union` and `lookup`, not `join`;
`JOIN_OP_TYPE` at `:124` is the internal-resolution-only entry the design describes; no `JoinConfig.tsx`
in `ui/stepConfigs/`. `PipelineRiverView.tsx:309-311` `trunkLastHasTail`, `:412`
`!stepTree.tailsByStepId[step.id]`, `:485` the refusal message — all present. `tap-expand-44` exists and is
already used by `OutputsRail.tsx:52,66`. CI's `e2e` job runs by glob governed by `playwright.config.ts`
(`testDir: "./e2e"`), so task 8.2's "confirm it is collected" is the right instruction.

**Engine-contract conformance (P2.1 archive § Engine contract) — re-checked, clean.** Item 2: Decision 1 +
the step-tree delta's "SHALL NOT treat a `position = 0` child as structurally special". Item 6: tasks
2.2/5.4/5.5 and the rejoin-picker delta explicitly permit non-terminal targets and already-consumed nodes.
Item 6b: task 5.4 and the delta's separate "The picker imposes no ordering restriction" requirement, with
both a right-of and a below scenario. No UI-invented engine restriction anywhere in the plan.

**Where I broke it.** The plan's Playwright blast radius is enumerated but not *measured*: the larger of
the two files it names is quarantined out of every run. See CR1.

### Rulings on the two carried-forward deviations

**Decision 6 (`join` out of scope) — ACCEPTED, not a deviation needing the human.** Verified by mechanism:
`join` is absent from `OP_TYPES`, has no `stepConfigs/JoinConfig.tsx`, and `JOIN_OP_TYPE` exists solely so a
backend-loaded `join` step narrows without crashing. There is no `join` config editor to add a lane arm to;
giving it one would be authoring a new step config, which is a feature beyond the ticket. AC1 — the only AC
that exercises the picker — names `union` only. The narrowing is stated in both `design.md` Decision 6 and
the `pipeline-lane-rejoin-picker` delta's Purpose. This ships as planned.

**AC2's "excludes ancestor lanes" vs. listed-but-DISABLED-with-a-reason — ACCEPTED, and the ticket itself
settles it.** This is not a case for the human. `ticket.md` § Scope states the behaviour explicitly:
*"'other lane' selectable from the visible lanes (**cycle-invalid lanes greyed with a reason**)"*. The AC
line's "excludes" is the loose paraphrase of that Scope sentence, not a competing requirement — and the
plan implements the Scope wording verbatim. Both readings satisfy the operative property (an ancestor
cannot be selected). No escalation warranted; the final gate should read AC2's picker clause as satisfied.

### Verdict: REFUTE

One change request. It is specific, reproduced, and it invalidates a load-bearing premise of the fix that
round 3 asked for.

### Change Requests

1. **Task 3.5 plans work against `e2e/hel908-tail-attach.spec.ts`, which is QUARANTINED and already RED —
   and its stated reason for editing it is factually wrong.** Two reproduced findings:

   a. `playwright.config.ts:47` carries `"**/hel908-tail-attach.spec.ts"` in `testIgnore`, with the comment
      at `:43-46`: *"Quarantine (HEL-951) — hel908-tail-attach.spec.ts: the 'Add tail step' button locator
      resolves to 0 elements (expected 2) in the first test; all four tests in the file depend on this
      affordance and fail the same way. Follow-up: HEL-962."* That `testIgnore` is the single exclusion list
      for **both** a bare `npm run e2e` and CI's glob job (`.github/workflows/ci.yml:199-220`). The file is
      collected by nothing. Inverting `:93-95` therefore produces **zero evidence** — it is exactly the
      lesson-4 shape ("a green gate may scan nothing"), one step worse: this gate is not even collected.
      An executor who "updates" it and reports the update as blast-radius coverage will have verified
      nothing, and task 3.5's framing ("MUST be updated deliberately") invites precisely that.

   b. The task's stated reason for touching the accessible-name locators is false. It says the
      `"Add tail step"` locators at `:76,79,171,245,343` *"change with the '+ lane' rename"*. They do not —
      `grep -rn "Add tail step" frontend/ --include=*.ts --include=*.tsx` returns **nothing** (exit 1). The
      affordance's accessible name today is
      `aria-label="Branch this step to build a second output, without changing the main pipeline"` with
      visible text "Branch" (`PipelineRiverView.tsx:415-421`). Those locators have matched 0 elements since
      before this change existed — that is the HEL-962 quarantine reason. Attributing their breakage to this
      change's rename mis-states ground truth and would let a pre-existing defect be absorbed silently into
      this PR's diff (lesson 1 inverted: a fixture edited here that did *not* need to change *because of
      this change*).

   c. Consequently the "~20 assertion sites" figure overstates the **live** blast radius by roughly 4x.
      The only e2e assertions that actually run and actually depend on the DOM this change touches are the
      five `.pipeline-detail-page__tail-chain-item` locators in `e2e/hel908-trunk-reorder-drag.spec.ts`
      (`:110,116,206,209,226`) — a spec `playwright.config.ts:62-63` explicitly records as passing both CI
      runs and required to stay wired in. That single file is the entirety of the machine-checkable AC2
      guard the design leans on. `grep -rln "tail-chain-item\|Add tail step\|Branch" e2e/` confirms no other
      spec is affected.

   **Required revisions:**
   1. Restate task 3.5 to record that `hel908-tail-attach.spec.ts` is quarantined (HEL-962, `testIgnore` at
      `playwright.config.ts:47`), is not collected by CI or `npm run e2e`, and that **any edit to it is
      documentation, not verification** — it may not be cited as blast-radius coverage or as evidence for
      any AC. Decide and state explicitly whether the file is updated at all this cycle or left to HEL-962;
      either is defensible, but the plan must not imply an edit there is checked by anything.
   2. Delete the false attribution. The `"Add tail step"` locators are not broken by the "+ lane" rename;
      they match 0 elements today because the affordance is labelled "Branch". If they are touched, that is
      fixing a pre-existing HEL-962 defect and must be labelled as such, not folded into this change's
      rename narrative.
   3. Correct the live-radius statement: name `e2e/hel908-trunk-reorder-drag.spec.ts` (`:110,116,206,209,226`)
      as the **only** running e2e guard of the `.pipeline-detail-page__tail-chain-item` contract, and hang
      the "these locators still passing unchanged is evidence for AC2" claim on that file alone. The
      requirement that `LaneColumn`'s compact branch preserve the class and its nesting is correct and
      should stay — it just gets its force from one spec, not twenty.
   4. Add to task 9.x (or 3.5) that `hel908-trunk-reorder-drag.spec.ts` must be **run and observed green**
      after the `TailChain` → `LaneColumn` retirement, with the command and output recorded in
      `files-modified.md`. Asserting the class was preserved is not the same as observing the spec pass
      (lesson 8).

### Non-blocking notes

- `tasks.md` 6.1 names `ui/OutputGalleryCard.tsx` (it exists); `proposal.md` § Impact omits it while listing
  `OutputsGalleryTab.tsx`. Harmless drift; worth aligning so the Impact list stays usable as a diff check
  for task 9.2.
- The lane display label is unpinned. `pipeline-outputs-rail`'s example is `off filter › lane 2 › aggregate`
  and `pipeline-lane-editor-ui` requires "a visible, stable label", but nothing states whether numbering is
  1-based, whether the primary lane counts as lane 1, or that the rail subtitle and the mobile lane header
  use the same numbering. Cheap to fix at implementation time; only a problem if the two surfaces disagree.
- Task 3.3's "no frontend Jest snapshots" premise and the `pipeline-tails-ui` delta's scenario "the rendered
  output is unchanged from the pre-lanes rendering" remain as round 3 left them: acceptable as a *spec*
  property, but the executor must not cite that scenario as though a test proved it.
