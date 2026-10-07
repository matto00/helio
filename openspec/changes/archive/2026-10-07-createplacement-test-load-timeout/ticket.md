# HEL-1353: Flake: PipelineDetailPage.createPlacement.test.tsx hits jest 5s timeout under load

## Description

origin_kind: followup
origin_ticket: HEL-1277

HEL-1277's evaluator saw HEL-1345's `PipelineDetailPage.createPlacement.test.tsx` hit jest's default 5 s timeout, but only while sbt was running in parallel.

Evidence (persisted in the main checkout): `.concertino/runs/HEL-1277/evidence/screenshots/eval-3/jest-frontend-FAILED-under-sbt-load.log` -- both rows of the `it.each` case "an immediate insert at gap %i ..." (case (b)) failed with "Exceeded timeout of 5000 ms"; the file took 34.6 s; the log also carries 12 `console.error Error: AggregateError` from jsdom XMLHttpRequest socket errors (real network requests escaping the mocks).

## Acceptance Criteria

* Find the root cause with a probe, in particular whether a fixed wait or an unresolved promise is involved.
* Fix it properly. Raising the timeout is acceptable only if the test is legitimately long, and the reason must be stated.
* Show 20 or more green runs under `nice`, with background load.
* Note PanelCard.test.tsx (HEL-1215) as a sibling under-load flake, for context.

## Driver constraints (binding for this run)

* Root-cause classification must name which of: fixed wait, unresolved promise, fake-timer interplay, genuinely long work (or another cause the probe establishes).
* 20+ green runs under `nice` with background load: at most 3 niced CPU burners, started and killed by recorded PID only (never pkill/pgrep/killall).
* PanelCard.test.tsx (HEL-1215): note any shared cause; do not fix it here. If it is the SAME root cause, escalate to the driver before touching it.
* HEL-1354 (pipeline-detail page boot cost) is in flight on the same page: do not change `usePipelineDetailPage` behaviour. Test-side fix, or a minimal product fix only if the probe proves one; any file HEL-1354 is likely to touch requires driver sign-off first.
* Do not touch `ci.yml`, `playwright.config.ts`, `.gitignore`. At most one CI run at a time.
* Never write under `~` (project-local npm cache); never bypass hooks; keep full logs of any failing run.
