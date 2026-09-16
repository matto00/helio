## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at `HEAD` = `b590855d5f2ddc76c9abf2e75fca5e5120cd5d7a`.
Live-resolved review base (`resolve-review-base.sh` → `b590855d5f2ddc76c9abf2e75fca5e5120cd5d7a`);
`git diff --stat BASE...HEAD` is empty and `git status --porcelain` shows the change dir
untracked — i.e. planning artifacts only, no code yet, as expected at this gate.

### What I verified (with evidence)

**Cwd guard.** `assert-cwd.sh /home/matt/Development/helio <WORKTREE_PATH> <BRANCH>` →
`READY ambient=/home/matt/Development/helio branch=feature/step-cards-three-new-steps/hel-1109`.

**Ticket AC, from the provider (not the relay).** `mcp__linear__get_issue HEL-1109`:
`"AC:** each step is authorable in the UI and by an agent, and the two produce identical
configs."` The sentence "AI steps should show their estimated cost before running" is in the
**Description prose, not the AC**. This matters for D5 (below).

**Every "Verified ground truth" bullet in ticket.md re-derived from source:**

- `convertformat` config/`outputField`-in-place default — `ConvertFormatConfig.scala:19-26`
  (`strOpt(...).filter(_.nonEmpty).getOrElse(field)`), `write` at `:32-38`. CONFIRMED.
- Exactly four supported pairs, `from == to` rejected — `ConvertFormatStep.scala:44-45`
  (`SupportedPairs`), `ConvertFormatConfig.scala:48-62` (`pairError`), pinned by
  `ConvertFormatStepSpec.scala:446,451,455`. CONFIRMED.
- `analyzewithai` `outputSchema` is an ordered `JsArray`, order contractual —
  `AnalyzeWithAiConfig.scala:44-55` (`write` emits `JsArray`, with the JsObject-key-sorting
  rationale in its own scaladoc) and `Vector` at `:23`. CONFIRMED.
- `generatetext` three required fields, `outputField` never defaults to `inputField` —
  `GenerateTextConfig.scala:22-27`, `:46-54`, rationale at `:9-17`. CONFIRMED.
- Write-path validation at `PipelineService.scala:1787` — CONFIRMED, at
  `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:1787`
  (`companionFor(...).flatMap(_.validateRawConfig(...))` inside `addStep`). Both AI steps
  delegate to the all-fields-required `validate` (`AnalyzeWithAiStep.scala:187-188`,
  `GenerateTextStep.scala:91-92`), so an incomplete seed IS rejected. `convertformat`'s is
  `strictDecodeProblem.orElse(pairError)` (`ConvertFormatStep.scala:323-324`). The
  asymmetry is real. **But see CR1 — the "convertformat is unaffected" conclusion drawn
  from it is only conditionally true.**
- All three render via the read-only fallback; nothing asserts `OP_TYPES` covers the
  registry — `stepNarrowing.ts:283-286` (`?? unsupportedOpType(ps.type)`), `OP_TYPES`
  ends at `upsertsource` (`:103-140`), `StepOpEditor.tsx:112` renders the notice.
  CONFIRMED.
- V107 admits all four ops — `V107__add_writeback_ops.sql` CHECK list. CONFIRMED.
- `costVerdict` already on the wire and already typed, zero non-test consumers —
  `pipelineStep.ts:524-544`; the only other hits are three test files. CONFIRMED.
