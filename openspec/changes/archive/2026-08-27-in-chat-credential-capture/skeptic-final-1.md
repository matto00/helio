## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Ticket: HEL-829 · Commit: b9f3727e · All checks re-derived from ground truth (files, diff,
running app). The executor's and evaluator's reports were read as claims only.

### What I verified (with evidence)

**1. Scope / "untouched files" claim — CONFIRMED**
`git show b9f3727e --stat` = 39 files. I ran a per-file `git diff b9f3727e~1 b9f3727e --` on each
claimed-untouched file and got empty output for all of them:
`api/protocols/sources/DataSourceProtocol.scala` (which is where `RestApiConfigPayload` and
`CreateSourceRequest` are actually defined — lines 142/174), `api/protocols/sources/
DataSourceConfigCodec.scala`, `services/sources/SourceService.scala`, `domain/model/model.scala`.
`git log -1 --` on the two codec/service files still points at `f73cee3a` (HEL-826), i.e. this
commit did not touch them. Nothing outside design.md's authorized set is in the diff.

**2. Backend contract — CONFIRMED, including the unresolved-apply failure mode**
`ProposalRestApiConfig`/`NewConnectorDraft` are new proposal-only types; `NewConnectorDraft` has
six fields (`name`, `baseUrl`, `authType`, `apiKeyName?`, `apiKeyPlacement?`,
`retrievalInstructions`) — structurally incapable of carrying a secret.
`ProposalRestApiConfig.toRestApiConfigPayload` never maps `newConnector`. I traced what happens if
a caller applies a still-unresolved proposal directly against the API (bypassing the UI's disabled
Accept): `validateRestConfig` passes (exactly one of three set), then `resolveRestSource` →
`RestApiConfigPayload.toDomain` hits `case (None, None) => Left("Missing required fields:
connectorId or url")` (DataSourceProtocol.scala:346). Fails closed — never a silently
unauthenticated source.
The model-facing tool-schema change (AssistantProposalToolSchemas.scala) adds only
`retrievalInstructions` prose guidance; no credential-capable field enters the model surface.

**3. Backend enumeration specs are non-vacuous — CONFIRMED by reading them**
`ConnectorSummaryCredentialAbsenceSpec` pins `{id,name,kind,host}` exactly and serializes a real
`WorkspaceContextResponse` whose `Connector.config` deliberately carries a fake marker string,
asserting the marker is absent from the JSON — that is a real invariant, not a tautology.
`CredentialSurfaceEnumerationSpec` walks the filesystem (fails on a NEW matching file), not a
hardcoded list.

**4. Full gate suite re-run fresh by me — ALL GREEN**
`npm run lint && typecheck && format:check && check:schemas && check:spec-structure &&
check:openspec && check:openspec:selftest && check:scala-quality && check:no-credential-leak &&
npm test` → exit 0; `Test Suites: 265 passed, Tests: 2894 passed`; scala-quality "clean (143 soft
warnings)"; `check-no-credential-in-agent-surface: OK (12 files scanned, 0 violations)`.
`sbt -batch test` in `backend/` → exit 0.

