# HEL-1087: Submit path: validate, append, and report

## Description

Wire submit to the row-append API. Validate client-side against the declared schema and again server-side (client
validation is convenience, not enforcement). Success, field-level error, and network-failure states.

**AC:** a rejected submit preserves the user's input rather than clearing the form; errors are announced to
assistive technology, not only shown visually.

---

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- Submit is wired to the row-append path: a successful submit appends exactly one row to the panel's bound
  dataset source.
- Input is validated client-side against the declared schema AND again server-side; the server independently
  rejects a payload the client would have blocked (client validation is convenience, not enforcement).
- Success, field-level error, and network-failure states are handled.
- A rejected submit preserves the user's input rather than clearing the form.
- Errors are announced to assistive technology, not only shown visually.

## Context (Linear)

- Priority: High. Project: Helio v0.8 — Interactive Data & Write-Back. Parent: HEL-1082. Related: HEL-1085.
- Linear status history: marked Done by the epic-close cascade on 2026-09-17 and reopened; the ticket is
  genuinely unbuilt (verified against the tree at Setup — `premise-validation.md`).

## Driver brief (claims verified at Setup)

- Foundations on `main`: HEL-1083 (`820359a0`), HEL-1084 (`9f6f4d41`), HEL-1150 (`f5a8a315`), HEL-1085
  (`b1b954e3`, PR #672) — all confirmed. Row-append API `POST /api/data-sources/:id/rows` exists; the backend
  already validates appended rows against the dataset's declared schema (HEL-1077); form-level `required`
  tightening and `select` options have no server-side enforcement today.
- Standing constraint C8 (HEL-1084): assert computed ARIA state, never presence. Preserved-input and
  no-write-on-rejection must be proven red first (mutation).
- Write-path caution: the append must target the bound `dataSourceId` and nothing else; a rejected submit writes
  nothing — prove with a row count before and after.
- Hazards: `git commit` needs a 600000 ms timeout; anchored `pgrep`; no foreground `sleep`; shared dev DB
  (clean up fixtures); DESIGN.md binding in both themes; MISTAKES.md binding; never `gh pr merge --auto`; the
  real merge gate is `ci-complete` present AND SUCCESS plus `mergeStateStatus` CLEAN.
