## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `507ca5bd84388279fc4aa1b81643afe9baa3d7b3`. The base was resolved live with `resolve-review-base.sh` and gave `deb53526ea3b37e50cb7924d5cfd81b3f8e570ad` (exit 0). This round's scope is the fix commit `0e574897..507ca5bd`. The round-1 review of the implementation still stands, because this commit changes no code.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/row-listing-api-dataset-rows/HEL-1121`.
- **The fix commit changes only docs and comments.** `git diff 0e574897 507ca5bd --stat` lists 6 files:
  - one Scala test file, where the only change is comment lines plus the removal of a bare `succeed`;
  - design.md, the spec delta and files-modified.md;
  - evaluation-1.md and skeptic-final-1.md, which are newly committed reports.

  No main-source file changed. Removing `succeed` removes no assertion.
- **Tests, run fresh by me:** `sbt -batch "testOnly *RlsOwnerTablesSpec *DataSourceRepositorySpec *DataSourceRoutesSpec *DataSourceProtocolSpec"` gave `Tests: succeeded 214, failed 0`, `All tests passed`, EXIT=0.
- **CR2 (design.md D7): fixed correctly.** The text now says "same transaction, but not the same read snapshot … READ COMMITTED, where each statement … takes its own snapshot". That matches the code (no isolation override, as established in round 1).
- **CR3 (spec delta line 80): fixed correctly.** It now names "the `row-listing-api` change's design.md (D7) and its RLS test task (tasks.md 4.4)". Both targets exist: D7 is in design.md, and `tasks.md:53` is `4.4 **RLS test (AC #2, MUST)**`.
- **CR1 (RlsOwnerTablesSpec (d)): the placebo is gone, but the new comment makes a false claim.** See Change Request 1.

### Verdict: REFUTE

Two of the three fixes are correct. The third swapped one false narrative for another in the same comment block. Round 1 refuted on exactly this class of defect: a confidently false claim in a permanent artifact. Staying consistent means it can't be waved through now. The fix is small and comment-only.

### Change Requests

1. **`backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala:619-622`: the new (d) comment describes this spec's fixture wrongly.**

   It says:

   > "this spec's single-role `ctx` (both pools ultimately resolve through the same superuser-derived data source, see beforeAll) cannot itself distinguish … without a second, differently-scoped role to contrast against"

   This is false, and the spec's own `beforeAll` disproves it:
   - The spec is explicitly two-role. `appDb` runs `SET ROLE helio_app_test`, a NOSUPERUSER, non-BYPASSRLS role (lines 115-121). `privilegedDb` runs `SET ROLE helio_privileged`, which is BYPASSRLS (lines 83-87). Then `ctx = new DbContext(appDb, privilegedDb)` (line 123).
   - The file header (lines 34-40) describes this two-role strategy.
   - `tasks.md` 4.4 calls it "`RlsOwnerTablesSpec`'s existing two-role … fixture".
   - Probe (c) in this same test relies on the difference between the two roles.

   The "single-role, both pools point at the superuser" wording looks copied from the comment in `DataSourceRepositorySpec.scala` (lines 674-681), where it *is* true. The actual reason (d) can't be asserted here is different. Under a real RLS role, a non-owner's `listRows` is already denied by RLS, see probe (a). So "no app-level owner predicate" can only be observed under a ctx without RLS, which is what the `DataSourceRepositorySpec` test provides.

   Fix: rewrite the rationale to say that. Keep the pointer to the `DataSourceRepositorySpec` test, and correct the citation too:
   - the path is `persistence/sources/DataSourceRepositorySpec.scala`;
   - the test itself starts at line 682; line 674 is only the start of its preceding comment.

   Citing the test by name alone is also fine.

### Non-blocking notes

- Round 1's non-blocking notes still apply unchanged. They are: the keyset-vs-offset guard, D5's declared-schema follow-up at Delivery, and the `/rows` routes missing from `openspec/config.yaml` and the endpoint list in `CLAUDE.md`.
