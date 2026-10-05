## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 32571b0166a25b127a27bec645b7e2aec11b3c2b (the change directory is untracked; there are no code changes yet).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/content-keyed-root-encoding-exemptions/hel-1282`.
- **Current guards are green on this tree:** `node scripts/check-node-root-encoding.mjs` reports clean (3 files), `.ts.mjs` reports clean (41 files), and both selftests exit 0.
- **The artifacts' hit, line and scope claims are correct.** I enumerated hits independently with a scratch scanner that uses the scripts' exact regexes, skips comments, and treats the nearest preceding `def`/`function` as the scope:
  - NodeSnapshotRepository:130 `overwriteRowsAction`, :178 `listRows`, :202 `nodeFilterFragment`
  - BinaryRefRepository:49 `overwriteForNode`, :108 `findByNodeAndRow`, :128 `selectQuery`
  - context.ts:222 `buildOutputSummariesByPipeline`
  - That is 6 Scala hits plus 1 TS hit, all currently exempt, and 0 hits in OutputRepository. Every scope name in design.md and tasks.md matches.
- **The two identical texts exist.** :178 and :202 are identical once whitespace is normalised; only the scalafmt `=>` alignment differs.
- **CI wiring:** these scripts run at `.github/workflows/ci.yml:40-43`. `.husky/pre-commit` does not invoke them (grep found nothing), so the claim in the Gate-Chain section holds.
- **The resemblance cases listed in D2 hold:**
  - A copy in the same scope goes red through the surplus count.
  - A copy in another scope or file has no matching key and goes red.
  - Different text has no key and goes red.
  - A scope misattribution makes the exemption stale (red); it cannot exempt a line by accident.
