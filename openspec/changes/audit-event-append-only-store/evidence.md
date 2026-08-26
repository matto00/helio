# Evidence — HEL-471 append-only demonstration + isolation checks

Binding requirement (ticket.md / design.md Testing strategy item 6, tasks.md 5.6/5.6b): the
append-only guarantee must be **demonstrated**, not asserted — a check that cannot fail is not
evidence. This file captures the actual RED transcripts produced by temporarily removing the
enforcement mechanism and re-running the same targeted statements the permanent (green)
`AuditEventsAppendOnlySpec` asserts against, plus the 6.3 naive-implementation red and the 6.5
scope-isolation grep.

The temporary spec files used to produce these transcripts (`TempRedCaptureSpec`,
`TempRedCaptureSpec2`, `TempNaiveRecoverRedSpec`) were **not committed** — they existed only for
the duration of the capture below, then were deleted, so the permanent test suite stays green in
CI while still having genuinely observed every one of these failures once, live, against real
Postgres.

## 5.6 — all three triggers dropped (`DROP TRIGGER` on the superuser connection, scratch instance)

Setup: same two-role topology as `AuditEventsAppendOnlySpec` (`helio_app_test` non-BYPASSRLS app
pool, `helio_privileged` BYPASSRLS privileged pool, superuser owner connection). After Flyway
applies V91, all three triggers (`audit_events_no_mutation_stmt`, `audit_events_no_mutation_row`,
`audit_events_no_truncate`) were dropped via the superuser connection, then the same statements
`AuditEventsAppendOnlySpec` asserts on were re-run.

```
=== 5.6 RED TRANSCRIPT: all three triggers dropped ===
[RED-CAPTURE] 5.2 app-pool UPDATE, row caller owns => SUCCEEDED, affected=1 rows (id=6ed2ab95-2a3c-4eec-b6d8-37b1f58957d7)
[RED-CAPTURE] 5.2 app-pool DELETE, row caller owns => SUCCEEDED, affected=1 rows (id=6a501a53-643c-4359-8065-110cc26da6a9)
[RED-CAPTURE] 5.2 app-pool UPDATE, other user's row => SUCCEEDED, affected=0 rows (id=bff92c6c-8087-4c2f-9bf8-e8e5248b3dd4)
[RED-CAPTURE] 5.2 app-pool DELETE, other user's row => SUCCEEDED, affected=0 rows (id=44e5f711-c689-4017-87ed-46a0c51d70a4)
[RED-CAPTURE] 5.2 app-pool UPDATE, NULL-actor row => SUCCEEDED, affected=0 rows (id=74592c56-5a45-472c-ba69-8c2f89212076)
[RED-CAPTURE] 5.2 app-pool DELETE, NULL-actor row => SUCCEEDED, affected=0 rows (id=a0e60db1-2dd1-4fd0-9b20-1eafb629813c)
23:11:26.572 INFO  [postgres] ERROR:  permission denied for table audit_events
23:11:26.573 INFO  [postgres] STATEMENT:  UPDATE audit_events SET action = 'tampered' WHERE id = $1::uuid
[RED-CAPTURE] 5.3(a) privileged-pool UPDATE, revoke still in place => THREW org.postgresql.util.PSQLException: ERROR: permission denied for table audit_events
[RED-CAPTURE] 5.3(b) privileged-pool UPDATE, after re-GRANT => SUCCEEDED, affected=1 rows (id=f1d69bae-60a6-4ab5-b8d0-093ad10d2a5d)
[RED-CAPTURE] 5.4 app-pool UPDATE (other user's row) after fresh GRANT ALL TABLES (must be silent zero-row) => SUCCEEDED, affected=0 rows (id=c20cdd50-38d3-4731-81f1-835d5d20ba8c)
[RED-CAPTURE] 5.5b TRUNCATE via owner/superuser connection => SUCCEEDED, affected=0 rows (id=61028390-aa93-4e38-abda-329e3c1e7b12)
=== END 5.6 RED TRANSCRIPT ===
```

**Which red was observed, per case:**
- Rows the caller owns (both UPDATE and DELETE): SUCCEEDED with `affected=1` — with the trigger
  gone, an ordinary owned-row mutation just works, as expected.
