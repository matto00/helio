## Standing Constraints

- [C1] Reproduction-of-record is the deterministic P1 probe (red on unfixed code, green with fix); the P2 contention rate is reported honestly even if 0/N, never presented as the repro.
- [C2] The P1 probe delays only the GET /steps issued AFTER the step POST (flag set when the POST is seen); the initial page-load GET /steps is never delayed.

## 1. Probe (root cause before fix)

- [x] 1.1 Start servers on DEV_PORT 6726 / BACKEND_PORT 9633 via scripts/concertino/start-servers.sh; own headless context
- [x] 1.2 P1: write uncommitted e2e/hel1294-probe.spec.ts (hel958 + delayed post-create GET /steps); run red on unfixed code; record trace/aria-expanded
- [x] 1.3 P1 control (no delay) passes; if P1 does not reproduce, STOP and return evidence
- [x] 1.4 P2 before: hel958 (+ shard-4 co-tenant guard specs) --repeat-each=30 --workers=2 under ≤3 nice'd load PIDs; record rate
- [x] 1.5 Read HEL-1288 branch playwright.config.ts / ci.yml (read-only, git show); note sharding to emulate

### Frontend

- [x] 2.1 usePipelineDetailPage: creatingStepIds set via functional setState; enter before create, exit in finally (also when resync rejects) in handleInsertStep and handleAddLaneStep
- [x] 2.2 Thread isCreating (boolean) to every <StepCard render site (grep-enumerated)
- [x] 2.3 StepCard: expand toggle disabled while isCreating; add a DESIGN.md-conformant :disabled style (none exists today) and an accessible reason (title/aria-describedby), no new tokens

### Tests

- [x] 3.1 RTL: toggle disabled + no editor while resync deferred (red without fix — record reverted run)
- [x] 3.2 RTL: after resync, toggle enabled, editor opens, edit PATCHes real id
- [x] 3.3 RTL: failed create re-enables toggle; AI draft stays expandable; lane-add path disables toggle while in flight (page- or hook-level test, explicit assertion)
- [x] 3.4 Full gates: npm run lint, typecheck, format:check, npm test (frontend)
- [x] 3.5 P1 green with fix; P2 after: same load, --repeat-each=30, 0 failures (N≥20 consecutive) recorded
- [x] 3.6 Pipeline e2e specs touching step add/expand pass (--workers=2, nice -n 19)
- [x] 3.7 Delete probe spec by exact path; kill load PIDs by exact PID; no committed probe artifacts
