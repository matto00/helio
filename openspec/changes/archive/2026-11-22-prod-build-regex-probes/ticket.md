# HEL-1816: Run the HEL-1683/HEL-1697 main-thread timing probes against a production frontend build, not the Vite dev build

## Description

origin_kind: followup
origin_ticket: HEL-1808 (PR matto00/helio#1215, merged as 6c438a640). The owner chose to file this.

Two e2e tests check that no main-thread task exceeds 100 ms:

* `e2e/hel1683-regex-main-thread.spec.ts`;
* HEL-1697's long-cell regex probe.

Both run against the Vite dev build, as all e2e tests do. HEL-1808 found that the measured long tasks are mostly React dev-mode rendering inside the Pattern input handler, not the regex work the tests are meant to guard. The safety margin therefore depends on dev-mode overhead users never pay. The tests can go red on a slow CI host without any regex regression.

## Do

* Find a way to run just these performance probes against a production build (`npm run build` served by preview), without moving the rest of the e2e suite. For example: a separate Playwright project or config with its own web server, gated to these spec files.
* Measure the probes' task times on the production build. Keep the 100 ms limit. Re-run each probe's mutation (decline disabled), which must still fail.
* Keep the CI cost small and state it. Shard weights are regenerated only from CI artifacts, per `e2e/README.md`.

## Acceptance criteria

- [ ] The probes run against a production build in CI, and the PR states the measured margin.
- [ ] Each probe still fails under its mutation.
- [ ] The rest of the e2e suite is unchanged.

## Premise validation (orchestrator, 2026-11-22)

Verdict minor-staleness. The spec file now holds three probes (HEL-1683, HEL-1697 long-cell, HEL-1807 start-anchored, bc861cf3c). The "separate project/config with its own web server" the ticket suggests already exists: HEL-1691 (0f194882f) built the `@prod-build` tag, the `prod-build-guard`/`prod-build` projects selected by `HELIO_E2E_PROD_BUILD=1`, the dedicated required CI job `e2e-prod-build` (production build + `vite preview`), and `npm run e2e:prod-build` for lanes (HEL-1699). Scope is therefore: opt these probes in to that lane. Evidence: `.concertino/runs/HEL-1816/evidence/premise-validation.md` in the main checkout.
