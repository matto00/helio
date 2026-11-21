## Context

Draft-save undo: `PatchSetUndoService.undo` (line 76) sends a `pipelineDefinition` journal row to
`DraftRestore.restore`, which pre-checks, then replays the journaled definition through
`DraftSaveService.saveCore(..., DraftSaveMode.Restore)`. Three refusals exist today (HEL-1629), all 409, all write
nothing, all listing raw ids:

1. `DraftRestore.dependentsOfCreatedOutputs`: panels/alert rules now on an Output the save created (the restore would
   delete it, and `panels.output_id` cascades, V94). Reads are internal (`findIdsByOutputIdsInternal`,
   `findAlertRuleDefinitionsInternal`), so other users' panels are seen. Message: `panel <id> (Output <id>)`,
   `alert rule <id> "<name>" (Output <id>)`.
2. `DraftRestore.dependentsOfRemovedOutputs`: panels/alert rules the save's cascade already deleted, read from the
   journal's `definition.outputs[].panelIds/alertRules`. Same id-list message.
3. `DraftSaveTransaction.cascadeGate` (Restore mode): the same check as 1 re-run under the definition locks on the
   privileged pool. Message: `panel <id>, ...`. Skeptic round 1 showed this branch is unreachable in practice: the
   pipeline fingerprint covers every Output's `panelIds` (`PatchSetPipelineDefinition.outputsJson`), the restore's
   compare (`DraftSaveTransaction.scala:88`) runs first under `outputs ... FOR UPDATE`, and a draft save never creates
   panels, so a bind after the pre-check is either visible to the compare (409 `PATCH_SET_STALE`, whose message names only
   the edit and pipeline, `PatchSetStaleMessage`) or blocks on the Output row lock until the restore commits.

HEL-1720's `PatchSetUndoBoundPanels` names readable panels (`describe`: RLS-scoped `panelRepo.findById` and
`dashboardRepo.findById` with `Some(user)`), caps names at `NameCap = 10`, counts the rest and the unreadable ones,
and uses a count-only phrase (`boundDuringUndo`) for its in-transaction re-check.

## Goals / Non-Goals

Goals: no panel id, and no unreadable panel's title or dashboard name, in any draft-undo refusal or log line; the
refusal behaviour (409, nothing changed) is unchanged; a two-user test on `helio_app_test`.
Non-goals: HEL-1795/1796/1797 scope; any client change; changing when the restore refuses.

## Decisions

