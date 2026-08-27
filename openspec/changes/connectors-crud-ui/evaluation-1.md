## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket acceptance criteria addressed: create/list/edit/delete UI; credential shown once,
  never re-displayed (list, edit form, rotation flow all verified — masked placeholder + "Replace
  credential" only); credential rotation via dedicated `PUT /api/connectors/:id/credential`,
  demonstrated end-to-end live (see Phase 3); dependent sources visible proactively on every row
  (not just on blocked delete) and the 409 surfaces a clear explanation referencing the same
  count; connection-test reused from `TestConnectionAffordance`, offered only for saved
  Connectors; page covered by the HEL-813 touch-target sweep (surface 7) — though the test itself
  currently fails, see Phase 2/3; shared primitives (`EmptyState`, `FormField`, `TextField`,
  `Select`, `Modal`, `ConfirmInline`, `StatusChip`) used throughout, DESIGN.md tokens verified.
- No AC silently reinterpreted. Rotation scope-widening (design.md Decision 1) was escalated to
  the human per the design doc and resolved before implementation — properly recorded, not a
  unilateral reinterpretation.
- All `tasks.md` items marked done match what was implemented, with one caveat: 6.3 (manual
  smoke) is honestly left unchecked, and 5.1's underlying e2e test was added but not run live by
  the executor — both correctly flagged in `files-modified.md` rather than falsely claimed done.
- No scope creep: `dataSourceService.ts`/`TestConnectionAffordance.tsx` touches are the minimal,
  ticket-required changes (task 4.8/4.9), not unrelated refactors.
- No regressions found to existing behavior (full frontend Jest suite green; backend failures are
  pre-existing and unrelated — see Phase 2).
- API contract: schemas/openspec specs (`connectors-page-ui`, `connectors/connector-management`)
  present and match the shipped protocol (`dependentCount`, `RotateConnectorCredentialRequest`).
- Planning artifacts (design.md, tasks.md) reflect the final implemented behavior.

### Phase 2: Code Review — FAIL

Gates run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` for this cycle):

- `npm run lint` — PASS (zero warnings).
- `npm run format:check` — PASS.
- `npm test` — PASS (262 suites / 2865 tests, frontend).
- `npm --prefix frontend run build` — PASS (pre-existing >500kB chunk warning only, not new).
- `sbt test` — 3549 succeeded / 13 failed. Independently re-verified all 13 failures trace to the
  identical `ConnectorCredentialEncryptionFailed: ... NoKeyConfigured` root cause (missing
  `CONNECTOR_MASTER_KEY` in this fresh worktree's `.env`) across `SourceServiceSpec` (4, thrown
  exception), `ApiRoutesSpec`/`DataSourceRoutesSpec`/`PipelineApplyProposalRollbackSpec` (7, same
  cause surfacing as HTTP 500 instead of 201/422 at the route layer), and
  `AuditMutationInstrumentationSpec` (2, thrown exception). Confirmed by temporarily setting
  `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` in the worktree's `.env` and re-running the
  UI live (see Phase 3) — the rest of the app, including this ticket's new credential-write paths,
  works correctly once the key is configured. This matches the executor's claim exactly:
  environmental, pre-existing, not masking a new defect. `.env` reverted after verification.
- The new rotation integration test (`ConnectorRepositorySpec`, "a dependent rest_api source
  resolves the NEW plaintext ... after rotation") is a genuine, non-tautological test: it inserts
  a real `RestSource` referencing the Connector via `dsRepo.insert`, rotates the credential, then
  asserts the pipeline-execution resolution path (`findByIdInternal` → `decryptForUse`) returns
  the NEW plaintext. This is real evidence, not a same-spec twin.
- DESIGN.md tokens: verified clean in `ConnectorsPage.css` — no ad-hoc colors, `--app-*`/`--space-
  *`/`--text-*` tokens throughout; the two literal `44px` values are explicitly annotated as the
  documented a11y tap-target floor exception (matches `PanelDetailModal.mobile.css`/`Modal.css`
  convention), not an unexplained magic number.
- Credential handling: verified in code and live — `EditConnectorModal.tsx` renders only a
  `••••••••` mask + "Replace credential", never the real/empty value; `RotateCredentialModal.tsx`
  fixes the auth type (disabled textbox) and only accepts a new credential value, with explicit
  irreversibility copy; `CreateConnectorModal.tsx` has no test-connection action, matching
  Decision 3b.
- **Blocking defect: the newly-added HEL-813 touch-target sweep test
  (`e2e/hel813-mobile-touch-target-floor.spec.ts`, "surface 7: Connectors page") fails at both
  430px and 768px**, exactly as the executor warned it hadn't been run live. See Phase 3 for the
  root cause and reproduction. This is a real, deterministic failure (not flaky) in delivered
  code claimed as task 5.1 "done" in `tasks.md`.

### Phase 3: UI Review — FAIL

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` — both healthy.

- **Happy path (create → list → edit → rotate → test-connection → delete-blocked) — all verified
  live and correct:**
  - Create (no-auth): succeeds, new row shows "0 sources" (dependent count correct/proactive from
    creation).
  - Create (api_key): auth-type dropdown correctly reveals parameter-name/placement/value fields;
    with `CONNECTOR_MASTER_KEY` unset the create correctly surfaced an inline "Internal server
    error" in the still-open modal (form state preserved, no blank screen, no unhandled
    exception) — this is the *correct*, gracefully-handled unhappy path given the environmental
    key gap, not a defect.
  - Edit: shows masked `••••••••` + "Replace credential" for an auth'd Connector; no reveal
    anywhere.
  - Rotate (bearer): `PUT /api/connectors/:id/credential` fired and returned 200 (confirmed via
    network log), no console errors, modal returned to the masked-placeholder edit state on
    success — matches design.md Decision 1/task 4.6 exactly.
  - Delete-blocked: clicking Delete on a Connector with 1 dependent immediately surfaces
    "Referenced by 1 source — delete anyway?" in the inline confirm (proactive, not gated behind
    the attempt); confirming the delete returns 409, and the row then shows "ConnectorHasDependents:
    this Connector is still referenced by a dependent resource" — a clear explanation, not an
    opaque failure. Matches design.md Decision 1b / task 4.7.
  - Connection-test: fires `POST /api/sources/test`, returns 200, confirmed only offered on
    already-saved rows (never in the create form).
  - Implicit Connectors: all 5 pre-existing migrated/synthesized Connectors render with the
    "Auto-created" `StatusChip` badge, same row shape/affordances as user-created ones — matches
    design.md Decision 2.
