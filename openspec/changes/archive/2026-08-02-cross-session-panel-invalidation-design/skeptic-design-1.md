## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **`PipelineRunRegistry` is single-subscriber-per-key and uses `CompletionStrategy.draining`** —
   confirmed by reading `backend/src/main/scala/com/helio/api/routes/PipelineRunRegistry.scala`
   directly: `private val refs = new ConcurrentHashMap[String, ActorRef]()` (one `ActorRef` per
   key, not a set) and `val completionMatcher: PartialFunction[Any, CompletionStrategy] = { case
   ActorStatus.Success(_) => CompletionStrategy.draining }` with an inline comment explaining the
   PR #156 `immediately`-vs-`draining` lesson. Matches design.md's Context section exactly.

2. **The claimed SSE-publish-before-`overwriteRows` race is real** — read
   `backend/src/main/scala/com/helio/services/PipelineRunService.scala:339-393`. Line 348:
   `publish(pidStr, RunStatusEvent("succeeded", rowCount = Some(resultRows.size)))` fires
   immediately on entry to `onRunSuccess`, before `rowsUpsert` (line 353-354,
   `dataTypeRowRepo.overwriteRows(...)`) is even constructed, and `rowsUpsert` isn't awaited until
   the `for` comprehension starting at line 386. Design.md's D2 citation of "line 348" is exact.

3. **`/api/types/:id/rows` (`DataTypeService.listRows`) is owner-scoped via `findByIdOwned`** —
   confirmed at `backend/src/main/scala/com/helio/services/DataTypeService.scala:43`:
   `dataTypeRepo.findByIdOwned(id, user).flatMap { ... }`. Confirmed the closing commit exists:
   `git show --stat 300423d1` → `HEL-265 CS3: DataType + DataSource ACL enforcement`, whose commit
   body explicitly lists "DataTypeService: findById/listRows/... take user ... requireOwnerOnly
   +findById → findByIdOwned". Design.md's correction to the ticket's stale premise is accurate
   and cites the right commit.

4. **`PanelService.resolveBindingsForRead` is strict-owner-only, no sharing-aware DataType
   lookup; no `data_type` resource type exists in `resource_permissions`** — confirmed at
   `backend/src/main/scala/com/helio/services/PanelService.scala:75-94`: calls
   `dataTypeRepo.findByIdsOwned(typedIds, user)` and clears the binding
   (`panel.withBindingCleared`) for any typeId not in the owned map. Searched all migrations for
   `resource_type` usages in Scala + SQL: `resource_type = 'dashboard'` (V36) and `resource_type =
   'pipeline'` (V39) are the only concrete values found anywhere in `backend/src/main/`; no
   `data_type` value or `findByIdShared`/`helio_can_access_data_type` analog for
   `DataTypeRepository` exists. Matches design.md's Context claim precisely.

5. **No `BroadcastChannel` usage exists in `frontend/`** — `grep -rn "BroadcastChannel"
   frontend/` (excluding node_modules) returned zero hits. Confirms design.md's premise that D1
   is genuinely new capability, not a duplicate of existing code.

6. **Supporting citations checked and accurate**: `markDataTypeRowsStale` exists at
   `frontend/src/features/panels/state/panelActions.ts:20`; `PipelineDetailPage.tsx` (path is
   `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`, not `pages/` as ticket.md says,
   but design.md itself cites it correctly without a path) dispatches it at line 117 on
   `event.status === "succeeded"`, matching the HEL-242 narrow-fix description. `overwriteRows`
   in `DataTypeRowRepository.scala` has one other call site
   (`BoundPanelService.scala:297`, a failure-path compensating cleanup that clears rows to
   empty) beyond `PipelineRunService`'s real-write call site — this doesn't contradict D2's
   "single chokepoint" framing (all row *writes*, including this cleanup, still funnel through
   `overwriteRows`), so I'm not counting it as an inaccuracy, just noting it as a non-blocking
   observation below. `PipelineRunRegistrySpec.scala` (read in full) has exactly 3 tests: ordered
   delivery, terminal-event completion, no-op on missing subscriber — no disconnect-without-
   terminal-event case, confirming D2's stated lifecycle-test gap.