**5. Mechanical guard — I reproduced BOTH red arms myself, and found one real evasion**
Controls (my own fixtures, not the executor's):
- static `import { InlineConnectorSetup } from "../../connectors/ui/InlineConnectorSetup"` in an
  assistant-surface file → **FAIL, rc=1**, with the import chain printed. Genuinely red.
- `export interface T { credential: string }` in an assistant-surface file → **FAIL, rc=1**.
  Genuinely red.
Evasions I attempted that the executor's/evaluator's fixtures did not:
- **`await import("../../connectors/ui/InlineConnectorSetup")` → PASSES (rc=0).** Reproduced twice,
  and also for `ConnectorCredentialField`. See Change Request 1.
- A renamed carrier (`apiKey` / `secret` / `connectorCredential`) → passes; this one is explicitly
  disclosed in the script's own header ("exact-word match only"), so I treat it as a documented
  limit, not a defect (non-blocking note 1).

**6. Live drive of the real flow with my own fake credential — CONFIRMED**
Servers asserted healthy (`assert-phase.sh servers … → PASS servers`, dev 6261 / backend 9168).
I drove `/pipeline-proposals/review` with my own `newConnector` proposal, typed
`skeptic-fake-key-do-not-use-8ac41` into the credential field and submitted. My own measurements
(not captured screenshots):
- Network: exactly one non-GET call — `[POST] /api/connectors => 201`. The only other `/api` calls
  were `GET /api/auth/me`, `GET /api/dashboards`, `GET /api/connectors`.
- Post-submit page probe: credential absent from `localStorage`, `sessionStorage`,
  `window.history.state` (router state still carries only the credential-free `newConnector`
  draft), the entire serialized DOM, and every live input value. The setup section had unmounted
  (`.inline-connector-setup` gone) — so no re-display, satisfying the "never displayed again" AC.
- Server logs: `grep` for the fake key in `.concertino-backend.log` / `.concertino-frontend.log` →
  0 matches.
- `GET /api/connectors` response body carries no credential-capable field at all.
- Credential input is `type="password"`, `autocomplete="off"`, `spellcheck=false`.
- Flow completes: summary flipped `NEWCONNECTOR` → `CONNECTORID 6e74eed8-…`, and "Accept & create"
  went `disabled=true` → `disabled=false`. Before resolution it is genuinely disabled
  (`opacity 0.55`, `cursor: not-allowed`) — the review page also guards `handleAccept`.

**7. AC trace**
- inline form, no detour → §6 (rendered inside the review Modal, resolves in place). ✅
- provider-specific retrieval instructions → rendered verbatim from `draft.retrievalInstructions`. ✅
- demonstrated absence across every surface, both directions → §3 + §6. ✅
- mechanical + demonstrated red → §5 red pair reproduced by me; **but see CR-1**. ⚠️
- never displayed after submission → §6 (component unmounts; `type=password` while typing). ✅
- UI claim accurate → the copy says "submits directly to your workspace's encrypted credential
  store and is never part of the conversation" — verified true in §6.
- pipeline / dashboard / combined → pipeline + combined wired. I independently verified the
  dashboard arm is vacuous by construction: `DashboardProposal` is `{dashboardName, panels}` and
  `ProposalPanel` has no source/config/connector field (frontend/src/features/dashboards/types/
  proposal.ts:22-43). Correctly handled, not skipped. ✅

**8. DESIGN.md judgment — live at all four breakpoints, both themes — CONFIRMED**
Drove 1440 / 1100 / 768 / 430 live and toggled dark↔light, looking at each screenshot.
`InlineConnectorSetup.css` uses only `--space-*` / `--app-*` / `--text-*` / `--weight-*` /
`--control-md` tokens (all verified present in `frontend/src/theme/theme.css`); the sole literal
values are `1px` border and the sanctioned `44px` mobile tap floor (DESIGN.md §"Control metrics",
line 200). Measured live at 768px: Create button 44px, auth select trigger 44px — floor met;
text inputs are 32px (`--control-md`), which DESIGN.md's floor enumeration ("buttons, select
triggers/options, CTAs") does not cover and which matches every sibling `TextField`. Reuses shared
`FormField`/`TextField`/`InlineError`/`ConnectorCredentialField` — no reinvented one-offs; the
local `__btn` recipe mirrors `ConnectorsPage.css`'s own documented precedent. Light/dark parity is
clean, including the accent-tinted guarantee callout (`color-mix` over `--app-accent`). Typographic
hierarchy (eyebrow → name → instructions → callout → fields) is consistent with sibling screens.
0 console errors across the whole session.

### Verdict: REFUTE

Everything above confirms except one item. It is narrow and cheap, but it sits precisely on this
ticket's reason to exist: the file's own docstring states a capability the code does not have, and
the UI copy tells users the guarantee is "enforced in code."

### Change Requests

1. **`scripts/check-no-credential-in-agent-surface.mjs:71` — the import-graph walk misses
   dynamic imports, so its stated contract is false.** `extractRelativeImports`'s regex
   `/(?:from|import)\s+["']([^"']+)["']/g` requires whitespace after `import`, so
   `await import("../../connectors/ui/InlineConnectorSetup")` (and the same for
   `ConnectorCredentialField`) is never seen and the check exits 0. I reproduced this twice for
   each banned module; the static-import control is red, so this is a gap in the matcher, not a
   broken harness. `React.lazy`/`await import()` is the ordinary way a component gets pulled into a
   surface, so this is a realistic evasion, not a contrived one — and the script's header claims
   "fails if any assistant-surface module **transitively imports**" the banned modules.
   Fix: also match the call form (e.g. `/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g`, or a
   second `import\s*\(\s*["']…` pass), and add a fixture to the demonstrated-red evidence covering
   the dynamic-import shape so the regression is pinned.
   While there, please also state the *residual* limits explicitly in the header (renamed carriers
   such as `apiKey`/`secret` are not caught; non-relative specifiers are not walked) so the next
   reader does not over-trust the check.

### Non-blocking notes

1. The exact-word `credential` text scan is narrow by design and is honestly documented as such —
   I am not asking for it to be widened, only for the limit to stay documented (folded into CR-1).
2. `PipelineProposalSummary`'s generic config renderer dumps the whole `newConnector` object as an
   untruncated raw JSON blob in a `NEWCONNECTOR` row directly above the setup card that presents
   the same information properly (visible at every breakpoint). This is pre-existing generic
   behavior in a file this commit correctly did not touch (its own design deliberately rejects a
   per-kind switch), and the new nested field merely lands in it. Worth a polish spinoff, not a
   change here.
3. `PipelineProposalReviewPage` seeds `useState(initialProposal)` once, so a same-route
   re-navigation with a different `location.state.proposal` keeps the stale copy. I reproduced this
   with a same-route push; a real chat→review navigation remounts the page, so it is latent, not
   user-visible today. A `useEffect` resync (or a `key` on the route element) would close it.
4. Router state retains the original `newConnector` draft after resolution, so a browser reload of
   the review page re-renders the setup form and would let a user create a duplicate connector.
   Minor; the local patched copy is intentionally not written back to history.
5. Dev-DB artifact: my live drive created a connector "Stripe (skeptic)" in the shared dev
   database. UI delete needs a confirm step I did not complete, and `fetch DELETE` from the console
   returns 403 (CSRF guard — itself a good sign). It sits alongside several pre-existing eval/
   skeptic artifacts there; harmless, but worth sweeping.
6. Playwright wrote screenshots to the repo root again (known hazard); I moved all six into the
   session scratchpad, so the repo root is clean (`git status` shows only the untracked
   `evaluation-1.md`).
