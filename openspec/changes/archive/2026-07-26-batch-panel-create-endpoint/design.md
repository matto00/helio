## Context

`helio-news`'s `_build_story` fans out to `add_image_panel`, `add_text_panel`, and
`build_bound_panel` per story — every call a separate `POST /api/panels`. Helio already has two
adjacent multi-panel writers: `POST /api/panels/updateBatch` (mutate N *existing* panels,
`PanelMutationOps.batchUpdate`, one transaction) and `PUT /api/dashboards/:id/contents` (HEL-363,
`DashboardContentsOps.replaceContents` — DELETE all existing panels, INSERT a new set, one
transaction). Neither creates N *new* panels while leaving the dashboard's existing panels alone.
`PanelService.buildForCreate` (extracted in HEL-363, `private[services]`) already does the
construct-and-validate-without-inserting work for one panel; `DashboardContentsService.buildPanels`
sequentially calls it once per `ProposalPanel` (translated to a `CreatePanelRequest` first),
short-circuiting on the first failure, with zero DB writes until the single transactional write.

## Goals / Non-Goals

**Goals:** one `POST /api/panels/batch` call creates N panels on ONE existing dashboard, all-or-
nothing (zero DB writes on any invalid item), returned in input order; V41 binding enforced per
item; owner/editor-scoped identically to `POST /api/panels`; reuse `buildForCreate` rather than a
second validator.

**Non-Goals:** the source→pipeline→run→bind chain (HEL-364; batch is explicitly out of scope there
too — items may only bind `config.dataTypeId` to an *existing* pipeline-output DataType); layout
placement (HEL-367); resource tagging (HEL-366); panel-id-preserving diff/reconciliation (HEL-368);
multi-dashboard batches; deleting/replacing existing panels (that's HEL-363's job).

## Decisions

**D1 — Additive sibling, not a `DashboardContentsOps.replaceContents` reuse; new INSERT-only repo
op.** `replaceContents`'s DELETE-then-INSERT is the wrong primitive for an *additive* batch — reusing
it verbatim would delete every panel the caller didn't include, which is replace-contents' contract,
not batch-create's. What genuinely IS shared is the validate-everything-before-any-write shape and
the per-item build primitive (`buildForCreate`). New `PanelMutationOps.insertBatch(panels:
Vector[Panel]): Future[Vector[Panel]]` mirrors `batchUpdate`'s one-`.transactionally`-DBIO,
`withSystemContext` (ACL already confirmed by the service layer) shape, but is a pure multi-row
INSERT (`DBIO.sequence(panels.map(p => table += domainToRow(p)))`) — no DELETE, no dashboard-row
touch, no layout write (layout is HEL-367's job). Returning the already-fully-constructed `panels`
vector directly (not a re-query) keeps input order trivially exact — no `ORDER BY` reconstruction
needed, same trick `PanelRepository.insert` already uses for the single-create path.

**D2 — Extract `PanelService.buildAllForCreate`; refactor `DashboardContentsService.buildPanels`
onto it (behavior-preserving); optional per-item error label, defaulted off.** Rather than leaving
two hand-rolled "sequentially build, short-circuit on first Left" recursions (one in the new
batch-create service, one already in `DashboardContentsService`), extract the recursion itself as
`PanelService.buildAllForCreate(dashboardId, requests: Vector[CreatePanelRequest], user, itemLabel:
Int => Option[String] = _ => None): Future[Either[ServiceError, Vector[Panel]]]`.
`DashboardContentsService.buildPanels` already maps each `ProposalPanel` to a `CreatePanelRequest`
via `ProposalPanelSupport.buildCreateRequest` before calling `buildForCreate` one at a time — it now
builds that `Vector[CreatePanelRequest]` up front and delegates the recursion to
`buildAllForCreate`, passing NO `itemLabel` (default `_ => None`), so its error messages are
byte-for-byte unchanged (today, `DashboardContentsService`'s own indexed "panel N ('title')" errors
come entirely from its separate `validatePanels`/`preValidateBindings` pre-passes that run BEFORE
`buildPanels`, not from `buildForCreate` itself — a `buildForCreate`-level failure, e.g. a malformed
derived `config`, is unindexed today and stays unindexed after this refactor). `batchCreate` (D5)
passes `itemLabel = idx => Some(s"panel ${idx + 1} ('${requests(idx).title.getOrElse("")}')")`: when
a `BadRequest` `Left` occurs at index `idx`, `buildAllForCreate` prefixes its message with that
label before returning (non-`BadRequest` errors pass through unlabeled — `buildForCreate`'s own
failure modes are all `BadRequest`, so this covers every real case). This resolves the ticket's
explicit "400 identifies the offending item by index/title" AC for batch-create without changing
`DashboardContentsService`'s behavior at all. Covered by `DashboardContentsService`'s existing test
suite (must still pass byte-for-byte) plus new tests for both the unlabeled and labeled paths of the
shared helper. This is the concrete answer to "is batch-create the additive sibling of
replace-contents": yes, at the validate-and-build layer (one implementation, two callers, one of
which opts into item-labeled errors); no, at the persistence layer (an INSERT-only op is a genuinely
different write than DELETE+INSERT).

