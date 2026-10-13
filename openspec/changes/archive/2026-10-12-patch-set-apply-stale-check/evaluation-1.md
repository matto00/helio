## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `791736a9a78e850d0a28c71e7ff3d137f0f4ca87` (branch `bug/patch-set-apply-stale-check/HEL-1458`).
Diff base: `e4ef70c31f7c16d9687a199feae997dce0217455` (resolved fresh with `resolve-review-base.sh`).
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1458/evidence/` (`eval-1-*` files and `eval-1-ui/`).

### Phase 1: Spec Review — PASS

All five ACs are met:

| AC | Where | Verified by |
| --- | --- | --- |
| Preview returns a fingerprint per target | `PatchSetPreviewProjection.scala` + `PatchSetTargetFingerprint.forEdit` (`v1:` + sha256 of the per-kind allowlisted projection; `None` for a create) | `PatchSetStaleCheckRoutesSpec` "return a fingerprint on update and delete entries and none on a create entry" |
| Apply accepts fingerprints, returns 409 naming the stale targets, applies nothing | `PatchSetApplyService.apply` runs `staleTargets` after `resolveAll` and before `applyResolved`. It collects every mismatch and returns `PatchSetStale`, rendered as 409 `{message, code, staleTargets}` in `ServiceResponse` | The 4-edit spec (2 stale, 2 fresh) checks that all 4 targets are unchanged, that `staleTargets` indices are `[0,2]`, and that the `patch_set_applications` count is unchanged (nothing journaled). I also checked it live: after a 409 the panel kept its intervening title (`probe-output.txt`). |
| Review page shows the conflict and offers Re-preview | `PatchSetReview.tsx` (shared `InlineError variant="banner"`, Re-preview replaces Accept), `PatchSetReviewPage.tsx` (`previewNonce` re-fetch) | jest, plus a live probe in both themes |
| After a successful apply, navigation replaces the review route | `navigate("/", { replace: true })` | jest Back test; live probe: after apply and Back, the URL is `/` and there are 0 "Accept & apply" buttons, in both themes |
| MCP `apply_patch_set` behaves the same | `refinementSchemas.ts` keeps `fingerprint` (zod would otherwise strip it). The tool description documents 409 / `PATCH_SET_STALE` and says not to retry. `describeError` forwards `body.message`, and the backend message names every target. | `refinementStaleConflict.test.ts` (real `callTool`), `refinementSchemas.test.ts`, `server.test.ts` |

- **D2 field table.** It is implemented exactly. I checked each allowlist key against the real response writers: `PanelResponse` has `title`/`type`/`appearance`/`config`; `DashboardResponse` has `name`/`appearance`/`layout`; the step writer emits `type` (it is added explicitly in `pipelineStepResponseFormat.write`), `config`, `position` and `enabled`. Each of these matches the matching `Update*Request` field. Server-maintained fields are excluded by construction: `meta`/timestamps, `lastRun*`, `ownerId`, ids, and `layoutVersion`. Panel `metricDeprecated` is stripped. The panel prior state comes from `PanelRepository.findById`, the raw (unmaterialized) read.
- **D3 (authorization wins).** The check runs only after `resolveAll` succeeds, so another user gets 404/403, not 409 (tested).
- **D5 strip/stamp.** Refinement strips model-emitted fingerprints, previews, then stamps them by index (0-based, matching `resolveAll`'s `zipWithIndex`). The stamped set is returned and stored as `latestPatchSet` (route-tested against the stored conversation row). The assistant path previews the stripped set and captures it (Mockito captor test). A model-invented fingerprint on a create is stripped rather than producing a 400 (tested).
- **Create plus fingerprint gives 400 at resolution, not in the reader.** The wire spec decodes it, and the route spec gets 400 on both preview and apply.
- **Scope.** Nothing outside the ticket was changed.
- **Workflow constraints.** `CONSTRAINTS` is empty. The driver rules are honoured: the new specs use `VerifiedEmbeddedPostgres.start`, `[hel1468-guard]` is present, and I found no inline FQNs (the grep of added Scala lines for `com.|org.|scala.|java.` outside import/package returned 0 hits).

**Red-first evidence.** I judge it genuine:
- `red-1.1.txt`: on the base, `PatchSetStaleCheckRoutesSpec` (the red version, raw-JSON `target.fingerprint`) fails 2 of 2 with `200 OK was not equal to 409 Conflict`, and `[hel1468-guard] ScalaTest summary: failed=2`. Exit status was 1.
- `red-1.2.txt`: the Back test fails on push-navigation because "Accept & apply" is found after Back.
- `mutation-drop-enabled.txt`: dropping `enabled` from the step allowlist fails 3 tests: the route-level "step disabled between previews" test, the allowlist-equality test and the per-field unit test.
- I did not re-run the red tests against the base myself, because that needs a separate worktree compiled at the base. The failure text and line numbers are consistent with what the test checks.

### Phase 2: Code Review — PASS

I ran every gate myself on the commit above:

| Gate | Result | Evidence |
| --- | --- | --- |
| `sbt testOnly com.helio.api.routes.patchsets.* com.helio.services.patchsets.* com.helio.domain.patchsets.* com.helio.services.assistant.* com.helio.api.protocols.assistant.*` (nice 19, `-Xmx3g`, server autostart off; MemAvailable was about 48 GB at start) | 44 suites, 438 passed, 0 failed; `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`; exit 0 | `eval-1-sbt.txt` |
| `npm run lint` / `format:check` / `typecheck` | all exit 0 | `eval-1-fe-static.txt` |
| `npm run check:schemas` | in sync, including `AssistantProposalToolSchemas.scala` (14 surfaces) | `eval-1-fe-static.txt` |
| `npm test` (root: frontend + helio-mcp projects) | frontend 573 suites / 6846 tests, helio-mcp 49 suites / 458 tests, all passed | `eval-1-jest.txt` |
| `npm --prefix frontend run build` | exit 0 | `eval-1-build.txt` |
| helio-mcp `npm run typecheck` | exit 0 | (console) |

No full `sbt testFull` was run, as instructed.

Code quality:
- **One implementation.** A single fingerprint helper is shared by preview and apply.
- **Canonical JSON.** Keys are sorted recursively, so the hash is not affected by the order of spray's map.
- **Typed errors.** `ServiceError.PatchSetStale` follows the `StepConfigInvalid` precedent, and the 409 body schema (`schemas/shared/patch-set-stale-response.schema.json`) is validated against the real response in the route spec.
- **Frontend.** The typed `PatchSetStaleRejection` and `isPatchSetStale` guard mean there is no `any`. `stampFingerprints` overrides incoming fingerprints and never stamps a create.
- **No `CONTRIBUTING.md` [mechanical] violations found.** No new file exceeds the size budget (largest new main file: `PatchSetTargetFingerprint.scala`, 96 lines). There is no dead code and no TODO/FIXME.
- **DESIGN.md [mechanical].** No new CSS or tokens. The conflict notice reuses the shared `InlineError` (banner variant) and the existing `ui-modal-btn` classes.

### Phase 3: UI Review — PASS

Dev servers ran on 6890/9797 via `start-servers.sh` (`assert-phase.sh servers`: PASS) and were stopped afterwards by exact PID (sbt 11720/11762/12067, vite 12836/12860). Both ports were confirmed free.

**Identity.**
- The shared MCP browser held another lane's `localhost` session cookie: `/api/auth/me` returned the HEL-1515 skeptic user.
- To avoid clobbering it, I ran the UI probe in an isolated headless context (`playwright-core` from the main checkout, chromium-1193): `eval-1-ui/ui-probe.cjs`.
- I registered the throwaway user `eval-hel1458-probe@example.test`, id `352a3a41-54d6-43ce-8762-31f023112e3e`, and verified it via `/api/auth/me` before any probe.
- I never acted as matt@helio.dev.
- Afterwards I deleted the user (and its seeded dashboard/panel/journal rows) with the repo's exact-id teardown (`e2e/support/userCleanupCore.cjs` `buildUserDeleteSql` + `db.cjs` `psql`). A login afterwards returns 401.

What I observed, in both dark and light (`probe-output.txt`, screenshots in `eval-1-ui/`):
- **Happy path.** The review renders and "Accept & apply" applies: 200, then navigation to `/`.
- **Conflict.** Preview, then a `PATCH /api/panels/:id` from another path, then Accept gives 409. The page stays on `/patch-sets/review` with the banner "Nothing was applied: edit 1 (panel db7e92a4-…) changed since this preview. Re-preview to review the current state." Accept is replaced by Re-preview. The panel keeps the intervening title ("Renamed elsewhere dark"/"…light"), confirmed through `/api/dashboards/:id/export`.
- **Re-preview.** Activated by keyboard (focus plus Enter). It clears the banner, shows a fresh preview, and Accept works again; the follow-up apply returned 200.
- **Back after apply.** It lands on `/` (the replaced entry) with 0 "Accept & apply" buttons. Apply requests per round were exactly `[409, 200]`, so there was no second apply.
- **Breakpoints 1440/1100/768/375.** The conflict state renders with 0 px horizontal overflow (`05-conflict-*.png`).
- **Console.** No JS exceptions or page errors. The only console errors are the browser's network-level "Failed to load resource" lines for the expected pre-login 401 on `/api/auth/me` and the deliberate 409s.
- **Cohesion (mechanical level only).** The banner is the same shared `InlineError` banner used for other review-page errors, with correct contrast in both themes. Subjective visual judgment is left to the skeptic.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetTargetFingerprintSpec.scala:11-29`: the "allowlist every field" test compares `Allowlist` with a hand-copied list, and the per-field tests mutate synthetic JSON.
  - So the guard cannot catch drift between an allowlist key and the real response key. For example, a future rename of `PanelResponse.appearance` would silently fall out of the hash.
  - design.md's Risks section promised a per-kind mutation through the real route/service. Today that exists only for panel title, step enabled/config, dashboard name and output config.
  - Suggest one table-driven route test mutating the remaining allowlisted fields through their services: panel appearance/type/config, dashboard appearance/layout, pipeline name, dataSource name, step type/position.
  - Today's keys are correct; I checked them by reading the code.
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetStaleCheckRoutesSpec.scala:6`: `import com.helio.api.routes.patchsets.PatchSetRoutes` imports from the spec's own package and is redundant.
- `PatchSetStaleCheckRoutesSpec.scala:292-299` (stale step delete): this test checks only that the step still exists. Asserting that its config is still `{"count":99}` and that the journal count is unchanged would mirror the multi-edit test.
- The 409 message is 0-based (`edit 0 (…)`, read by MCP agents) while the UI banner is 1-based (`edit 1 (…)`, matching the page's existing "Impact for edit N" labels). Both are internally consistent, but documenting the 0-based index in the MCP tool description would help agents map it back to `edits[]`.
- `proposal.md`, `design.md`, `specs/patch-set-stale-check/spec.md`, `ticket.md` and `.openspec.yaml` are untracked in the worktree. Only `tasks.md` and `files-modified.md` are in `791736a9a`. Make sure the archive step commits them so the PR carries the spec delta.
