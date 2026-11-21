## Context

See proposal.md (Why). The guard (`e2e/support/state-surface-contrast-guard.ts`) reads each control's backdrop at REST by walking ancestors to the first opaque `rgb()` background (`readBackdrop`), then forces hover and compares. On `/connectors` the row, the cells and (at 1440, non-overflowing) the sticky actions cell are transparent, so the resolved backdrop is the `--app-bg` canvas. While the table overflows (narrow widths) the sticky actions cell paints `--app-bg` itself, so the backdrop is still `--app-bg`. DESIGN.md Appendix A.2's state-rung table says: on `--app-bg`, `--app-surface-raised` clears the floor (1.187 dark / 1.119 light) and `--app-surface-soft` does not (about 1.03-1.06). All three controls currently hover to `--app-surface-soft`, which matches the reported ~1.05. HEL-1649 already applied exactly this mapping to `.dashboard-chip` (Secondary recipe, `--app-bg` rung → raised).

Below `TEST_CONNECTION_MENU_BREAKPOINT_PX` the standalone "Test connection" button is not mounted (it becomes a menu item in the ActionsMenu popover, a different backdrop family the guard already covers). The executor SHALL record which of the three controls is mounted at each covered width; a width where the button is not mounted is not a coverage gap, and the evidence says so.

## Goals / Non-Goals

**Goals:** seed a connector in every guard cell that measures `/connectors`; red first for all three controls; fix with §5 recipes; measure added CI time.

**Non-Goals:** no change to any shared primitive (`ActionsMenu.css`, `IconButton`), other tables, the 1440 readiness wait / width selection (HEL-1806), shard weights (only from CI artifacts, e2e/README.md), backend, or migration. No new token (A.2's `--app-state-hover` token idea needs owner sign-off).

## Decisions

### D1. Seed via `POST /api/connectors`, offline by construction

Body: `kind: "rest_api"`, a fixed name constant (e.g. `CONNECTOR_NAME`), `baseUrl` under the reserved `.invalid` TLD (RFC 6761, never resolves), `credential: ""`, `config: { authType: "none" }` (the service allows an empty credential only for `authType: "none"`). The create path still writes a `connector_credentials` row and encrypts even `""` (`ConnectorRepository.create` → `ConnectorCredentialRepository.create` → `secretBackend.encrypt`), so the backend MUST have a master key configured. CI's `e2e` and `e2e-prod-build` jobs set a fixed test-only `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` in `.github/workflows/ci.yml`, and existing rest_api-creating specs already depend on it. Locally: if the seed POST fails on encryption (`NoKeyConfigured`), the executor MAY export ci.yml's fixed test-only values for the lane backend only; if it still fails, that is an environmental BLOCKER to report. Never read, print or copy any `.env` to diagnose it (C1). `ConnectorEntityService.create`'s `checkCreateTimeEgress` does not refuse an unresolvable host. The executor SHALL read `checkCreateTimeEgress` and confirm it does at most a DNS lookup and no HTTP/TCP connection; if create performs any outbound connection, stop and escalate (driver constraint). No connection test is ever clicked by the guard (hover only).

Alternative rejected: seeding in every cell (`newCell` unconditionally). It would change sampled counts in views that never render connectors (or render them in the rail/palette) for no coverage gain. Seed is opt-in, keyed on the cell's route being `/connectors` (mirrors `seedHomeActivity: routeKey === "/home"`), in both the 1440 route cells and the narrow helper's cells. The overlays-chrome spec needs no seed: it visits `/connectors` only to replay recents and never probes it (verified at design gate). The connectors section is `pickerId: "other"` and excluded from `resourceNavigation`, so no rail/palette view gains elements.

### D2. Readiness wait and a mechanical coverage assertion

The `/connectors` cell waits for the seeded connector's name visible in `<main>` (same `seeded(...)` helper pattern) before stamping, replacing the generic `main` visible branch for that route. A count of sampled controls is logged per view already; the evidence records before/after counts for every affected cell (the change is deliberate).

The 1440 route cells sample evenly once a view exceeds `MAX_ELEMENTS_PER_VIEW = 24` and have no `fullySampled` check, so a later header control could sample the connector controls out while the partition check still passes. Every `/connectors` cell (1440 and narrow) SHALL therefore assert that the seeded row's doc id, its actions trigger's doc id, and the "Test connection" button's doc id (where mounted) are in the covered (sampled) set, following the HEL-1649 refresh-button precedent (`state-surface-contrast-guard-narrow.ts`, the refresh-button assertion), and log the result per cell. A missing one fails the cell loudly.

### D3. Fixes, scoped to `ConnectorsPage.css`

Each in `@media (hover: hover)`, choosing the `--app-bg` rung of A.2:

- **Row** (`.connectors-page__row:hover`, a list-row Ghost-style fill): `--app-surface-soft` → `--app-surface-raised`. The matching sticky-cell override (`.connectors-page__scroll--left/--right .connectors-page__row:hover .connectors-page__td--actions`) moves with it, so the row reads as one band while overflowing. The conflict row (`.connectors-page__conflict-row`, shares `__row`) keeps whatever the executor finds correct; it must not regress.
- **"Test connection"** (Secondary recipe), scoped to the row context only: `.connectors-page__row-actions .connectors-page__btn--secondary:hover:not(:disabled)` → `--app-border-strong` + `--app-surface-raised` + full `--app-text` (the §5 Secondary recipe includes "full text", which this button currently lacks). The class `.connectors-page__btn--secondary` is also "Replace credential" in `EditConnectorModal`, which renders in-tree inside `.connectors-page` on the modal's `--app-surface-strong`; in light theme raised and strong are both `#ffffff`, so an unscoped change would drop that hover to 1.00 (A.2's cycle-1 regression). Modal-hosted `.connectors-page__btn` / `--secondary` hovers keep `--app-surface-soft`, unchanged. Primary (`--primary`) hover is unchanged.
- **Actions trigger** (shared `popover__trigger actions-menu__trigger`): resting recipe per `Popover.css` is `--app-border-subtle` hairline, transparent, `--app-text`; hover `--app-border-strong` + `--app-surface-soft`. That is the §5 Secondary hairline icon recipe (IconButton `secondary`); it maps, so no escalation. Page override, scoped to the row context: `.connectors-page__row-actions .actions-menu__trigger:hover:not(:disabled)` → `--app-border-strong` + `--app-surface-raised` (text already rests at full `--app-text`). If the executor finds the live rest/hover differs from this reading, stop and report rather than inventing a recipe.

