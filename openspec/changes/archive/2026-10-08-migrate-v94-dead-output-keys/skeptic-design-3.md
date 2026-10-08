## Skeptic Report — design gate (round 3, skeptic-design-3.md)

I reviewed the change dir at HEAD 76816d406e15f10ee1c53431fea801cb18637062. I did not relitigate owner rulings Q1-Q4.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/migrate-v94-dead-output-keys/HEL-1387`.
- **V117 is still free.** After `git fetch origin main`, the V11x migrations on `origin/main` stop at
  `V116__node_payload_history.sql`.
- **Round-2 CR1 is addressed (rewritten, not just reworded).**
  - proposal.md Impact now reads "FORCE RLS plus a `_deny_all` policy, and an explicit `GRANT SELECT` to
    `helio_privileged` (V105 `oauth_states` pattern)".
  - design.md Planner Notes now reads "FORCE RLS + deny-all policy + explicit helio_privileged grant".
  - The proposal's Capabilities line now says "adds the requirement describing what migration V117 does". It no longer
    states a standing invariant.
  - No artifact still says "no policies".
  - The V105 claims hold: `V105__oauth_states.sql` has FORCE (L38), `oauth_states_deny_all` (L43) and an explicit
    `GRANT ... TO helio_privileged` (L48).
- **Round-2 CR2 is addressed.** D2 rule 1 is now limited to "only two cases": a rename source on a kind other than its
  D1 rename kind, or `format`/`columnOrder`/`chartOptions` on a kind whose `KnownKeys` lacks it. It also says "No
  other key is ever `kind-inapplicable`". Rule 2 lists the six no-equivalent keys on any kind, so it can now fire.
  Precedence is unambiguous.
- **Round-2 CR3 is addressed.**
  - The spec SHALL now renames only when the kind accepts the live key, the value (or nested `layout`/`sort`) is
    non-null and passes the reader shape, and the live key is absent or null. Otherwise it drops the key.
  - A `"layout": "tile"` → `invalid-value` scenario was added.
  - proposal.md's first bullet mirrors the same condition.
- **Fresh check against code: the D1 mapping matches `OutputConfigValidation.scala`.**
  - `KnownKeys` (L21-28):
    - chart: chartOptions/annotation
    - metric: label/unit/format
    - table: columnOrder
    - collection: layout/format
    - timeline: sort
    - markdown: content
  - `Shared` = fieldMapping/compare/historyPayloads (L19).
  - `Renames` (L33) and `DeadStyling` (L34) agree with D1.
  - Every key V94 writes is covered by D1, either as a rename, a no-equivalent drop or a Q3 kind-inapplicable drop:
    `V94__outputs_model.sql` L707 (`format`) and L746-757.
- **Fresh check: the D5/D7 logic is sound.**
  - The guard runs while `outputs` is NO FORCE, so as the owner it sees every row.
  - If the bracket is missing, the owner sees zero rows under FORCE, so the guard would pass vacuously.
  - The design correctly treats the guard as untrusted for that reason. The superuser-side count in D8 and the D8
    mutation are the backstop.
- **The test fixtures and specs the design relies on exist on `origin/main`:** `hel904-real-dump.sql`,
  `FlywayNonSuperuserMigrationSpec`, `RlsPolicyGuardSpec` and `V94OutputsMigrationSpec`.
- **Every AC is covered by a task:**

  | AC | Task |
  |---|---|
  | AC1 | 1.1 |
  | AC2 | 2.3 |
  | AC3 | D2 + 2.2 |
  | AC4 | 1.3 + 2.1 |
  | AC5 | 2.1 |
  | AC6 | D8 + 2.1/2.6 |
  | AC7 | 2.4, non-vacuous by construction |
  | AC8 | the dev count in the proposal; the PR must restate it per dead key |

  I found no scope drift beyond the rulings. No API or schema contract changes, so no OpenAPI or JSON Schema delta is
  needed.

### Verdict: CONFIRM

### Non-blocking notes

- D4 writes the CHECK constraint as `(...six values...)`. The implementer must spell out exactly the six D2 action
  strings. The spec test's exact-`action` assertions will catch a typo.
- **AC8** asks for the dev-DB count of affected rows **per dead key**. The proposal gives only the total (2 of 2212).
  The PR body needs the per-key breakdown. It should also list separately any unknown non-D1 keys found, per the
  round-2 note.
- Task 2.3's "+1 audit row" holds only if the re-inserted value is a single top-level dead key. Pick the fixture key so
  that the expectation is exact.
- In the D8 posture test, under `helio` the 0 rows come from the deny-all policy plus FORCE. Under
  `SET ROLE helio_privileged` they come from that role's BYPASSRLS in the test recipe. Make sure the pre-seeded
  `helio_privileged` in the spec actually has BYPASSRLS, or the N-rows assertion will fail for the wrong reason.

### Gate defects

None. No report in this change dir rests on mtime or ordering evidence.
