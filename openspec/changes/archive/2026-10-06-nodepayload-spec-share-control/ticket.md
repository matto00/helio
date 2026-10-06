# HEL-1334: NodePayloadWiringSpec: use TokenHashing.sha256Hex; assert share token 200 on public /history

## Description

origin_kind: followup
origin_ticket: HEL-1276

`NodePayloadWiringSpec` (HEL-1276) computes SHA-256 by hand instead of calling `TokenHashing.sha256Hex`. It also doesn't
check that the same share token that gets a 401 on the public payload path gets a 200 on public `/history`. Without that
check, the 401 could just mean the token itself is broken.

## Acceptance Criteria

- Switch the spec to the shared helper (`com.helio.infrastructure.crypto.TokenHashing.sha256Hex`).
- Add the positive-control assertion (the same share token gets `200` on public
  `GET /api/dashboards/:dashboardId/panels/:panelId/history?token=`), and show it failing under a mutation that breaks
  the token (e.g. a wrong stored hash). Record both the red and the green.

## Driver constraints

- Test-only. If the positive control fails on unmodified main code, that is a product bug: escalate, do not "fix" the
  test around it.
- Do not touch `.github/workflows/ci.yml`, `frontend/playwright.config.ts`, `.gitignore`.
- Backend gate: `nice -n 19 sbt testFull` (Bash timeout 600000, at most 2 workers); `sbt --client shutdown` as its
  own Bash call. EmbeddedPostgres. Never `pkill`/`pgrep`/`killall`; stop only self-recorded PIDs.