- Other-user's row and NULL-actor row (UPDATE and DELETE, app pool): SUCCEEDED with `affected=0`
  — **the silent zero-row failure mode the brief names**, reproduced exactly as design.md predicts
  once RLS scan-filtering is the only thing standing between the statement and the row.
- Privileged pool phase (a), revoke still in place: **THREW `permission denied` (42501)** — this is
  the defence-in-depth REVOKE working, not the trigger (the trigger is already gone in this run).
- Privileged pool phase (b), after re-GRANT: SUCCEEDED with `affected=1` — with both the trigger
  and the revoke gone, the privileged pool can freely mutate. This is the case that proves the
  trigger (not the revoke) is what protects the privileged pool once it holds the grant.
- **5.4 (post-GRANT-to-app-role, targeted at another user's row): SUCCEEDED with `affected=0`** —
  confirmed as the **required** silent-zero-row form, not `permission denied`. This is the single
  observation design.md calls out as proving the trigger, not the revoke, is load-bearing for this
  case: the app role holds a fresh, unrestricted grant, so nothing but RLS scan-filtering explains
  the zero-row outcome, and RLS alone reports success on zero rows rather than raising.
- TRUNCATE via the owner connection: SUCCEEDED with `affected=0` (Postgres reports `0` rows
  "affected" for TRUNCATE regardless) — with the TRUNCATE trigger gone, the owner connection can
  freely truncate the table.

## 5.6b — only the statement-level trigger dropped (row-level trigger + all three RLS policies intact)

Fresh scratch instance (separate from 5.6, since 5.6 already destroyed its instance's triggers).
Only `audit_events_no_mutation_stmt` was dropped; `audit_events_no_mutation_row` and the three RLS
policies (`audit_events_owner`/`audit_events_update`/`audit_events_delete`) were left exactly as
V91 creates them.

```
=== 5.6b RED TRANSCRIPT: statement-level trigger dropped, row-level trigger + all three policies intact ===
[RED-CAPTURE] 5.6b app-pool UPDATE, other user's row (row-level trigger + policies alone) => SUCCEEDED, affected=0 rows (id=e32fe00c-06f4-4ce4-a657-698b109bdce8)
[RED-CAPTURE] 5.6b app-pool DELETE, NULL-actor row (row-level trigger + policies alone) => SUCCEEDED, affected=0 rows (id=12455866-1cf9-4ce3-910f-34fecbf04012)
=== END 5.6b RED TRANSCRIPT ===
```

Both TARGETED statements (`WHERE id = ...`) against rows invisible to the caller's RLS context
**SUCCEEDED with `affected=0`** — the silent zero-row form — even with the row-level trigger and
all three policies present and correctly configured. This is exactly what design.md's Decision 1
predicts: a `FOR EACH ROW` trigger only fires for rows the scan actually selects, and RLS's
`SELECT`-alongside-`UPDATE`/`DELETE` behaviour filters these rows out of the scan before the
row-level trigger ever gets a chance to fire. This is the observation that isolates the
**statement-level** trigger specifically as the load-bearing mechanism — the row-level trigger and
the policy split are demonstrably insufficient on their own.

## Green re-run after restoring the mechanism

Both scratch instances were discarded (their `EmbeddedPostgres` processes were torn down in
`afterAll`, and the temporary spec files were deleted without being committed), so the permanent
suite always runs against V91's unmodified migration. The real, permanent
`AuditEventsAppendOnlySpec` (16 tests, all the same statements as above, always run against the
unmodified V91 migration) is green:

```
[info] Total number of tests run: 16
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 16, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

## 6.3 — naive `.recover`-only implementation, red against a synchronous throw

A naive `record` built as a bare
`auditEventRepo.append(event).map(_ => ()).recover { case NonFatal(_) => () }` (no eager
`Future(...)` guard) was run against a repository stub whose `append` throws synchronously
(`throw new IllegalStateException(...)`, never returning a `Future` at all):

```
[RED-CAPTURE] naive record with synchronous throw => THREW java.lang.IllegalStateException: synchronous append failure
```

The throw propagates straight out of `record`, uncaught — `.recover` is never reached, because the
exception happens before `append(event)` ever produces the `Future` `.recover` would attach to.
This is the exact defect `AuditService.record`'s `Future(auditEventRepo.append(event)).flatten`
guard fixes (deferring the repository call itself onto the execution context, so a synchronous
throw becomes an ordinary failed `Future` `.recover` can catch). `AuditServiceSpec`'s
"complete successfully even when the repository's append throws synchronously" test is green
against the real implementation and would have failed against this naive one.

## 6.5 — scope-isolation, mechanical and recorded

Run against the real committed diff (`f6e69edb`), the raw grep is **not** empty — it matches the
literal string `ratelimit.trip` (Decision 4's example action name, required by the model-shape
check) inside `AuditServiceSpec.scala`/`AuditEventRepositorySpec.scala` test data, and it matches
prose in `design.md`/`ticket.md`/`tasks.md` that documents Decision 4 by name (design.md is
required, by that same Decision 4, to state the HEL-495 relationship in writing). Both are
expected and required by the ticket's own text — a literal grep for the word cannot be empty once
the planning docs (which must discuss HEL-495 by name) are included in the diff.

The actual scope-isolation claim tasks.md 6.5 is checking for — **no code-level import of, or
dependency on, `RateLimitDirective` or `com.helio.services.ratelimit`** — is verified separately
and genuinely empty:

```
$ git diff origin/main...HEAD -- backend/src | grep -i "RateLimitDirective\|com.helio.services.ratelimit\|import.*ratelimit"
$ echo "exit: $?"
exit: 1
```

No import, no call site, no reference to the rate-limiting package anywhere in the backend diff.
`files-modified.md` lists no route or directive file — confirmed by inspection, since this ticket
adds no route/directive file at all.

---

## Post-refactor red-verification (run by the orchestrator, after commit 42c60a6f)

**Why this exists.** The final-gate round-1 skeptic red-verified the append-only guarantee *before*
commit 42c60a6f folded idempotent `GRANT`s into each dependent test to remove an intra-suite ordering
dependency. That refactor introduced a specific, legitimate concern: a test which first re-`GRANT`s
UPDATE/DELETE and then asserts the mutation fails could, if enforcement were removed, mask the very
property it exists to prove. Round 1's red predates the refactor, so it does not cover this. This
verification closes that gap against the shipped tree.

**Method.** `AuditEventsAppendOnlySpec` runs against a throwaway `EmbeddedPostgres` instance, so the
migration could be temporarily neutralised without touching the shared dev Postgres or its
`flyway_schema_history`. Two runs, each reverted immediately afterwards.

### Run 1 — statement-level trigger disabled only (row-level + TRUNCATE triggers left in place)

`Tests: succeeded 12, failed 4`

The four failures were exactly the app-pool other-user and NULL-actor UPDATE/DELETE cases:

```
- should fail UPDATE with 23001, not a silent zero-row success *** FAILED ***
  Expected exception java.lang.Exception to be thrown, but no exception was thrown
- should fail DELETE with 23001, not a silent zero-row success *** FAILED ***
  Expected exception java.lang.Exception to be thrown, but no exception was thrown
```

"No exception was thrown" IS the silent zero-row success. This is the correct red, in the correct
failure mode, on precisely the row classes design.md Decision 1 and Decision 3 predicted — and it
confirms the row-level trigger genuinely is defence-in-depth only (it still covered the rows visible
to the scan, which is why the other twelve tests still passed).

### Run 2 — all three triggers disabled

`Tests: succeeded 5, failed 11`

Every one of the eleven `23001`-asserting tests failed, including both GRANT-bearing tests and TRUNCATE:

```
- should fail UPDATE with 23001 — proof the trigger binds a BYPASSRLS role holding the privilege *** FAILED ***
- should still fail UPDATE with 23001 — proof the trigger, not a revoke, is load-bearing *** FAILED ***
- should fail with 23001 rather than erasing the table *** FAILED ***
```

The five that still passed are the positive controls (privileged-pool INSERT, app-pool SELECT scoping,
the `source` CHECK) and the two `42501` phase-(a) tests — which correctly bind to the defence-in-depth
REVOKE rather than to the trigger, exactly as design.md's Testing-strategy item 2 specifies.

**Conclusion.** Every assertion that claims the trigger enforces append-only fails when the trigger is
removed. The folded-in `GRANT`s do not mask enforcement: they widen privilege so the statement reaches
the trigger, which is the entire point of tasks 5.3(b) and 5.4. No test in this suite is
evidence-shaped non-evidence.

**Restored and re-verified green:** `Tests: succeeded 16, failed 0`.