**D3 — Wire shape: `CreatePanelRequest`-shaped items, `dashboardId` lifted to the envelope (not
per-item).** Per the ticket text and unlike `PanelBatchItem` (which needs a per-item `id` because
each entry targets a different *existing* panel), every item here targets the SAME dashboard, so
repeating `dashboardId` N times would be pure redundancy and would need a "must all match" check
`batchUpdate` needs for the analogous reason. New types mirror the existing batch-update naming:
`CreatePanelsBatchRequest(dashboardId, panels: Vector[CreatePanelBatchItem])`,
`CreatePanelBatchItem(title?, type?, config?, appearance?)` (== `CreatePanelRequest` minus
`dashboardId`), `CreatePanelsBatchResponse(panels: Vector[PanelResponse])`. The service maps each
item + the envelope `dashboardId` into a `CreatePanelRequest` before calling `buildAllForCreate` —
zero new validation surface, same decode path every single create uses.

**D4 — ACL: two-step check on the single `dashboardId`, mirroring
`DashboardContentsService.authorizeEditor` — NOT `PanelService.create`/`authorizeEditorOnDashboard`.**
*(Revised after design-gate round 1 REFUTE — see below.)* A bare `accessChecker.requireAccess` call
(`AccessCheckerImpl.requireAccess`) returns `Forbidden` (403), not `NotFound`, for an authenticated
caller with zero grant on an existing resource — confirmed by reading
`backend/src/main/scala/com/helio/api/AccessCheckerImpl.scala`. `PanelService.create`'s
`authorizeEditorOnDashboard` uses that bare call directly, so it inherits the leak: a cross-tenant
caller gets 403 (existence confirmed) instead of 404. `DashboardContentsService.authorizeEditor`
(`DashboardContentsService.scala:114-136`) was written specifically to avoid this — step 1 is the
sharing-aware `dashboardRepo.findById(dashboardId, Some(user))` (`None` → 404, no existence leak);
only once the caller is a KNOWN grantee does step 2 check role tier (owner proceeds directly; a
non-owner grantee's role goes through `accessChecker.requireAccess`, Viewer → 403). `batchCreate`
adopts this exact two-step pattern (a small private `authorizeEditor` mirroring
`DashboardContentsService`'s, or a shared extraction if the executor finds a clean seam — not
required) rather than `authorizeEditorOnDashboard`, since the batch's single up-front `dashboardId`
check is precisely the shape this pattern targets. Explicit cross-tenant test: a caller with zero
access to `dashboardId` gets 404, not 403, and zero panels are created; a viewer-only grantee gets
403. (Non-blocking observation, not fixed here: `PanelService.create`/`update`/`delete`/`duplicate`
still carry the un-fixed bare-`accessChecker.requireAccess` pattern — worth a spinoff ticket, out of
scope for HEL-370.)

**D5 — Failure semantics: build-all-then-write-once, no partial writes, first-bad-item 400 named by
index/title.** `buildAllForCreate` short-circuits on the first `Left` (same as
`DashboardContentsService.buildPanels` today) — a bad item (invalid type, invalid `chartType`,
V41-violating binding) 400s naming that item (via D2's `itemLabel`, e.g. `"panel 2 ('Revenue'):
panels can only bind to pipeline-output data types"`), before `insertBatch` is ever called.
`insertBatch` itself wraps its INSERTs in one `.transactionally` DBIO so even a same-transaction
DB-level failure (e.g. a constraint violation) rolls back every row in the batch, not just the
failing one.

## Risks / Trade-offs

- [Two write paths (`insertBatch` append-only vs. `replaceContents` delete+insert) could drift in
  what "a valid panel" means] → mitigated by D2: both funnel through the identical
  `buildAllForCreate`/`buildForCreate` validate-and-construct step; only the final persistence call
  differs, and that difference is the correct, intentional one (append vs. replace).
- [`PanelService`/`DashboardContentsService` refactor touches an already-shipped, tested file] →
  behavior-preserving only (identical recursion, extracted verbatim); existing
  `DashboardContentsService` tests are the regression guard, plus this change adds direct
  `buildAllForCreate` unit coverage.
- [Empty `panels` array] → rejected with 400 (`"panels must not be empty"`), mirroring
  `PanelService.batchUpdate`'s existing empty-batch guard.
- [`insertBatch` uses `withSystemContext` (privileged pool, bypasses the `panels_insert` RLS `WITH
  CHECK` policy) rather than `PanelRepository.insert`'s `withUserContext(ownerId)`] → precedented by
  `PanelMutationOps.duplicate`, which does the same for its own new-row insert; every panel passed to
  `insertBatch` already has its `ownerId` set to the ACL-checked caller inside `buildForCreate`, so
  this is not a correctness gap. The implementation must carry an inline comment at the callsite
  justifying the bypass, matching this codebase's convention for every `withSystemContext` use.

## Planner Notes

Self-approved: `CreatePanelsBatchRequest`/`CreatePanelBatchItem`/`CreatePanelsBatchResponse` as new
wire types (D3, naming mirrors `PanelBatchItem`/`UpdatePanelsBatchRequest` precedent); the
`buildAllForCreate` extraction + `DashboardContentsService` refactor (D2, behavior-preserving,
existing tests are the safety net); `insertBatch` as a new `PanelMutationOps` method rather than
reusing `DashboardContentsOps` (D1, different write semantics, same file/trait-mixin pattern already
established); adopting `DashboardContentsService.authorizeEditor`'s two-step ACL pattern over
`PanelService.create`'s bare-`accessChecker.requireAccess` pattern (D4, revised post design-gate
round 1 — the latter is a known existence-leak class this ticket must not reopen); an optional
`itemLabel` parameter on `buildAllForCreate`, defaulted to a no-op for `DashboardContentsService`
and opted into by `batchCreate` (D2/D5, added post design-gate round 2 — resolves the ticket's
"400 identifies the offending item" AC without changing `DashboardContentsService`'s existing,
tested, currently-unindexed-for-this-error-class behavior). All are implementation-detail choices
within the ticket's stated scope.