Alternative rejected: changing the shared `ActionsMenu`/button recipes globally; other call sites sit on other backdrop families (modal, `--app-surface`) where raised would be wrong (A.2's cycle-1 regression).

### D4. Red first, with mutations (C12)

1. Seed-only commit: guard full spec files (routes-light, narrow-1100-768, narrow-390; overlays-chrome needs no seed, per D1) red on current CSS, naming all three controls (button only at widths where mounted), both themes. Log committed under the change's `evidence/` before any CSS change.
2. Green after the fix in both themes, with `HEL_GUARD_LOG_RATIOS=1` ratio dump.
3. Mutation: revert each of the three hover rules one at a time and show the guard goes red for that control (proves each rule is load-bearing, not masked).
4. Full spec files run, not grep-filtered tests.
5. Edit modal check: after the fix, open the Edit modal for a bearer/api_key connector (so `canRotate` is true and "Replace credential" renders) and confirm by probe or visual check, both themes, that its hover is unchanged (`--app-surface-soft`, measurably visible on `--app-surface-strong`). A bearer/api_key seed for this check is a manual/probe step, not a guard change, and still makes no outbound call.

### D5. CI time

Measure the affected spec files' wall time before (main) and after on this machine (Playwright 2 workers), and state the delta per file and the expected CI delta in `ci-impact.md` (HEL-1649 precedent). Shard weights are NOT regenerated by hand.

## Risks / Trade-offs

- [A hovered control inside a hovered row: both paint `--app-surface-raised`, so the button/trigger fill matches the row band] → the Secondary hairline turns `--app-border-strong` on hover, which still outlines the hovered control; the guard measures against the at-rest backdrop by design. The evaluator/skeptic check this visually in the running app in both themes; if it reads as invisible, escalate rather than inventing a new rung.
- [Seeding changes sampled counts and could trip the "no control left unsampled" partition check] → counts recorded and asserted deliberately; `MAX_ELEMENTS_PER_VIEW` is checked against the new totals.
- [Shared lane dev DB / backend] → lane-private DB `helio_hel1805`, `ANTHROPIC_API_KEY` exported empty.
- [`.invalid` DNS lookup] → a resolver query for a reserved TLD is not a call to an external data source; any HTTP/TCP egress at create time is an escalation.
