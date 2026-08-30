## Why

A git worktree materializes only tracked files. `.gitignore` ignores `scripts/concertino/` wholesale, so the 15 delivery scripts that were never force-added are absent from every worktree a delivery run executes in. Measured on this ticket's own fresh worktree off `main@20a0ef20`: 8 files present, 17 absent.

That is not cosmetic. `tui-attached.sh` (CON-126's escalation gate) and `squash-branch.sh` (CON-129's mass-revert guard) are both among the absent — the fixes are installed in the root checkout and missing exactly where the work happens. Six independent tickets (HEL-646, 649, 710, 734, 799, and this one) were filed for this one defect, which is the signal that it is hit on essentially every run.

The enabling upstream work is now done: CON-148 (concertino `bc6342b`) added a `cleanup.skipSync` config boolean whose render emits `CONCERTINO_CLEANUP_SKIP_SYNC=1`, so the "make sync deliberate" half can be expressed as a render output rather than a hand edit that the next render erases.

## What Changes

1. Add `"cleanup": { "skipSync": true }` to the tracked `concertino.config.json`.
2. Run `concertino sync` so `scripts/concertino/.concertino.env` legitimately gains `CONCERTINO_CLEANUP_SKIP_SYNC=1` as a render output.
3. Remove the `scripts/concertino/` and `concertino.config.json` lines from `.gitignore`, replacing them with negative exclusions for the two stray artifacts, and `git add` the 15 delivery scripts.
4. Document the render-vs-edit contract ("script changes go upstream to Concertino, not here") in `CLAUDE.md` and `scripts/concertino/README.md`.

Order is load-bearing: steps 1–2 must land before step 3, so no cleanup run can auto-render into a tracked working tree.

Explicitly excluded: `pricing-table.json` and `report-cost.sh`. They are unreviewed WIP in the upstream Concertino checkout (both `??` in `git -C ~/Development/concertino status`), nothing in helio invokes them, and they leaked in via a render from a dirty working tree.

`.concertino/` (per-run artifacts) stays ignored, unchanged.

## Capabilities

### New Capabilities

None. This is a repository-configuration and tooling change: it alters which files git tracks and how a rendered artifact is produced. It introduces no product behavior and no API surface, so `.openspec.yaml` sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- `concertino.config.json` — new `cleanup` section (tracked; currently listed in `.gitignore` despite being force-added).
- `.gitignore` — Concertino block rewritten.
- `scripts/concertino/.concertino.env` — regenerated, gains one line.
- `scripts/concertino/` — 15 files newly tracked.
- `CLAUDE.md`, `scripts/concertino/README.md` — documentation of the render-vs-edit contract.
- No application code, no schema, no API. Frontend and backend are untouched.
- Workflow consequence: after this lands, edits to rendered scripts must go to the Concertino repo, not helio.
