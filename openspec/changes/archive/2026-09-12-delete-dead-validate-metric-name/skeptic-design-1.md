## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/delete-dead-validatemetricname/HEL-1126`.
- Read ticket.md, proposal.md, design.md, tasks.md, .openspec.yaml (`skip_specs: true`).
- Fresh repo-wide `grep -rn validateMetricName` (excluding node_modules/target/.git) at HEAD 9d06ed8a: the only code hit is the definition at `backend/src/main/scala/com/helio/api/http/RequestValidation.scala:144`. Every other hit is in archived openspec docs or this change's own artifacts. No test references it. Zero-callers claim holds.
- The scaladoc at lines 140-143 belongs only to this method (it says "currently unreferenced"), so deleting lines 140-148 is clean. The next member, `normalizeText` (line 149), is separate and stays.
- No references to `RequestValidation` in `scripts/` or `.github/` outside concertino, so there is no obvious pinned baseline. Task 2.3 still covers re-running the CI checks.
- `ExpressionEvaluator.validateTolerant` is explicitly out of scope in the proposal, the design and task 1.3.
- Each ticket AC maps to a task: grep -> 1.1, removal -> 1.2, tests -> 1.4, validateTolerant -> 1.3, compile/test -> 2.1/2.2, CI scripts -> 2.3. No scope drift, no placeholders, no contradictions. No API or schema change, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes
- `private def normalizeText` directly follows the deleted block. Make sure its blank-line spacing stays tidy after the deletion.
