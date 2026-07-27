## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Read all current artifacts fresh**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/workspace-context-assembly/spec.md`, `workflow-state.md`, and the round-1 report
  (`skeptic-design-1.md`, treated as a claim to re-derive, not trusted).
- **Confirmed the round-1 diff is exactly what it claims to be** — `git show 2ab914f7` touches only
  `design.md`, `tasks.md`, `specs/workspace-context-assembly/spec.md`, `skeptic-design-1.md` (added),
  `workflow-state.md`. Read the full diff, not just the commit message.

**Finding 1 fix (D2 cost bound) — re-derived independently, holds:**
- `computeColumnStats` (`backend/src/main/scala/com/helio/services/WorkspaceContextService.scala:312-320`)
  builds its map from `fields.filter(fieldCategory(f).contains(Structured)).take(SampleColumnLimit)`
  (line 317, `SampleColumnLimit = 40` at line 75) — read the function body directly, not the design doc's
  citation of it. The resulting `Map[String, WorkspaceContextColumnStats]` has ≤40 keys, by construction,
  independent of how many fields the DataType declares.
- `WorkspaceContextDataType.columnStats` (`WorkspaceContextProtocol.scala:77`) is a real field of the
  actual case class the fix's filter expression (`dt.columnStats.contains(c.name)`) references — not an
  invented/aspirational field name. `WorkspaceContextColumn.name` (`:30`) likewise exists.
- Since D2's fix requires membership in a map that is *itself* capped at 40 (not merely bounded by an
  unrelated SQL-tier fetch limit as the round-1-refuted version claimed), the candidate set per DataType
  is genuinely `≤ min(|identifier-named fields|, |columnStats.keys|) ≤ 40`. This is now a bound enforced
  at the candidate-gathering step itself, closing the exact defect round 1 found (a bound "inherited" from
  an unrelated mechanism). Sound.
- **Side-effect claim (1) verified**: `toDataTypeEntry` (`:201-220`) sets `columnStats = Map.empty` for any
  DataType with `dt.sourceId.isDefined` (the source-companion case; `pipelineOutput = dt.sourceId.isEmpty`
  at `:227`), so a source-companion DataType's candidates are always `∅` under the new filter, with no
  separate `pipelineOutput` check needed. Confirmed by reading the branch, not asserted.
- **`tasks.md` 3.1 and `design.md` D2 agree verbatim** — task 3.1's filter expression
  (`dt.columns.filter(c => c.semanticRole == "identifier" && dt.columnStats.contains(c.name))`) is a
  literal restatement of design.md's fix, not a divergent paraphrase. `tasks.md` 4.2 explicitly calls out
  the MCP mirror must use the same restriction "NOT the unbounded `t.fields.map(...)`/`columns` array at
  `context.ts:495`" — checked that `helio-mcp/src/context.ts`'s `computeColumnStats` (line 187-193) has the
  identical `.slice(0, SAMPLE_COLUMN_LIMIT)` cap (`SAMPLE_COLUMN_LIMIT = 40` at line 56), so the same fix is
  mechanically available on the TS side; task 4.2 is achievable as written, not aspirational.
- `specs/workspace-context-assembly/spec.md`'s new scenario ("A wide DataType's join-hint candidates are
  bounded at the column-statistics cap") matches the fix precisely and is testable (`tasks.md` 5.2 commits
  to a unit test exercising exactly this).
- No artifact was left stale: grepped the whole change directory for the old, refuted phrasing ("the
  SQL-tier bound HEL-373 already enforces on the columns list") — the only remaining occurrence is inside
  `skeptic-design-1.md` itself (the archived round-1 report, correctly left as history).

**Finding 2 fix (D1 step 5 token-exact) — hand-walked, holds:**
Normalization: `([a-z0-9])([A-Z]) → $1_$2`, lowercase, split on `_`; identifier match iff the token set
contains `id`, `uuid`, or `guid` as a **whole** token.

| Input | Normalized tokens | Contains `id`/`uuid`/`guid` token? | Classified identifier? | Correct? |
|---|---|---|---|---|
| `guidance` | `[guidance]` | no | no | yes (fixes round-1 finding) |
| `guideline` | `[guideline]` | no | no | yes |
| `misguided` | `[misguided]` | no | no | yes |
| `id` | `[id]` | yes | yes | yes |
| `user_id` | `[user, id]` | yes | yes | yes |
| `userId` | `→ user_Id → [user, id]` | yes | yes | yes |
| `external_uuid` | `[external, uuid]` | yes | yes | yes |
| `valid` | `[valid]` | no | no | yes |
| `paid` | `[paid]` | no | no | yes |

Also spot-checked additional plausible substrings not in the prompt's list (`squid`, `liquid`, `acid`,
`grid`, `solid` → none tokenize to a lone `id`/`uuid`/`guid`; correctly excluded) and a `guid`-camelCase
case (`extGuid` → `[ext, guid]` → correctly matches, since it genuinely is a `_guid`-suffixed name).
No new false positive or false negative introduced by the unification.

