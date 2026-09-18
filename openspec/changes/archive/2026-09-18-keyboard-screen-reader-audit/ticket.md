# HEL-1090: Keyboard and screen-reader audit of the assembled form panel

## Description

The per-field ACs (HEL-1083..1089) cover components in isolation; this ticket covers the **assembled panel** — tab order across fields, focus on submit, focus after error, and the panel's own role and label within the grid.

**AC:** a full submit completed keyboard-only, verified against the running app rather than jsdom.

"Rather than jsdom" is the whole ticket. Standing constraint C8: assert computed ARIA state, never presence. Read the computed accessibility tree from a live browser (as HEL-1088 did with `role="spinbutton"`/`aria-valuenow`/`aria-valuetext`).

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- Full submit completed keyboard-only, verified against the running app (not jsdom).
- Tab order across every field type including the file field and the counter.
- Focus lands correctly on submit, on success, and after a **server-side** rejection (not just client-blocked).
- Whether an asynchronously-arriving error is actually announced (computed live-region state).
- The panel's own role and accessible name inside the dashboard grid.
- Re-measure HEL-1158's three findings (submit below fold, same-frame clear/refill re-announcement, duplicated error text) on the assembled panel — say whether they still hold, changed, or were fixed. File nothing duplicating HEL-1158; if any blocks keyboard-only completion (not just polish), say so plainly.

## Constraints

- C7: prove red by mutation, one layer at a time.
- C8: assert computed ARIA state, never presence.
- DESIGN.md binding for frontend/**; compare against running app in both themes.
- MISTAKES.md binding (commit-timeout, pgrep self-match traps).
- Fixture hygiene: prefer ephemeral EmbeddedPostgres; clean up shared dev DB by exact id with before/after counts if touched. No leftover files in ~/.helio/uploads/.
- `e2e` is not a configured pre-commit/local gate (HEL-1157) — e2e specs are enforced only by CI's `e2e` job.

## Non-goals

- Do not duplicate HEL-1158's three findings as new tickets — only re-measure and report status.
- Do not re-audit isolated field components already covered by HEL-1083..1089 per-field ACs.
