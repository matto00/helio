## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs are addressed explicitly:
  - Inline form renders per unresolved connector reference, Accept disabled while any remain — verified live.
  - Provider-specific retrieval instructions rendered (from `newConnector.retrievalInstructions`) — verified live.
  - "Demonstrated" credential-absence AC: `InlineConnectorSetup.test.tsx` (frontend runtime), `CredentialSurfaceEnumerationSpec`/`ConnectorSummaryCredentialAbsenceSpec` (backend), `check-no-credential-in-agent-surface.mjs` (structural) together enumerate transcript/context/tool-result/log/router-state/Redux surfaces in both directions. Independently re-verified (see Phase 2/3).
  - Mechanical enforcement + demonstrated red: independently reproduced (see Phase 2).
  - No-reveal-after-submission: verified live — form section unmounts entirely on success, no credential ever redisplayed.
  - "Agents never see keys" claim accuracy: verified against the actual mechanism, not assumed (Phase 2).
  - Works for pipeline/dashboard/combined: pipeline verified live; combined wiring is structurally identical (same detection helper + same `InlineConnectorSetup`, confirmed by diff read); dashboard-kind is genuinely vacuous — `DashboardProposal` (`frontend/src/features/dashboards/types/proposal.ts:40-43`) has no source/connector-bearing field at all, confirmed by direct read.
- Task list (tasks.md) — all 18 items check out against the diff; task 1.1's note that `AssistantToolExecutor.scala`/`PipelineService.scala` needed edits despite the "do not touch" list is accurate and justified: both diffs are exactly one-line adapter-conversion calls (`ProposalRestApiConfig.toRestApiConfigPayload(...)`), confirmed by direct diff read — not a deeper behavioral change. `RestApiConfigPayload`, `CreateSourceRequest`, `SourceService`, `DataSourceConfigCodec` are untouched (confirmed via `git diff --stat`).
- No scope creep: `files-modified.md`'s file list matches `git show b9f3727e --stat` exactly (39 files, all either new-and-scoped or one-line adapter edits with documented rationale).
- No regressions to existing behavior: `PipelineService`'s inline `auth.isDefined` runtime guard was removed but is now structurally impossible (the new `ProposalRestApiConfig` type has no `auth` field) — behavior-preserving, confirmed by reading the diff and the new type definition.
- API contracts: `PipelineProposalProtocol.scala` schema change (`restConfig: Option[RestApiConfigPayload]` → `Option[ProposalRestApiConfig]`) is proposal-only, does not touch the persisted/applied `RestApiConfigPayload` contract; `check:schemas` gate passed clean.
- Planning artifacts (design.md, tasks.md) reflect the final implementation; tasks.md all marked `[x]` matching the diff.

### Phase 2: Code Review — PASS
Issues: none.

