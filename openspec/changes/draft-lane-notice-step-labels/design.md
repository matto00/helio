## Context

Since HEL-1631/1685, step edits change only a draft, and Save & run sends one `POST /api/pipelines/:id/draft/save`.
The refusal path, on main 014317f53:

- **Server.** `DraftDiff` validation messages name steps by their *draft key* (`r.key`, the clientId for a step this
  save creates, the stored id otherwise), so they can be resolved on the client. Two messages do not:
  - `DraftSaveTransaction.laneGate` (L236-240): `Step '${v.stepId}' has a lane reference to '${v.targetId}', which
    would be ${v.relation.describe}.` It is judged on the rows just written, so a created step and a created target
    appear under the server-generated UUID that `DraftDiff.plan` minted (`newId()`).
  - `DraftDiff.requireLaneTargetsExist` (L305-310): `Step '${w.id}' ...` uses `StepWrite.id`, the resolved
    (server) id.
- **Client.** `noticeForSaveError` (`hooks/draftSaveRequest.ts` L140-177) puts the server message verbatim into
  `DraftNotice.message`. `stepNamedBy` (L49-59) returns the label of the first step *in page array order* whose id
  the message contains. `PipelineDraftNotices.tsx` renders `Couldn't save step "<stepName>": <message> Your draft is
  still here.` The result: raw UUIDs are shown, and when the lane target precedes the saved step in the array, the
  prefix names the target.

HEL-1521's picker disables every cyclic choice, so this 400 is reached only when a later structural draft edit
turns an earlier valid lane choice into a cycle, or through a race. Stale-base and cascade conflicts are separate
paths and are untouched.

## Goals / Non-Goals

**Goals:** every step id in a draft-save refusal is one the client sent, and the notice shows labels, with its prefix
on the step the refusal is about.

**Non-Goals:** changing the 400 body shape (it stays `{message}`), localising the copy, de-duplicating two steps that
share a label, and any picker behaviour (owner ruling `keep-draft`).

## Decisions

**D1. The server names steps by draft key in the two lane messages.** `DraftPlan` gains a resolved-id → draft-key
map (built where `DraftDiff.plan` already builds `clientIds`, L88, inverted, covering created steps only). `laneGate`
receives the plan and maps both `stepId` and `targetId` through it (falling back to the id itself).
`requireLaneTargetsExist` names `w` by its draft key. Its target is the config value after the clientId rewrite
(`validatedConfig`, L296), and a clientId always resolves, so it can never dangle. The target is therefore either the
stored id of a step the draft removed or an id unknown to the server (for example, the clientId of a step the draft
created and then deleted). It is left as is, because it is already an id the client sent.
*Alternative rejected:* structured fields (`stepId`, `targetId`) in the 400 body. That is a contract and schema change
for one message family, while every other draft-save 400 already uses the draft-key-in-message convention; D1 keeps
the convention uniform.

**D2. The client substitutes labels and picks the subject by position in the message.** In `draftSaveRequest.ts`:
- **Known names.** Ids are resolved, in order, against: the draft steps (`ctx.draftSteps`), the saved steps
  (`ctx.steps`, so a step the draft removed, such as a dangling lane target, keeps its saved label), and the
  created draft Outputs (unchanged HEL-1733 D9 behaviour). The first hit for an id wins, so a draft label beats a
  stale saved one.
- `stepNamedBy` returns the name whose id occurs **earliest in the message** (`indexOf`, lowest wins), not the
  first in array order. Steps and created Outputs compete on one search. Every step-subject server message puts the
  subject first (`Step '<key>' ...`), so this names the saved step and never the target. The one message whose
  subject is an Output but which names a step, `outputs[$i]: nodeStepId '<sid>' is a step the draft removes`
  (`DraftDiff.scala:416`), yields the step's label. That is unchanged from main, where array order picks the same
  single id.
- A new pure helper replaces **every occurrence** of a known id in the message, quoted or not, with its label in
  double quotes (`"<label>"`). A surrounding pair of single quotes, if present, is consumed. Ids are matched
  longest-first, so an id that is a prefix of another cannot corrupt it. The notice's `message` is the substituted
  text.
- **Unknown ids render verbatim (recorded acceptance).** An id in neither list is shown as is. The only known case
  is a step the draft created and then deleted, whose clientId stays in another step's lane config: the page no
  longer holds that step anywhere. Rejected alternative: a generic phrase ("a removed step") for any id-shaped token.
  Draft-save messages also quote data-source and Output ids, so a step-specific phrase would mislabel them. A wrong
  name is worse than an honest id.
