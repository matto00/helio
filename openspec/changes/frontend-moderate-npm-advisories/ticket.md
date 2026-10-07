# HEL-1320: Triage and fix the 20 moderate npm advisories in frontend/

## Description

origin_kind: followup
origin_ticket: HEL-1319

At base 2c49bdba, `npm audit` in `frontend/` reports **20 moderate** advisories, plus the one high that HEL-1319 fixes. The CI frontend audit fails only on high or above, so these pass silently. helio-mcp's gate is set at moderate since HEL-1204; the frontend's is not.

## Acceptance Criteria

* List each advisory: package, the parent dependency that pulls it in, whether it is reachable at runtime or dev/build-only, and whether a fix is available.
* Bump whatever can be bumped without major-version churn. Every lockfile package whose version changed is listed.
* For anything that can't be fixed yet, record why in an allowlist entry with a reason and an expiry date.
* Then decide whether the frontend audit threshold should drop to moderate, as helio-mcp's did. That is an owner ruling, recorded on this ticket.