7. **Ticket ↔ Linear parity**: fetched HEL-266 via `mcp__linear__get_issue` — `ticket.md`'s body
   is a verbatim match of the live Linear issue description (candidates A-D, five design
   questions, DoD, out-of-scope, related links all identical).

8. **No code changes shipped**: `git status --short` shows only the untracked
   `openspec/changes/cross-session-panel-invalidation-design/` folder — consistent with the
   ticket's "no production code changes" non-goal and proposal.md's Impact section.

9. **Internal consistency**: proposal.md's Impact section names exactly the systems design.md
   investigates (`PipelineRunService`, `dataTypeRowRepo`, `PanelService.resolveBindingsForRead`,
   `/api/types/:id/rows`, `PipelineRunRegistry`/PR #156) — no drift between proposal and design.
   tasks.md's checked items (1.1-2.2) match what's actually present in proposal.md/design.md;
   unchecked items (3.1-3.3, filing spinoff Linear tickets) are correctly left open since that's
   execution-phase work, not part of the design gate.

### Judgment on the design's merits

- The D1/D2/D3 recommendation is well-reasoned given the ground-truth constraints found: D1
  (BroadcastChannel now) is genuinely low-risk and orthogonal to the ACL question since it's
  same-browser/same-user by construction. D2 correctly identifies `overwriteRows` as the
  right chokepoint for the future-writer gap (verified: it is in fact the sole *write* call
  site) and correctly scopes the SSE registry's ACL to reuse the already-verified
  `findByIdOwned` check rather than inventing a new one. D3's rejection of C and D is
  proportionate — C's cost-scaling argument and D's "solving two layers deeper than what's
  blocking anyone" argument are both grounded, not hand-wavy.
- The self-correction of the ticket's stale ACL-asymmetry premise (Design Question 1) is the
  single most load-bearing claim in this document, and it is the one I verified most
  rigorously (items 3-4 above) — it holds up exactly as stated, including the important
  downstream consequence (cross-user gap is narrower than ticket.md originally assumed).
- Risks/Trade-offs section is honest: it explicitly flags that D2's owner-only ACL does *not*
  close the cross-user gap for sharing-aware viewers, and directs the tracking ticket not to
  claim otherwise — this is the kind of self-limiting honesty a design doc can easily skip.
- Open Questions correctly defer rather than hand-wave: the sharing-aware DataType ACL
  question and the telemetry-for-connection-scaling question are both genuinely out of this
  ticket's scope and are routed to spinoff/data-gathering work rather than assumed away.
- tasks.md accurately captures the ticket's DoD: design proposal (1.1-1.3), recommendation +
  cost estimates (2.1-2.2), and spinoff tickets to be filed (3.1-3.3, appropriately unchecked
  pending execution).
- No placeholders, TODOs, or blocking ambiguity found in any of the four artifacts. No scope
  drift — the design stays confined to DataType rows invalidation per the ticket's explicit
  out-of-scope list.

### Verdict: CONFIRM

### Non-blocking notes

- `ticket.md` cites `PipelineDetailPage.tsx` without a path; the actual file lives at
  `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` (not a `pages/` directory).
  Design.md doesn't repeat this ambiguity, so it's not a defect in the design artifacts
  themselves — just worth the spinoff-ticket author double-checking the real path when they
  scope D1/D2's frontend hook location.
- `BoundPanelService.scala:297`'s failure-path `overwriteRows(dtId.value, Vector.empty)` call
  is a second call site beyond `PipelineRunService.onRunSuccess`. D2's registry-at-`overwriteRows`
  placement will also fire (correctly, arguably desirably) for this compensating-cleanup path;
  worth a one-line mention in the eventual spinoff ticket so the SSE-registry implementer isn't
  surprised by an "empty rows" event on a failed bound-panel creation.