Gates run fresh, independently, in `WORKTREE_PATH` (not `CLEAN_WORKTREE`, `slow` speed not indicated):
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run format:check` — clean, "All matched files use Prettier code style!".
- `npm test` — 265 suites / 2894 tests passed (matches executor's report exactly).
- `npm run build` — succeeds (no new warnings beyond pre-existing chunk-size notices).
- `cd backend && sbt test` — 3621/3621 passed (matches executor's report exactly; no environmentally-failing specs observed, `CONNECTOR_MASTER_KEY` evidently set in this worktree's `.env`).
- `npm run check:schemas`, `npm run check:openspec`, `npm run check:scala-quality` — all clean (143 pre-existing soft line-count warnings, none in files touched by this change).

Mechanical-enforcement independent re-verification (not trusting the executor's own transcript):
- Ran `node scripts/check-no-credential-in-agent-surface.mjs` standalone: `OK (12 files scanned, 0 violations)`.
- Independently attempted my own demonstrated-red violation (not reusing the executor's exact fixture): appended `import type { ConnectorCredentialFieldValue } from "../connectors/ui/ConnectorCredentialField";` to `frontend/src/features/assistant/proposalExtraction.ts` and re-ran the script — it correctly failed, naming the exact 5-file import chain (`proposalExtraction.ts` → `ActiveConversationPanel.tsx` → `ChatPage.tsx`/`QuickLauncherOverlay.tsx`/`ProposalHandoff.tsx`). Reverted; `git status` confirmed clean afterward.
- Confirmed `.husky/pre-commit` genuinely contains `npm run check:no-credential-leak` as its own line, sibling to `check:scala-quality`, not folded into `lint` — read directly.
- Confirmed `ConnectorSummaryCredentialAbsenceSpec` pins a meaningful invariant, not a vacuous one: it asserts the exact `{id, name, kind, host}` field set via `jsonFormat4(ConnectorSummary.apply)` — a fifth field added to `ConnectorSummary` without a matching update to this spec would fail it. Independently cross-checked the formatter definition at `ConnectorEntityProtocol.scala:98` matches the 4-field claim.
- `CredentialSurfaceEnumerationSpec`/backend enumeration test: passed in the full suite; matches tasks.md 3.5's corrected seven-file `helio-mcp/src` allowlist per the diff.

Design-standard/code-quality review (`InlineConnectorSetup.tsx`, `unresolvedConnectorRefs.ts`, review-page wiring):
- No inline FQNs, imports are qualified per `CONTRIBUTING.md`'s `no-inline-fqns` convention.
- Reuses `ConnectorCredentialField` verbatim (no duplicate credential input built) — satisfies the ticket's explicit reuse directive.
- `InlineConnectorSetup.css` uses `--app-*`/`--space-*`/`--text-*` tokens (spot-checked, no hardcoded hex/px magic values found in the diff).
- Detection helper is pure, unit-tested, degrades gracefully on malformed input (never throws) — confirmed by reading `unresolvedConnectorRefs.ts` and its test file.
- The `PipelineService.scala` `auth.isDefined` guard removal is a genuine, intentional, behavior-preserving simplification (type now makes the invalid state unrepresentable), documented inline with a clear comment — not a silent behavior change.
- No dead code, no leftover TODO/FIXME introduced.
- No over-engineering: the mechanical-enforcement script is a straightforward, single-purpose import-graph + regex walk, consistent with the existing `check-scala-quality.mjs` house style it explicitly mirrors.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers were already healthy for this worktree/ports (`start-servers.sh` reported "already healthy, reusing" for both frontend and backend); `assert-phase.sh servers` returned `PASS`. Given the servers were freshly built from this commit (confirmed via a full `npm run build` succeeding against the same tree moments earlier, and via live behavior matching the diff's logic exactly — e.g. the `newConnector`/`connectorId`/`url` exactly-one-of behavior), there is no HEL-742-style stale-bundle risk here; this was not a leftover server from an unrelated commit.

Live verification (Playwright), pipeline-proposal-review route, real backend `POST /api/connectors` call with fake test credential `test-fake-key-do-not-use`:
- Happy path end-to-end: injected a `PipelineProposal` with a `rest_api` source's `newConnector` draft via router state → `InlineConnectorSetup` rendered inline with retrieval instructions + the "Agents never see this key — it is enforced in code…" statement → filled the credential field → submitted → `POST /api/connectors` returned `201` → the setup section disappeared entirely (no reveal) → the proposal's source display updated in place to show the resolved `connectorId` → "Accept & create" transitioned from disabled to enabled.
- Network-request audit: of all in-session requests, the credential-carrying `POST /api/connectors` was the only request around submission; no other request (dashboards, auth/me, connectors GET) carried the credential value.
- No console errors during the tested flow (`browser_console_messages` level=error returned 0).
- No blank screens/unhandled exceptions on any step, including a genuinely malformed proposal path exercise via the detection helper's degrade-gracefully behavior (verified via its unit tests, not live, since a malformed live fixture wasn't separately re-driven).
- Breakpoints 1440/1100/768/430 all render the review dialog + inline setup form without layout breakage or overflow, at both a form-open state and a resolved state (screenshots captured to scratchpad only, never repo root — one accidental repo-root write during this review was caught and moved to scratchpad immediately, `git status` confirmed clean before proceeding).
- Interactive elements have accessible names (`textbox "Name"`, `textbox "Base URL"`, `textbox "API key value"`, `combobox "Authentication type"`, `button "Create connector"`) per the accessibility snapshot.

### Overall: PASS

### Non-blocking Suggestions
- None beyond pre-existing repo-wide soft line-count warnings (unrelated to this change).