- **Counterexample that defeats the design (reproduced, see Change Request 1).** In a scratch copy of BinaryRefRepository.scala, I deleted the `(None, Some(rid))` arm of `selectQuery` (original lines 120-124) and widened `case (None, None) =>` to `case (None, _) =>`. Every root-bound call carrying a real root id now runs the bare `node_step_id IS NULL` query, which is R12's named root-mixing bug.
  - **Old line-keyed guard:** red, because the line shifted. Output: `BinaryRefRepository.scala:123: standalone node-root-NULL encoding ("WHERE pipeline_id = $pipelineId AND node_step_id IS NULL""")`.
  - **Planned key on the same mutation:** file `BinaryRefRepository.scala`, scope `selectQuery`, text `WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"""`, count 1. My scanner shows 1 hit in scope `selectQuery` with identical normalised text, so hits equals count and the line is exempt. **Green.**
  - **Other sites with the same shape:**
    - NodeSnapshotRepository:130 (`overwriteRowsAction`, a production DELETE path, where this mutation would wipe sibling roots' snapshots).
    - BinaryRefRepository:108.
    - In all three, the line that carries the hit is separate from the `case (None, None) =>` line that the exemption proof depends on.
  - **Sites already safe:** for the three single-line arms (:178, :202, BinaryRef:49), `case (None, None)` is part of the keyed text, so widening the pattern does turn them red.
- **Text vs marker (D1):** the reasoning holds. A marker gets copied along with the line, so both approaches need the count bound. Text keying leaves Scala sources untouched, which avoids conflicts with HEL-1276. I accept this trade-off, apart from the gap in Change Request 1, which affects markers equally.
- **Covering the TS sibling (scope question 3):** justified. It has the same `file:line` keying (context.ts:222) and the same breakage mode, the owned files allow it, and the work is small.
  - I checked whether content keying weakens the TS proof. The exemption's safety rests on the next line, `rootId: o.rootId ?? null,`.
  - `WorkspaceContextOutputSummary.rootId` is required (`context.ts:159`, `rootId: string | null;`), and the object literal uses `satisfies`. Deleting that line therefore fails `tsc`, so the TS side is covered outside this guard.
- **Selftest plan (D5 / tasks 3.x):** it covers the driver's three cases plus duplicate, stale and whitespace cases, and asserts on content. Task 3.2's mutation proof is underspecified (Change Request 2).

### Verdict: REFUTE

### Change Requests

1. **Close the governing-arm gap, or the main design claim is false.** design.md D2 says "This is how a new unsafe line resembling an exempt one goes red". It names only "delete + re-add in the same declaration" as residual risk.
   - The counterexample above has no new line at all. A proof-invalidating edit to the `case` pattern that governs a multi-line exempt site stays green under the planned key. Today's guard catches this (incidentally, through the line shift).
   - For 3 of the 6 sites (NodeSnapshotRepository:130, BinaryRefRepository:108 and :128), the planned key loses the one fact the exemption proof is about: "this is the `(None, None)` arm".
   - **Required revision:** add the governing match arm to the key.
     - New key field `arm`: the whitespace-normalised text of the nearest preceding non-comment line in the same scope that matches `^\s*case\b.*=>`.
     - For single-line arms, this is the hit line itself.
     - Every current Scala entry then pins `case (None, None) =>`. Widening or removing the arm makes the entry stale and the hit unmatched, so the check goes red.
   - Update D1, D2, D3 and the spec's "Exemptions are keyed on line content" requirement to name this field, with a scenario: "governing case pattern of an exempt site changes → guard fails".
   - Add a D5/3.1 selftest case: widen `case (None, None) =>` to `case (None, _) =>` (and delete the `(None, Some(rid))` arm) at BinaryRefRepository `selectQuery` and at NodeSnapshotRepository `overwriteRowsAction`. Expect red.
   - **Alternative, if the planner rejects arm keying:** D2's residual-risk section must state this case explicitly as an accepted regression against today's guard, with a justification. That decision would arguably need owner sign-off, because it weakens the guard on a production DELETE path. The arm field is cheap, so I recommend it.

2. **Make the mutation proof in task 3.2 specific and complete.** "Revert to line-number keying (or disable the count bound)" is an either/or. Each half proves only part of the selftest. Replace it with a table of mutations, each paired with the selftest case(s) that must turn FAIL:
   - line-number keying → (a) line-shift and whitespace cases fail;
   - count bound disabled (exempt on any key match) → (b') fails;
   - scope dropped from the key → (b'') fails;
   - stale check disabled → (stale) fails;
   - (after CR1) arm dropped from the key → the arm-widening case fails.
   - For each mutation, record the red output in the report and restore the file with exact-path `git checkout -- <file>`.
   - Do the same for the TS selftest: at least the count-bound and line-keying mutations.

3. **Specify how stale entries surface through the existing API (D4).** `scanTextForViolations(relPath, text, exemptions?)` returns one array, and the entry point exits non-zero only when that array is non-empty. State that stale-exemption messages go into the same returned array, filtered to entries whose `file === relPath`. Without this, an implementer could log stale entries and still exit 0.
   - Also state what happens to entries for a TARGET_FILE that is ENOENT. The current entry point silently `continue`s past missing files, so a renamed or deleted NodeSnapshotRepository.scala would leave its entries unevaluated. Either report them as stale, or record this explicitly as accepted.

### Non-blocking notes

- D2 says the delete-and-re-add case "necessarily rewrites the very method the exemption's proof is about". That is slightly overstated. Scope is "nearest preceding `def`", not true lexical enclosure, so a `val` or `object` member added after an exempt method with no `def` falls into that method's scope. It still requires deleting the exempt line, so the risk is low. Reword it as "the nearest preceding `def`".
- Selftest (b), "new method → exactly 1 violation": insert the new method somewhere other than between an exempt site's `def` and its hit. Otherwise the scope changes, the case also produces a stale or unmatched result, and the "exactly 1" assertion becomes confusing.
- Task 5.3 lint scope: `npm run lint` is `eslint .` and `format:check` is `prettier . --check`. Both already cover `scripts/*.mjs`, so the "whatever the repo's pre-commit runs" hedge can name these two commands directly.
- Keep the existing HEL-913 proof comment block. Only the three remap paragraphs (HEL-1027/1188/1271) should go, as task 2.1 already says.