- No console errors during any of the above except the two *expected* failed-request log lines
  (the pre-`CONNECTOR_MASTER_KEY` 500 during the first create attempt, and the deliberate 409 from
  the delete-blocked test) — both are correctly surfaced to the user, not unhandled.
- **Blocking defect — HEL-813 touch-target sweep (surface 7) fails, confirmed live, both
  breakpoints:**
  - `npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts -g "surface 7"` → 2 failed
    (430px and 768px), both with the identical measurement: rendered height `43.34002685546875`
    against a required floor of `44`.
  - Root-caused: the failure is in the create-modal's footer buttons (`.connectors-page__btn`,
    `Cancel`/`Create connector`), measured immediately after `expect(createDialog).toBeVisible()`
    with no intervening action. `shared/ui/Modal.css`'s entrance animation
    (`animation: ui-modal-in var(--transition-slow) backwards`) applies
    `transform: translateY(6px) scale(0.985)` at its start keyframe — `44 * 0.985 = 43.34`,
    exactly the failing value. The sibling dialog-based surfaces (surface 5, `ui-select` options)
    that already pass all perform at least one additional action (e.g. clicking the select
    trigger and waiting for the option list) between the dialog becoming visible and the
    `sweepSurface` call, which incidentally lets the animation settle first. Surface 7's first
    `sweepSurface` call runs directly after `toBeVisible()` with no such buffer, catching the
    dialog mid-entrance-animation. Confirmed as a real, deterministic geometry measurement (not a
    flake) by re-running the same test twice with identical results, and by manually measuring
    the same buttons after the animation had settled (44px exactly, both breakpoints) — so this is
    specifically a missing settle-wait in the new test, not evidence that the buttons genuinely
    render under the 44px floor in normal use.
  - This is exactly the gap the executor flagged as a risk in `files-modified.md`
    ("recommend running once dev servers are up before merge") — running it live surfaced a real,
    fixable defect.
- Breakpoints 1440/1100/768/0: not fully swept visually (skeptic's domain per role split), but the
  touch-target check specifically requested at 430/768 was run and is the one that failed.
- Accessible names / keyboard support: all interactive elements (list-row buttons, form fields,
  Select combobox, modal Cancel/Confirm) carry accessible names via the snapshot tree; not
  exhaustively keyboard-tested this cycle given the blocking defect above already requires a
  return trip.

### Overall: FAIL

### Change Requests

1. Fix `e2e/hel813-mobile-touch-target-floor.spec.ts`'s "surface 7: Connectors page" test
   (`e2e/hel813-mobile-touch-target-floor.spec.ts:250`) so its first `sweepSurface` call on the
   create-modal's `.connectors-page__btn` controls does not race the `Modal.css` entrance
   animation's `scale(0.985)` start-state. Either add a settle wait before the first sweep
   (mirroring the extra action other dialog-based surfaces already perform before sweeping — e.g.
   surface 5's pattern at line ~200-204), or explicitly wait for the animation to finish
   (`page.waitForTimeout` tied to `--transition-slow`, or an animation-end signal) before
   asserting geometry. Re-run
   `DEV_PORT=<port> BACKEND_PORT=<port> npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts -g "surface 7"`
   and confirm both 430px and 768px pass before resubmitting.

### Non-blocking Suggestions

- None beyond the one blocking item above — the rest of the implementation (credential UX,
  rotation, dependent-count/delete UX, implicit badging, connection-test scoping, DESIGN.md
  compliance) is solid and verified live.
