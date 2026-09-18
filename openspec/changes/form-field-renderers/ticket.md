# HEL-1085: Field renderers: text, textarea, number, date, select, checkbox

## Description

The six non-file field types, rendered on-panel and sized for a grid cell.

**AC (a11y, blocking):** every field is reachable and completable by keyboard alone; every field has a programmatic label asserted by **computed accessibility name**, not by DOM presence — jsdom makes presence assertions vacuously true (see HEL-1005). Error messages are associated with their field.

---

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- The six non-file controls (`text`, `textarea`, `number`, `date`, `select`, `checkbox`) of a configured `form` panel render on the panel body, sized for a grid cell.
- Every rendered field is reachable and completable by keyboard alone.
- Every rendered field has a programmatic label, asserted by computed accessibility name (never by DOM presence).
- Error messages are associated with their field (computed ARIA state — `aria-invalid` on the control and the error text resolving as the control's accessible description — never `role="alert"` presence).

## Context

- Parent epic: HEL-1082 (form panel). Prerequisites shipped: HEL-1083 (`820359a0`, `form` PanelKind + config schema + PanelType round-trip), HEL-1084 (`9f6f4d41`, field-type builder with author-time schema consistency).
- Out of scope, separate leaves: HEL-1086 (file upload field), HEL-1087 (submit path), HEL-1088/1089 (counter), HEL-1090 (assembled audit).
- Ticket status was cascaded to Done by the epic close on 2026-09-17 and reopened; premise re-verified against the tree at Setup (`.concertino/runs/HEL-1085/evidence/premise-validation.md`, verdict no-drift).
- Priority: High. Project: Helio v0.8 — Interactive Data & Write-Back.

## Fold-in scope (Phase 4 follow-up; owner ruling `fold-in`, 2026-09-18)

The first delivery merged as PR #672 (`b1b954e3`). The post-cleanup follow-up escalation
`HEL-1085-1789714889030-0c3cd5` was answered `fold-in` (`escalation.answered` t=1789743706791, human, chat),
reopening Execution for this added, docs-only scope. Added acceptance criteria:

- `MISTAKES.md` gains a trap entry for the Husky pre-commit timeout: a `git commit` issued without a ~600000 ms tool
  timeout is backgrounded mid-hook and the agent then waits for a notification that never arrives in the expected
  shape; the recovery is to wait on `.git/worktrees/<name>/COMMIT_EDITMSG` via `await-sentinel.sh` — never re-run
  the commit mid-hook.
- `MISTAKES.md` gains a trap entry for the `pgrep -f` self-match poll deadlock: an unanchored pattern matches the
  polling shell's own command line and never terminates, and the leaked shell holds the worktree open against
  `cleanup.sh`; anchor every check.
- Both entries read as traps (look correct, fail silently) in the file's established voice, under `## Tooling`.
  No source, spec, or schema change.