**D1. Reuse HEL-1720's naming, not its `blocker`.** `blocker`/`blockingPanelIds` are keyed on a `JournaledEdit`'s
`newId` and `targetKind` (`output|pipelineStep|pipeline|dashboard` creates) and excuse the same set's `panel` `create`
edits. A draft save journals one `pipelineDefinition` edit with no `newId`, and a draft save never creates panels, so
there is nothing to excuse and no `newId` to key on. Instead, extract the naming half of `blocker` into one helper in
`PatchSetUndoBoundPanels`, e.g. `describeBlocking(ids, user, panelRepo, dashboardRepo): Future[String]` (named
readable panels up to `NameCap`, `and N more`, `and U panel(s) on dashboards you cannot see`), make `blocker` call it
(its output text unchanged, so HEL-1720's specs keep passing untouched), and call it from `DraftRestore`. It takes the
two repos rather than a `PatchSetUndoContext` so `DraftRestore` does not need the whole undo context. This is the only
change to `PatchSetUndoBoundPanels`; `PatchSetUndoService` is not changed beyond what construction needs (nothing,
since `DraftRestore` is built in `ApiRoutes`).

**D2. Created-Outputs refusal (1).** Collect the distinct sorted panel ids across created Outputs, pass them to
`describeBlocking`. Alert rules on created Outputs (from the existing `findAlertRuleDefinitionsInternal` read, which
carries each rule's name) are split with `outputRepo.findVisibleAlertRuleIds(ruleIds, user)`
(`OutputRepository.scala:200-209`, batched, owner-scoped exactly like `AlertRuleRepository.findAll`, HEL-1522): a visible
rule is named `alert rule "<name>"`, the others counted. `AlertRuleRepository` is not used (it is nullable in
`ApiRoutes`). Message, in this fixed order, each clause omitted when its count is zero:
`Undo refused: this save created Outputs that now have dependents undo would delete: N panel(s) (<describeBlocking
parts>); alert rule "<name>", ..., and K alert rule(s) you do not own; remove or rebind them before undoing; nothing was
changed.` Panel clause first, alert-rule clause second. No Output id, panel id or rule id appears.

**D2a. Both refusals at once.** When the save's cascade removed panels/alert rules AND created Outputs now carry
panels/alert rules, the message is the D3 sentence followed by a space and the D2 sentence, each with its own
`Undo refused:` prefix dropped from the second (one `Undo refused:` at the start, one `nothing was changed.` at the end).
Order: removed first, then created (today's concatenation order at `DraftRestore.scala:39`).

**D3. Removed-Outputs refusal (2): counts only.** Those panels were deleted by the save's cascade; there is no row left
for `describe` to read, and the journal holds only ids (and alert rule names that may belong to other users). Message:
`Undo refused: the save removed N panel(s) and M alert rule(s) with its Outputs, and undo cannot recreate them; nothing
was changed.` (omit a zero part).

**D4. In-transaction refusal (3): counts only, defence in depth.** `cascadeGate`'s Restore branch has no reachable path
today (see Context item 3), so it is changed only so that, if a future change makes it reachable (for example the
fingerprint stops covering `panelIds`), it cannot leak ids. Count-only because it runs inside a `DBIO` on the privileged
pool holding the definition locks, where RLS-scoped naming reads as the undoing user are not available; same choice as
HEL-1720's `boundDuringUndo`. Message: `Undo refused: N panel(s) and M alert rule(s) are bound to Outputs this undo would
delete; nothing was changed.` (omit a zero part). No test is claimed for this branch and no seam is added for it.

**D5. Logs.** Verify the route/service path logs no refusal message containing ids (`PatchSetUndoService` logs only
in the walk, which the draft path skips; check the route's `ServiceError` handling). If a log line carries the message,
it must carry the count-only form.

**D6. Test (red first).** New spec modelled on `PatchSetUndoBoundOutputPanelsSpec` (two-pool `DbContext`, services on
`helio_app_test`, assert `SELECT rolbypassrls FROM pg_roles WHERE rolname='helio_app_test'` is false). User A owns a
pipeline and dashboard D; A saves a draft creating Output O (journal row via the real draft save). Panels:
- P1: A binds a panel to O on D (`PanelService.create` as A).
- P2: B, an editor grantee on D, duplicates P1 via `PanelService.duplicate`; B owns the copy (needs only editor on D,
  `PanelService.scala:212-222`). A reads it through `findById`'s dashboard-owner branch, so it is named.
- P3: B owns dashboard E and grants A editor on E; A creates P3 bound to O on E via `PanelService.create` (A owns O, so
  `rejectMissingOutput` passes); B then revokes A's grant through the real sharing/permission service or repository.
  B cannot bind P3 itself (`PanelBindingChecks.rejectMissingOutput` requires the Output owner). If revocation through
  a service proves impossible in the harness, a direct delete of the exact grant row is acceptable and must be named in
  the spec's comment. After the revoke A cannot read E, so P3 is counted.
A undoes. Assert 409; body names P1 and P2 by title with D's name, counts 1 unreadable panel, and contains NONE of
P1/P2/P3's ids nor P3's title or E's name; O, all panels and the definition fingerprint unchanged.
Alert rules (created-Outputs refusal): (e) named case: A owns a rule (via `AlertRuleService.create`) on created Output
O; the 409 names it by `"<name>"` and carries no rule id. (f) counted case: B is an editor grantee on A's pipeline, B
saves the draft creating O, A creates a rule on O (only the Output owner can, `AlertRuleService.create`), B undoes; the
409 counts the rule and carries neither its id nor its name. If (f) proves unreachable through services, use a
labelled direct-insert fixture and say so in the spec.
Also: (b) removed-Outputs case: the save's cascade removes an Output with a bound panel owned by B; undo is count-only,
no panel or alert rule id; (c) both-refusals case per D2a; (d) a bind after the pre-check: bind a panel to O between
the pre-check and the transaction's definition read (a `DraftSaveHooks` hook at `Begin` (not `AfterLock`: a
second-connection insert waiting on the `FOR UPDATE` Output lock would deadlock), inserting and committing from a
second connection), assert 409 `PATCH_SET_STALE` with no panel id and nothing changed.
Red run on main (ids present) is committed before implementation. Mutations: (1) revert D2 to the id list, the
created-Output case must fail; (3) name every alert rule regardless of owner, case (f) must fail; (2) drop the pre-check entirely, the created-Output case must still be refused with
409 `PATCH_SET_STALE` and no panel id, proving the pre-check is the message-bearing gate and the fingerprint the
backstop.

## Risks / Trade-offs

- `DraftSaveUndoSpec` asserts `include("late-panel")` on the old message; that assertion changes to the title form.
- Removing ids makes support debugging harder; counts plus readable titles are what HEL-1720 accepted.

## Planner Notes

- Self-approved (design r2): alert rules use `findVisibleAlertRuleIds`; same named-if-readable rule (V60 direct-owner RLS) because the same message
  leaked another user's alert rule name; minimal and in the same three messages the owner named.
- Self-approved: removed-Outputs and in-transaction messages are count-only (owner allowed count-only in-transaction).