*Alternative rejected:* parsing the lane message with a regex specific to its wording. It breaks silently when the
server copy changes; D2 is wording-agnostic.

**D3. `PipelineDraftNotices.tsx` is unchanged unless the substituted copy needs it.** The prefix plus message stays
`Couldn't save step "Sort rows": Step "Sort rows" has a lane reference to "Limit", which would be its descendant.
Your draft is still here.` The repetition is accepted (see Planner Notes).

**D4. hel908-tail-attach is rewritten on the spine/draft helpers.** Reuse the existing helpers instead of new
selectors: `e2e/support/pipelineSpine.ts` (`spineRows`, `spineRow`, `selectRow`, `clickRowMenuItem`,
`editorAction`), and `e2e/support/hel1684-draft-structural.ts` (`pickStep`, which is `#step-palette-option-<kind>`,
plus `stepMenu`, `saveAndRun`, `openPipeline`). Import what is exported; if a helper is not exported, use the same
selector it uses, never a new one. Every structural action happens in a draft. **Each test asserts the tree
twice**: (i) in the draft, before Save & run, which is the without-reload class HEL-908 existed for, now the
client's draft replay (`attachLane`/`spliceAfter`/`deleteStep` in `state/draftOps.ts`); and (ii) after Save & run
plus a reload, the persisted server tree. The four tests keep their HEL-908 intent:
1. two trunk steps; add a lane/tail off the first; trunk count stays 2; add a second tail off the same step and
   both exist (the current several-tails rule, replacing one-tail-per-step);
2. a leaf tail stays with its owner after a later trunk append;
3. duplicating a tailed trunk step keeps the tail on the clone (`spliceAfter` moves every child of the anchor
   under the clone). Draft assertion: the tail row sits under the clone's row and the original has none;
4. removing a step that owns a head child and a tail drops the cascade-deleted tail. Draft assertion: no tail row
   remains and the head child took the removed step's place. Save goes through the cascade confirmation (the
   `cascadeGate` 422).
The executor confirms each rule against the running app and the server before encoding it; any rule that differs
from this list is reported, not silently re-specified. Cleanup uses `recordRegisteredUser` (exact id).

**D5. Quarantine.** Remove `"**/hel908-tail-attach.spec.ts"` and its comment block from `playwright.config.ts`
(L106-110). Other entries that mention HEL-962 or this spec are updated to match. The hel908-full-flow entry stays
(HEL-964).

## Risks / Trade-offs

- [Two steps share a label, so the notice is ambiguous] → Accepted: this is an existing property of the
  `Couldn't save step "X"` prefix (HEL-1631). Out of scope.
- [A label containing `'` or `"`] → Substitution works on ids, so labels are inserted verbatim as React text (no HTML).
- [The lane 400 is hard to reach in the UI, so the visual check may have no live path] → The first path to try is the
  dangling target: delete, in the draft, a step that a join/union/lookup's lane reference names, then press Save &
  run (`deleteStep` leaves other steps' configs untouched). Next, a structural edit that makes an earlier lane choice
  cyclic. If neither path renders the notice, the jest proof stands and the PR says so plainly (ticket AC).
- [The e2e becomes flaky] → Uses the shared, stable hel1684 helpers. 3 consecutive local runs at 2 workers are
  required. It is not added to any flake list.

## Planner Notes

- Self-approved: D1's message-text change (no contract change; the copy is not asserted by any existing test,
  per a grep for "would be its" in `backend/src/test` = 0 hits).
- Self-approved: the repeated label in prefix and message (D3). Stripping the server's subject would couple the
  client to the wording, which D2 avoids.
- Owner rulings (escalation HEL-1542-1795647439065-9d63cb): restated scope, `keep-draft`, `rewrite-all-four`,
  `link-only`.
- Revised after design-gate round 1 (skeptic-design-1.md, CR1-CR4); CONFIRMED in round 2 (skeptic-design-2.md). Round-2
  notes adopted: the id match is delimited (not a bare substring: an id must not be adjacent to `[A-Za-z0-9_-]`), so a
  short temp `step-N` id cannot match inside other text; backend cases that remove a step send `confirmCascade`.
- Spin-off candidate (out of scope, follow-up triage at Delivery): `DraftDiff.planOutputs`' insight-reads 400 names a
  created Output by its server-minted id (`DraftDiff.scala:361, 379, 389-390`), against HEL-1733 D9.
- Item 3 is limited to the three HEL-1515 comments. `captures` in those fixtures is now unread. Removing it is out of
  scope (noted for the PR, not changed).
