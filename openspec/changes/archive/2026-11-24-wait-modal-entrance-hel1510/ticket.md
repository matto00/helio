# HEL-1621: e2e hel1510 card-overflow check races the modal entrance animation (up to 0.69px shift for ~100ms)

## Description

origin_kind: followup
origin_ticket: HEL-1613

HEL-1613 refuted font-swap as the cause of hel1510's occasional 0.1px card-overflow failure: holding and releasing
fonts in every order never reproduced it. What it did measure is the modal's entrance animation moving the card edge by
up to 0.69px for about 100ms, even with fallback fonts only. That is the likely cause, but it has not been reproduced
as a failure.

**Fix:** reproduce red first (for example, measure mid-animation by holding the animation, or with
`animation-play-state`). Then make the spec wait for the modal's entrance to finish (an animationend/transitionend or
settled-geometry wait) before measuring. No added tolerance and no retries.

## Acceptance Criteria

- Red under a forced mid-animation measurement, green after (mutation: remove the wait -> red again under the force).
- 20/20 normal runs green (the spec file, 2 workers, nice -n 19).
- No added tolerance, no retries, no timeout changes. E2E only; no product code, no migration.
- If the forced mid-animation measurement does NOT go red, the premise is wrong: report with evidence and escalate
  rather than adding a wait.
