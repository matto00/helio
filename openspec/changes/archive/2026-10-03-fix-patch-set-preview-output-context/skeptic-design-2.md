## Skeptic Report - design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Re-read ticket.md, proposal.md, design.md, tasks.md, specs delta against round-1 CRs:
- CR1 (MatchError in Projection): now stated in proposal Why, design Context (a), Decision 4 (OutputUpdate/OutputDelete cases, Impact decision recorded, test previewing every ResolvedAction variant), task 2.3/3.2. Addressed.
- CR2 (:673 boundOutputs silent degradation): design Context (b), Decision 3/5 (audit includes `== null`/Option guards), task 2.4, task 3.4 + spec requirement "pipelineStep delete prior state". Addressed.
- CR3 (orNull `.orNull` keeps null reachable): Decision 3 drops the compile-time claim, requires typed ServiceError for apply and preview (task 2.2). Addressed.
- CR4 (parity test): shared factory (Decision 2/task 2.1), reflection over all context fields asserting non-null, concrete mutation (Decision 6, task 3.6a). Addressed.
- CR5 (write-free): full public-schema checksum, whole (kind,op) matrix incl. output:create 400, failability mutation (Decision 5/7, tasks 3.3/3.6b). Addressed.
- CR6 (ExistenceNotLeaked): Output target in Seeded/targetIdOf, distinct apply+preview rows, exemptions removed, correct api/http path, unreachable-second-message reasoning (Decision 8, task 3.5). Addressed.
- CR7 (red first): task 1.1 asserts 200 + Output diff, captures command and 500 output; Decision 9 notes it stays red until projection is fixed. Addressed.
- CR8 (spec delta): update/delete diff shapes, foreign/absent 404, step-delete parity scenarios present. Addressed. Empty Standing Constraints heading now filled. 6 fixtures listed.
All AC of the ticket (red first, audit + parity test, write-free, exemption removal) map to tasks 1.1, 2.x/3.1, 3.3, 3.5.

### Verdict: CONFIRM

### Non-blocking notes
- Decision 2 leaves PatchSetApplyService's `outputRepo = null` constructor default "decided in implementation"; prefer removing it, and record the choice in the audit table.
- Decision 4 "remove any wildcard where feasible" is soft; the every-variant test (3.2) is the real guard - make sure it fails when a new ResolvedAction case is added (e.g. enumerate via sealed-subclass reflection).
- Task 3.6 mutation evidence should be pasted in the evaluator-visible output, not just claimed.