**Step 4 (temporal) non-regression**: confirmed via the diff that step 4's own text is byte-for-byte
unchanged by the round-1 fix commit — only step 5 was rewritten to *reuse* step 4's already-token-exact
normalization function, not to modify it. Since both steps now call the same normalize/tokenize helper
(per `tasks.md` 2.1's "Include the name-normalization helper... as a private, independently unit-testable
function"), there is one shared implementation, not two forked ones that could drift — reduces regression
surface rather than introducing one.

**D3 (RLS) re-check against the D2 rewrite:**
- D3's text is untouched by the round-1 fix commit (confirmed via `git show` diff — no changes to that
  section). Its claims (`computeJoinHints` is DB-free; `dataTypes` comes from `DataTypeRepository.findAll`
  filtered by `ownerId`; `columnStats` is owner-gated via `listRows`'s `findByIdOwned`) do not depend on
  *how* candidates are gathered inside `computeJoinHints` — only on what `computeJoinHints`'s inputs are,
  which the D2 rewrite doesn't change (still `Vector[WorkspaceContextDataType]`, still zero new DB access).
- Independently re-confirmed the `findByIdOwned` claim (round 1 verified `findAll`'s ownerId filter but not
  this): `backend/src/main/scala/com/helio/services/DataTypeService.scala` — `listRows` (`:37-43`) calls
  `dataTypeRepo.findByIdOwned(id, user)` before ever touching rows, an app-layer choke point, matching D3's
  citation. The D2 rewrite introduces nothing new to check here — it doesn't add or remove a DB call, and
  D3's argument is orthogonal to which subset of already-fetched `columnStats` entries get filtered into
  candidates. Consistent, no new RLS surface.

### Consistency across artifacts
- `design.md` D1 step 5, D2 ↔ `tasks.md` 2.1/3.1/4.2/5.1/5.2 ↔ `specs/workspace-context-assembly/spec.md`'s
  new scenario all agree on the same fix, in the same terms, with no artifact left stale.
- Minor pre-existing (not introduced by this round's fix, not blocking): `proposal.md`'s Impact section
  still says "Backend: `WorkspaceContextService.scala`, `JsonProtocols.scala`" where the actual protocol
  additions belong in `WorkspaceContextProtocol.scala` (a separate file mixed into `JsonProtocols.scala`
  via `com/helio/api/JsonProtocols.scala:56`). `tasks.md` 1.1 already correctly cites
  `WorkspaceContextProtocol.scala`, so this doesn't block implementation — noted for hygiene only.

### Verdict: CONFIRM

Both round-1 defects are genuinely closed, not just reworded. I independently re-derived the `columnStats`
cap from the actual `computeColumnStats` code (not the design doc's citation of it), confirmed the fix's
filter expression matches real field names on the real case classes, verified the MCP side has the
equivalent cap available so task 4.2 is achievable, hand-walked the token-exact identifier logic against
the original false positives plus additional adversarial inputs with no new gap found, and confirmed D3's
RLS argument is unaffected by and consistent with the D2 rewrite. `tasks.md` and `spec.md` were both
updated in lockstep with `design.md` — no stale artifact.

### Non-blocking notes
- `proposal.md`'s Impact section names `JsonProtocols.scala` instead of `WorkspaceContextProtocol.scala`
  for the protocol changes (pre-existing, not introduced this round; `tasks.md` already has the correct
  file). Worth a one-line fix whenever the artifact is next touched, not blocking.
- Carrying forward round 1's non-blocking note: the final-gate skeptic should still independently re-trace
  the RLS/cross-tenant `joinHints` scenario against real code once implemented, per the ticket's own
  "Design-gate attention" item — the pure-unit-test-plus-code-comment approach in `tasks.md` 5.2 is
  reasonable at design time but the ticket explicitly flags this as a required final-gate verification
  item, not something to accept on documentation alone once code exists.
