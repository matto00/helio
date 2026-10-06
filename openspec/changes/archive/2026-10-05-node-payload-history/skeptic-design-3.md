## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD d9473814f16df0c54ef76117c00ce9c071297b2b (= origin/main after a fresh fetch). The change dir is
untracked, so I read the artifacts from disk: ticket.md, proposal.md, design.md, tasks.md,
specs/node-payload-history/spec.md and specs/output-history-api/spec.md.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/opt-in-payload-history/HEL-1276`.
- **Owner rulings.** `.concertino/runs/HEL-1276/events.jsonl` line 5 is `escalation.answered`,
  `sub_answers ["1mib-skip","output-config"]`, `answer_source: human`. C1 and C2 match. I did not reopen them.
- **Round-2 CR (production wiring) is resolved.**
  - D-8, task 5.4, C5 and task 6.9 now cover it, and proposal Impact names `Main.scala` and `ApiRoutes.scala`.
  - There is exactly one `new PipelineRunService(` (ApiRoutes.scala:451). The scheduler reuses
    `apiRoutes.pipelineRunService` (Main.scala:276-290), so threading the payload repo through ApiRoutes reaches
    manual, scheduled and auto runs alike.
  - `OutputHistoryRetentionService` is built in exactly one place (Main.scala:282-283). Its constructor
    (OutputHistoryRetentionService.scala:18-22) is the right place for the non-defaulted parameters.
- **V116 is free.**
  - origin/main tops out at `V115__output_snapshot_history.sql` (numeric sort).
  - No worktree in `git worktree list` has a V116-V119 file.
  - No open PR touches `db/migration`; `gh pr list` returned nothing for that filter.
- **D9 seam.**
  - `overwriteRowsWith(..., andThen: DBIO[Unit])` (NodeSnapshotRepository.scala:113-120) runs the replace plus
    `andThen` in one `withSystemContext` transaction.
  - The only caller is PipelineRunService.scala:1452.
  - `payloadAction.flatMap(pid => insertAction(...))` is a `DBIO[Unit]`, so nothing in a guarded file changes.
- **D5.**
  - `onUnblockedRunSuccess` is called only from :1290. Dry runs exit through `onDryRunSuccess` at :1185.
  - The other per-node writer (:784, the preview/materialize path) uses plain `overwriteRows` and records nothing.
  - The payload path is nested in the summary path, so it inherits D5.
- **HEL-1282.**
  - `scripts/check-node-root-encoding.mjs` TARGET_FILES lists `OutputRepository`, `NodeSnapshotRepository` and
    `BinaryRefRepository`.
  - No task edits any of the three. The new repository goes in a new file.
- **V116 ALTER, FK, ON DELETE SET NULL and RLS.**
  - V115 has no triggers on `output_snapshot_history`, so the SET NULL UPDATE meets nothing that would block it.
  - `users.tier` has a CHECK constraint (`'free','beta','owner'`, V88:13), and the D-5 fail-closed "unnamed tier"
    branch mirrors `thinAndPurge` (OutputHistoryRepository.scala:~97-118).
  - RI checks and actions bypass RLS, so a privileged-pool payload delete can SET NULL rows in FORCE-RLS
    `output_snapshot_history`.
  - Prod Flyway runs as `helio`, which owns both tables, so the ALTER and the new FK need no extra grant.
  - The registration sites exist: FlywayNonSuperuserMigrationSpec, RlsPolicyGuardSpec, RlsPrivilegedDmlSpec, and
    OutputHistoryRlsSpec as the two-role precedent. Tasks 1.2 and 6.5 cover them, and 6.5 requires the red.
- **Storage fidelity.** `node_snapshots` also stores rows as JSONB (`data JSONB`), so a JSONB payload has the same
  key-order semantics as the live snapshot. Array order is preserved, which supports the spec's "original order"
  claim.
- **Tier caps vs L2.**
  - `thinAndPurge` deletes points under its own advisory lock.
  - D-5 then runs the payload purge (separate key), including the unreferenced sweep.
  - In the retention service, payload purge after thinning is the right order.
  - Nothing defines 'previous' (HEL-1285 untouched).
- **Contract.**
  - `OutputHistoryRoutesSpec.scala:273-292` already validates the live response against
    `output-history-response.schema.json` (with a teeth check), so the new required `id`/`hasPayload` are enforced
    at the seam.
  - `OutputHistoryPublicRoutesSpec.scala:99` asserts the exact public point key set
    `{capturedAt,rowCount,summary}`, which already guards against `id`/`hasPayload` leaking.
  - `check-schema-drift.mjs` maps by `title`, so the new payload response schema needs a matching case class.
    `check:schemas` will enforce that.
- **D8, public isolation. This is where it fails.** See CR 1.
  - The public history route is `pathPrefix(Segment / "history") { pathEndOrSingleSlash ... }`
    (PublicDashboardRoutes.scala:412-413), so `/history/<id>/rows` does not match. That part holds.
  - ApiRoutes.scala:872-883 composes `optionalAuthenticate { PublicDashboardRoutes ... }` followed by
    `authenticate { ... }`.
  - `AuthDirectives.authenticate` (AuthDirectives.scala:80-90) **completes** `401 Unauthorized` when no cookie or
    bearer credential is present. It does not reject.
  - A share `?token=` is not a credential to `identity`, which reads only the cookie and the Authorization header.
  - So an anonymous `GET /api/dashboards/:d/panels/:p/history/<id>/rows`, with or without a share token, falls
    through to `authenticate` and returns **401**, not 404. The AutoLayoutRouteSpec.scala:149-152 precedent asserts
    exactly this 401 for an anonymous request under `/api/dashboards/...`.

### Verdict: REFUTE

### Change Requests

1. **The public payload-path scenario asserts a status the live route tree cannot produce.** These two places say
   that an anonymous request to `/api/dashboards/:d/panels/:p/history/<realPointId>/rows`, with and without a valid
   share token, returns `404`:
   - specs/output-history-api/spec.md, scenario "Public payload path does not exist" ("THEN the response is 404 and
     carries no row data"),
   - tasks.md 6.7 ("anonymous and with a valid token -> 404, no row data").

   Through the real `ApiRoutes` composition it returns `401`. The public subtree rejects the path, and
   `authDirectives.authenticate` (AuthDirectives.scala:88-89) then completes 401 for a request with no credential
   (ApiRoutes.scala:872-883). As written, the executor has three options, all bad:
   - write a test that fails,
   - quietly assert 401 and diverge from the spec (a final-gate REFUTE),
   - add a public route that exists only to return 404, which contradicts the plan's own "PublicDashboardRoutes
     gains nothing" (D-6).

   Required revision, in both the spec scenario and task 6.7:
   - State the property that actually matters: no public route matches or serves the path, and the full-stack
     response carries no row data.
   - Make the expected statuses match the live composition. Through the full `ApiRoutes`, an anonymous caller and a
     share-token-only caller each get `401` with no row data.
   - Assert that `PublicDashboardRoutes` alone does not handle the path. For example, `handled shouldBe false`, or
     under `Route.seal` a 404, in the same harness style as `OutputHistoryPublicRoutesSpec`.
   - Optionally, a logged-in stranger on the full stack gets the same 404 as on the authenticated route. That is
     already covered by 6.6, so it is optional here.
   - Update the requirement sentence "No public route SHALL serve a history point's row payload" only if needed. The
     sentence is fine; the scenario's THEN is wrong.

### Non-blocking notes

- **D-3 step 2 vs D-4.** D-4 says "A tier whose runs **or age** is 0 stores nothing", but D-3 step 2 skips the write
  only when the run cap is 0. With the age set to 0 and runs above 0, a payload would be written and then purged on
  the next pass. Make step 2 check "runs == 0 OR age == 0" so write and purge agree.
- **D-3 step 3 wording.** The step says both "trim at most ONE row" and "Trim to the newest N", which a hurried
  reader can take as "delete everything beyond N". The intent is clear from the deadlock rationale: delete at most
  the single oldest row beyond the newest N, and leave larger excess to the purge. Consider dropping the second
  sentence or folding its ordering clause into the first.
- **Residual deadlock surface.** The one-row trim's `ON DELETE SET NULL` updates every point that references that
  payload (one per opted-in Output on the node). Those updates run while `thinAndPurge` may be multi-row deleting
  the same points under a different advisory key. The window is tiny and the design acknowledges it. If a deadlock
  victim ever lands on the run side, the node and therefore the run fail (D9). Worth one sentence in the PR body.
- **`OutputHistoryService` is shared with the public route** (PublicDashboardRoutes.scala:306-313 calls
  `forOutput`). Adding the payload repo to its constructor is fine. Keep `payloadRows` the only consumer of that
  repo, and keep the public projection (`OutputHistoryResponses.public`) the only path to public JSON. The existing
  exact-key-set assertion at OutputHistoryPublicRoutesSpec.scala:99 will catch a leak.
- **Gate-defect check (CON-160).** Not applicable: no evidence directories or mtime-ordering claims were involved.
