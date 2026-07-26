## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas, and round-1's
  `skeptic-design-1.md` (treated as claims to re-verify, not fact).

- **Regression eliminated (round-1 CR1)**:
  - No new Flyway migration exists: `ls backend/src/main/resources/db/migration/` tops out at V72,
    no V73 added. `git status` / `git diff main...HEAD --stat` show only openspec artifact files
    changed — zero backend code touched yet (expected at design gate).
  - `DashboardRepository.insert` / `updateName` / `delete` (backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala:141-165)
    read exactly as before — plain unconstrained writes, no violation-handling added or needed.
  - `DashboardSnapshotRepository.duplicate` (backend/src/main/scala/com/helio/infrastructure/DashboardSnapshotRepository.scala:28-67)
    still does a raw `table += domainToRow(newDash)` with `name = s"${sourceDash.name} (copy)"` —
    a second duplicate would still succeed today, and nothing in the revision touches this path.
  - `design.md` D3 explicitly documents the rejected-alternative reasoning (unconditional unique index
    breaks `duplicate`/`updateName`/plain-create); `proposal.md` "Impact" says "no migration needed";
    `tasks.md` 3.2 explicitly states "App-level check-then-insert only — no DB constraint, no
    violation-handling needed"; `tasks.md` 6.7 adds an explicit regression test ("plain create,
    duplicate, and rename are unaffected"); spec scenario "Plain create, duplicate, and rename are
    unaffected" (dashboard-get-or-create/spec.md:45-49) makes the guarantee testable. Round-1's
    concrete, reproducible contradiction is genuinely resolved, not just asserted away.

- **Accepted v1 race framing (get-or-create)**: `design.md` D4 and the spec's "Concurrent get-or-create
  race (accepted v1 behavior)" scenario (dashboard-get-or-create/spec.md:37-43) explicitly scope the
  idempotency guarantee to sequential calls and name the race rather than hide it. This matches the
  ticket's own design-gate brief item 4 ("at minimum, name the behavior" — not "prevent it") and is
  grounded in real `helio-news` usage (one serial HTTP call per rebuild, confirmed by ticket Context).
  `tasks.md` 6.5 tests only sequential idempotency, consistent with the documented scope — no
  overclaiming. This is a necessary, honestly-labeled consequence of dropping the unique index, not a
  new problem.

- **Other three design-gate concerns re-sanity-checked** (not re-derived, per task instructions):
  - D1 (atomicity boundary) and D2 (wire shape / id-remap) text is unchanged from round-1's confirmed-sound
    version.
  - Multi-tenancy: `findByIdOwned`/ACL-mirrors-`update` pattern and `findByNameOwned`'s `WHERE owner_id`
    scoping both still present in design.md/tasks.md 3.1, matching `DashboardRepository.findById`/
    `findByIdOwned` (DashboardRepository.scala:65-116).
  - D4's second bullet (overlapping replace-contents → Postgres row-lock serialization, last-writer-wins,
    accepted for v1) is untouched by the D3 revision.
  - Found one **stale cross-reference** while checking task numbering: `design.md:47` says "(task 3.2
    spells this out explicitly)" for the D2 panel-id-remap requirement, but in the current `tasks.md`
    that content is actually task **2.2** ("mint new panel ids, remap `ProposalPanel.layout`... see
    design.md D2" — tasks.md:20-23). Task 3.2 in the current numbering is the unrelated `ifExists`
    lookup logic. The substance the round-1 non-blocking note asked for is present and correctly placed
    in tasks.md (2.2) — only the design.md pointer is wrong, most likely because inserting the new
    section-1 refactor task shifted section numbers by one without updating this internal reference.

- **Sibling scope discipline**: `design.md` Non-Goals and `proposal.md` Non-goals still correctly cite
  HEL-366 (data-source/pipeline/DataType teardown) and HEL-368 (panel-id-preserving diff/merge) as
  excluded; HEL-370 is not mentioned or absorbed anywhere in the current design/tasks/proposal text
  (`grep` for all three ticket ids across design.md/tasks.md/proposal.md confirms no new absorption).

### Verdict: CONFIRM

The round-1 regression is genuinely eliminated (verified against live code, not just design prose), the
race-framing revision is an honest and adequately scoped consequence of that fix rather than a new
problem, and the three untouched design-gate concerns remain intact. Sibling-scope discipline holds.

### Non-blocking notes

1. **Consistency nit (incomplete application of round-1 fix's own follow-through, not a new flaw):**
   `design.md:47`'s parenthetical "(task 3.2 spells this out explicitly)" should say **task 2.2** — the
   panel-id-remap requirement actually lives in `tasks.md` section 2 ("Backend — atomic replace-contents"),
   not section 3 ("Backend — get-or-create-by-name"). Task 3.2 in the current file is the `ifExists`
   lookup, unrelated to layout remapping. One-line fix in design.md; no task-content change needed.
