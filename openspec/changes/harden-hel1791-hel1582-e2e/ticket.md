# HEL-1830: e2e hardening after HEL-1826: per-test owners in hel1791 theme tests; row-count wait before hel1582's in-sheet tap

## Description

origin_kind: followup
origin_ticket: HEL-1826 (PR matto00/helio#1240, merged as 943b5dd73). The owner chose one ticket for both items.

1. `e2e/hel1791-compact-counter-stack-height.spec.ts`. The owner theme geometry tests share one owner, and they end the run with only 20-25 of the 120 per-60 s API requests left. HEL-1826 found that this shared budget caused the `:290` flake: a 429, so the status region stayed empty. Give each owner theme test its own user, the way HEL-1826 did for `:290`.
2. `e2e/hel1582-mobile-pipeline-motion-and-states.spec.ts`. Tap (b), inside the open step sheet, may have the same stale-tap risk HEL-1826 fixed for tap (a). The "N fields" trigger reflows when `.step-preview__count` arrives. Add the same bounded, messaged row-count wait before that tap.

## Acceptance criteria

- [ ] Item 1: each owner test's request count is logged, and the highest is well under the limit.
- [ ] Item 2: a deterministic stale-tap probe shows the wait matters, the way HEL-1826's did.
- [ ] Both spec files pass 20 times in a row (2 workers, `nice -n 19`).
- [ ] Fold-in (owner answer to the follow-up triage, 2026-11-24): each hel1791 editor theme test runs as its own editor principal (granted editor on the beforeAll board); each logs its REQUEST-COUNT, and the highest editor max-60s is at most 60 at 1x and at CPU 4x.

## Driver notes (claims to verify, not facts)

- E2E-only expected; no product code, no migration.
- If the probe shows tap (b) has no stale-tap risk, say so with the evidence instead of adding an unneeded wait.
- Reuse HEL-1826's measurement/probe method: `openspec/changes/archive/2026-11-22-deflake-hel1820-e2e-specs/` and `.concertino/runs/HEL-1826/evidence/` (main checkout).