- `allowedOps` correction — 70 occurrences, **all** documentation/archive (zero in
  `*.scala`/`*.ts*` outside this change's own docs), and `git log -S allowedOps -- backend`
  → `787d9ab9` (HEL-228) then `6b6297d6` (HEL-236), since removed. The corrected
  "was once real code, now removed" wording is accurate; the self-flagged earlier draft
  ("never code") was indeed wrong. CONFIRMED, no action.

**CON-132 gate-chain claim — CONFIRMED not applicable.** `.husky/pre-commit` is the only
hook; no file in it and no script it invokes is touched (diff is empty). I additionally ran
the gates that *do* read these artifacts: `check:spec-structure` → `spec-structure check
passed (391 canonical specs, 0 issues)`; `check:openspec` → `openspec/ is clean`;
`openspec validate step-cards-writeback-ops --strict` → `Change
'step-cards-writeback-ops' is valid`.

**Evidence-path discrepancy (non-blocking).** The brief cites
`.concertino/runs/HEL-1109/evidence/premise-validation.md` as if under `WORKTREE_PATH`;
there is no `.concertino/runs/` in the worktree at all. The file exists in the MAIN repo at
`/home/matt/Development/helio/.concertino/runs/HEL-1109/evidence/premise-validation.md`.
I located and read it, treating it as claims only. It is accurate as far as it goes, and it
repeats one blind spot: it correctly notes `pairError` returns `None` when `from`/`to` are
**absent**, and never considers them **present-and-empty** (CR1).

### Verdict: REFUTE

The shape of the plan is right and the two flagged judgment calls land correctly (D3 yes,
D5 yes — rulings below). What blocks it is that two load-bearing premises are wrong in
detail (CR1, CR4), one guard test cannot do the job it states (CR5), and D6's stated
"existing vocabulary" is not the vocabulary this codebase actually uses in step cards (CR6).
All eight are cheap to fix here and expensive to discover in execution.

### Change Requests

1. **The `convertformat` seed must OMIT `from`/`to`, and design.md/tasks.md must say so.**
   D3 and proposal.md justify leaving convertformat's immediate create untouched because
   "its validator accepts an absent `from`/`to`". True for *absent*; **false for
   present-and-empty.** `ConvertFormatConfig.pairError`
   (`ConvertFormatConfig.scala:51-53`) collects `JsString("")` as `Some("")`, and
   `("","")` is not in `SupportedPairs` (`ConvertFormatStep.scala:44-45`) → it returns
   `Some(error)` → `addStep` returns `UnprocessableEntity`
   (`PipelineService.scala:1792-1793`). Every sibling string field in `defaultConfigFor`
   seeds `""` (`stepNarrowing.ts`: `splittext` `field: ""`, `extractheadings` `field: ""`,
   `datebucket` `field: ""`, `stringops` `field: ""`, `compute` `column: ""`), so the
   natural seed an executor writes is exactly the rejected one — and the backend tests
   pin only the absent cases (`ConvertFormatStepSpec.scala:459-461`), never `("","")`.
   Required: state the literal seed in D3 and tasks.md 1.4 (e.g. `{ field: "" }`, with
   `from`/`to` deliberately absent — the `upsertsource` `{ mode: "append" }` precedent at
   `stepNarrowing.ts:252-255` is the model), and have 1.4's test assert the *absence* of
   both keys rather than only "the exact shape".

2. **Correct the "named 400" status claims to what the code returns.** A
   `validateRawConfig` rejection is `ServiceError.UnprocessableEntity`
   (`PipelineService.scala:1792-1793`), i.e. 422, not 400. design.md's Context ("ANY
   incomplete seed is a 400") and three spec deltas assert 400 for exactly these paths
   (`pipeline-convertformat-editor` "rejected by the backend with a 400 at write time";
   `pipeline-analyzewithai-editor` "the backend rejects such a config with a 400";
   `pipeline-generatetext-editor` "each of which the backend rejects with a 400"). These
   are the requirements the executor and evaluator verify against, so a wrong status is a
   false-evidence trap. Make them status-accurate or status-agnostic ("a named rejection
   at write time").

3. **Specify the 1–50 `outputSchema` cap and define "config is complete" as the backend's
   own validator.** design.md's own Goal is cards that "cannot express a config the
   backend will reject for a reason the UI could have known", but
   `AnalyzeWithAiConfig.MaxOutputSchemaEntries = 50` (`AnalyzeWithAiConfig.scala:30`,
   enforced at `:68-69`) appears nowhere in design.md, the analyzewithai spec delta, or
   tasks 2.3 — a 51-row schema is expressible today under this plan. Separately, D3 and
   tasks 3.3 turn on "the config first validates locally"/"the last required field is
   supplied" without ever defining the predicate; the backend gate is the *whole* of
   `validate` (non-empty `inputField`/`instruction`, 1..50 entries, names non-empty +
   unique + not equal to `inputField`, types in `AllowedOutputTypes`). A narrower local
   predicate fires a create that 422s; a wider one means the step never saves. Required:
   state that the local completeness predicate mirrors `AnalyzeWithAiConfig.validate` /
   `GenerateTextConfig.validate` field-for-field, add the 50-entry cap to task 2.3, and
   add a scenario for it.

4. **D3's "machinery already exists" premise is half wrong — `persist` does NOT no-op for
   a not-yet-real step id.** design.md D3 asserts "`useStepCardState.persist` already
   no-ops for a step whose id is not real. So the draft state is already representable."
   Ground truth: `persist` (`useStepCardState.ts:233-238`) returns early **only** for
   `isUnsupportedOpType`; there is no temp-id check, and `updatePipelineStep`
   (`pipelineService.ts:123-131`) unconditionally PATCHes `/api/pipeline-steps/<id>`. The
   only temp-id guards in the tree are ad-hoc `startsWith("step-")` checks in
   `usePipelineDetailPage.ts` (`:952`, `:1055`, `:1068`), and `handleInsertStep`'s own
   comment ("PATCH calls will be no-ops until ID is real", `:685`) is itself inaccurate.
   Consequence for this design: a draft AI card edited before it validates will fire a
   debounced PATCH at a nonexistent `step-N` id — a 404 that `persist`'s `.catch` swallows
   for every kind except `upsertsource`. Required: correct the premise, and add a task
   that either (a) gives `persist` an explicit not-yet-real-id guard with a test, or
   (b) wires the draft card not to call `persist` until the create resolves. Task 3.3's
   "further edits update the created step rather than creating another" depends on
   whichever is chosen.

5. **Task 4.1's guard is not failable as written and cannot meet its stated purpose.**
   "verify it fails when an op id is removed from `OP_TYPES`" is satisfied by a hardcoded
   expected list — which is a same-spec twin of `OP_TYPES` and would **not** catch "a
   future backend op silently renders as unsupported", the stated purpose. There is no
   frontend-reachable registry: `PipelineStepKind.All = PipelineStep.Registry.keySet` is
   Scala-only (`PipelineStep.scala:302`), `schemas/` enumerates no ops (zero hits for
   `convertformat`), and the capabilities API reports Output kinds/slots, not op kinds
   (`openspec/specs/pipeline-capabilities-api/spec.md`). The repo has exactly one
   precedent for this shape:
   `frontend/src/features/sources/types/canonicalFieldTypesDriftGuard.test.ts`, which
   reads Scala source from Jest via a repo-root walk. Required: 4.1 must (a) name its
   source of truth — that Scala registry or `V107`'s CHECK list — (b) state the mutation
   that proves failability in the *purpose's* direction (add a fake kind to the parsed
   source and show red), and (c) account for `join`, which `OP_TYPES` deliberately
   excludes while the backend registry admits it (`stepNarrowing.ts:139-142`), or the
   guard is red on arrival.

6. **D6 names a vocabulary the step cards don't use — pick one and say which.** D6 says
   the cards compose `FormField` … "the same vocabulary `AssertConfig`/`UpsertSourceConfig`
   already use." **No step-config card uses `FormField`**: its only consumers are
   `ApiTokensSection`, `EditConnectorModal`, `CreateConnectorModal`,
   `InlineConnectorSetup`, `ConnectorCredentialField`. Step cards use
   `Select`/`TextField`/`ConfirmInline`/`InlineError` plus `pipeline-detail-page__*`
   classes (`UpsertSourceConfig.tsx:12-19`, `AssertConfig.tsx:12`). Nor is there a generic
   inline-note class: the actual precedents are `__step-card-desc`,
   `__aggregate-section-description`, `__upsertsource-radio-note`, `__compute-fields-hint`,
   `__filter-warning`. DESIGN.md §6 does direct new forms to `FormField`, so using it is
   not *wrong* — but it would make these three cards diverge from all 22 siblings, which is
   the cohesion outcome D6 exists to prevent. Required: rule explicitly. My ruling: match
   the sibling step cards (`Select`/`TextField`/`InlineError` + existing
   `pipeline-detail-page__*` note classes), and record `FormField`-vs-siblings as the
   considered trade-off so the executor doesn't invent a third option.

7. **Name the primitive for the "unsaved draft" affordance (task 3.5).** As written this is
   new UI with no named precedent — exactly the new-dialect risk D6 forbids.
   `SaveStateIndicator` is **not** reusable here: it reads `state.panels`/`state.dashboards`
   directly (`SaveStateIndicator.tsx:10-16`) and is consumed only by `CommandBar`.
   `StatusChip` is DESIGN.md §6's "one pill recipe" and is already used throughout this
   feature — including an `intent="neutral" dashed` treatment for a not-yet-run pipeline
   (`PipelineListTable.tsx:37-39`), plus `PipelineDetailHeader.tsx:338`,
   `PipelineDetailFooter.tsx`, `RunHistoryModal.tsx`. Required: name it (my ruling:
   `StatusChip intent="neutral" dashed`, not a new badge/callout). With this reuse
   available, **no escalation is warranted** for D6.

8. **Don't present a pipeline-level row estimate as a per-step call count.**
   `CostVerdict.estimatedRows` is optional *and* pipeline-level
   (`pipelineStep.ts:530-540`; per-step data lives only in `reasons[].stepId`). The
   `pipeline-ai-step-authoring` scenario says the disclosure "expresses the model-call
   volume a run would issue in terms of that estimate" — for an AI step downstream of a
   `filter`/`limit`/`aggregate` that number is simply wrong, which would undercut exactly
   the honesty D5 is built on. Required: scope the wording to the pipeline's estimated row
   count (or state the caveat) rather than asserting this step's call count.

### Explicit rulings you asked for

**D3 (deferred create) — right call; scoping needs CR1 + CR4.** Deferring is correct and
for the right reason: a seed with a fabricated non-empty `instruction` is a *spendable*
config, which is categorically worse than `upsertsource`'s merely-absent `target`, and
relaxing a contract HEL-1106/1107 set deliberately is out of scope. The mechanism is also
right — a declared per-op property derived in one place (task 3.1) rather than op-name
checks at call sites, with task 4.2's convertformat regression test as the guard that the
other 22 ops keep byte-identical behavior. Two scoping holes: "convertformat is unaffected"
holds only with a seed that omits `from`/`to` (CR1), and the draft path is not as
free-of-charge as claimed because `persist` has no temp-id guard (CR4). Fix both and D3
stands as written.

**D5 (cost disclosure) — CONFIRMED, no escalation, and I would have refused a dollar figure
too.** Three independent grounds: (a) the live Linear AC is only the authorable/identical-
configs criterion — the cost sentence is Description prose, so reading it as a *disclosure*
is not overriding an AC; (b) the ticket's own referenced design spec explicitly parks the
figure as future work — "the estimator is reusable later for scheduling and **for showing
users what a run costs**", under *Open questions for implementation*
(`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`); (c) no price
exists on any surface to render (`CostVerdict` = `autoRunnable`/`estimatedRows`/`stepCount`/
`reasons`). A derived dollar figure would be a fabricated number carrying the authority of a
measurement, and would go stale silently with model pricing. This is the honest reading, not
a silent substitution. Tighten per CR8.

**Spec decomposition — four capabilities is right.** One-per-op matches the HEL-1102
precedent exactly rather than departing from it: that change added exactly one capability
(`pipeline-upsertsource-editor`) for exactly one op
(`archive/2026-09-15-upsertsource-step-card-mcp/specs/`). The existing `pipeline-*-op`
specs are backend-only contracts — I read their requirement lists, and all are
config/run/analyze/never-auto-runnable with zero editor requirements — so there is no
duplication and no MODIFIED delta owed. The cross-op fourth capability is justified because
deferred-create and the disclosure are genuinely shared and would otherwise be duplicated
verbatim in two specs. Non-blocking: `pipeline-ai-step-authoring`'s first requirement is
really about "a kind whose incomplete config is rejected" (a property, not AI-ness) — the
requirement *text* already says exactly that, so the name is acceptable.

**D2 — correct, and materially better than two dropdowns.** `SupportedPairs` is exactly the
four (`ConvertFormatStep.scala:44-45`) and `from == to` is rejected
(`ConvertFormatConfig.scala:54`, test `:455`), so making invalid pairs unrepresentable
rather than validating-after-the-fact is the right call.

**D4 — correct on the wire shape; the reorder control is new but not a new dialect.**
Array-not-object is verified (`AnalyzeWithAiConfig.scala:50-55`, with the JsObject-sorting
hazard documented in its own scaladoc). On precedent: **no** step card has row *reorder*
controls today — `AssertConfig`/`AggregateConfig` are add/remove only, and `SortConfig`'s
`ArrowUp`/`ArrowDown` is a direction toggle, not a move (`SortConfig.tsx:79-89`). But
step-level Move up/down exists (`PipelineRiverView.tsx:258-272,427-428`), so move controls
reuse an established icon-button + position-bearing-`aria-label` idiom; keeping them in the
`__row-remove-btn`-style row-control vocabulary keeps this in dialect. Not an escalation.
D6's a11y risk note already requires computed accessible names including position — correct
per DESIGN.md §8.

**tasks.md verification clauses — mixed.** Real evidence: 1.4, 2.2, 3.2, 3.3, 3.4, 3.6,
4.2, 4.3, 4.4. Restatements to fix:
- **1.1/1.2** — "verify `npm run typecheck` passes" is entailed by writing compiling code
  and proves nothing about the union admitting the three kinds, since `PipelineStepKind` is
  *derived* (`PipelineStep["type"]`, `pipelineStep.ts:351`). Real evidence is a
  compile-time assertion, or an actual `createPipelineStep(..., "analyzewithai")` call site
  typechecking.
- **1.3** — circular: `OpDropdown.test.tsx:51` asserts
  `expect(items).toHaveLength(OP_TYPES.length)`, which passes automatically for *any*
  `OP_TYPES`. "Still passes" is not evidence; the three-labels-render half is. Drop the
  first half.
- **2.5** — the token/focus-ring guards are real and do exist (`check:tokens`,
  `focusRingTokenGuard.css.test.ts`, `PipelineDetailPage.css.test.ts`), but they are
  mechanical only; 4.6 carries the actual cohesion judgment and correctly says "escalate
  rather than ship".
- **4.1** — see CR5.

### Non-blocking notes

- The card should preserve and display a persisted-but-unsupported legacy `from`/`to` pair
  rather than silently coercing it into one of the four; `SortConfig.tsx:68-76` already
  sets the "keep the current value as an option even if it's no longer in the list"
  precedent.
- No `helio-mcp` change is needed — verified rather than assumed: `write.ts`'s
  `add_pipeline_step` description already documents all three shapes accurately, including
  `outputField` defaulting to `field` and overwriting in place, the ordered 1–50
  `{name,type}` array with the four-type subset and the non-empty/unique/non-colliding name
  rules, and `generatetext`'s deliberately non-defaulting `outputField`. Consequently the
  HEL-1102 tasks.md 3.3 precedent (a live fresh-process MCP proof) is optional here; 4.3's
  fixture-level parity test is a reasonable substitute, though it is a comparison against
  documented shapes rather than a live agent round-trip.
- Three spec deltas require "an MCP-created step renders as an editable card". Task 2.6
  ("a persisted step of each kind renders its editor") exercises the same code path
  (`pipelineStepToStep`), so this is covered — noted only so a later gate doesn't read it
  as an uncovered scenario.
- No claim in this report rests on mtime ordering or directory position; every finding
  above is a content citation (file:line, command output, or live provider response).
