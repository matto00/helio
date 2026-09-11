# Handoff — start the v0.8 batch

**Written 2026-09-10. Delete this file once you have read it (see the last line).**

`main` is at `514d821a`, working tree clean, nothing running.

## Read this first

`MEMORY.md` → `project_roadmap_rescope_2026_09_10`. **Every milestone memory written before 2026-09-10 has wrong version numbers** — the whole roadmap shifted that day.

## Where the roadmap stands

A new **v0.8 — Interactive Data & Write-Back** was inserted and everything else moved back one minor:

| Milestone                                 | Open | Was                     |
| ----------------------------------------- | ---- | ----------------------- |
| v0.7 — UI/UX Cohesion…                    | 10   | (was 109 open)          |
| **v0.8 — Interactive Data & Write-Back**  | 47   | new                     |
| v0.9 — Insight, Distribution & Enterprise | 24   | v0.11 Insight           |
| v0.10 — Data Connectors                   | 50   | v0.9                    |
| v0.11 — Mobile Experience (PWA)           | 51   | v0.8                    |
| v0.12 — Readiness                         | 125  | v0.10                   |
| Security & Compliance                     | 18   | continuous, unversioned |

Thesis for v0.8: _Helio stops being a read-only window onto data acquired elsewhere and becomes somewhere data is created._ Design spec is on `main` at `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`.

## Ready to dispatch now

**HEL-1077** (dataset row write API), **HEL-1078** (row edit/delete with an `updatedAt` precondition), **HEL-1080** (row grid UI).

All three were unblocked by HEL-1075, which decided: **a new `dataset_rows` table, not blob reuse.**

```
dataset_rows(id, data_source_id, seq, data jsonb, created_at, updated_at)
```

with a forced RLS policy scoped through `data_source_id` to `data_sources.owner_id`, mirroring the existing `data_sources_owner` policy. Full rationale and the live measurement behind it: `openspec/changes/archive/2026-09-10-decide-dataset-row-storage/design.md`.

The deciding factor was that **row-level addressing is impossible in the current blob store** — `updateStaticPayload` replaces the whole `{columns, rows}` array and there is no row identity, so HEL-1078's `WHERE id = ? AND updated_at = ?` precondition has nothing to bind to.

## Brief every lane on these — the acceptance criteria alone are not enough

1. **The RLS trap.** Flyway runs as the non-BYPASSRLS `helio` role in production, while every local, CI, and prod-dump check runs as superuser and masks the failure. `dataset_rows` policies must be exercised under a non-superuser role. This is exactly the v0.7.x release-incident failure mode.
2. **HEL-1104 owns the only migration** that adds all four new ops to `pipeline_steps_op_check` (a drop/re-add CHECK constraint). **Never run HEL-1098 and HEL-1103 as parallel lanes with separate migrations** — they collide on that constraint.
3. **Driver claims are claims, not premises.** Tell lanes to verify what you assert and expect to be corrected. On 2026-09-10 the driver briefed HEL-1075 with a false premise sourced from a stale scaladoc, and the lane caught it by measurement. See `feedback_validate_premise_before_building`.
4. **Start a watchdog in the same turn as the first lane, and stop it with the last one.** Orchestrators are known to park mid-handoff. See `feedback_concertino_background_batch_ops` for the rebuild recipe — note the FLEET signal trips on successful completion if you leave it running.
5. **One orchestrator per ticket.** Never hand a multi-ticket queue to a single orchestrator; the driver holds the queue and dispatches on each merge.

## Known-open loose ends

- **HEL-1118** — the stale `StaticSource` scaladoc is still on `main`. Linear auto-closed the ticket when a PR merged from a branch named after it, without the work having happened. Reopened. **Watch for that pattern generally**: a branch name closes a ticket, the diff does not.
- **CON-177** — the fleet watchdog has no durable home and has been rebuilt from memory three times. Seven constraints recorded on the ticket.
- **Three zombie shells**, idle at 0% CPU, holding no locks, will never exit: `248273`, `262278` (both `pgrep -f` patterns that match their own command line), and `375332` (waiting on a CON-172 archive file that will never appear). Safe to `kill`.

---

**Delete this file when you have read it** — it is a handoff, not documentation, and it goes stale the moment the batch starts:

```bash
git rm HANDOFF.md && git commit -m "Remove consumed v0.8 batch handoff"
```
