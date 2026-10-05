## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 32571b0166a25b127a27bec645b7e2aec11b3c2b. The change directory is untracked and there is no code change yet.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/content-keyed-root-encoding-exemptions/hel-1282`.

- **Round-1 CR1 (governing arm) is addressed in the artifacts.**
  - D1 adds the `arm` field, D2 adds the arm-widening bullet, and D3 defines how the arm is tracked.
  - The spec has the requirement text plus the scenario "Governing match arm of an exempt site changes".
  - D5 has the (arm) case, and tasks 2.2 and 3.1 carry it through.

- **I checked the revised key on the real files.** I wrote a scratch simulation of D1-D3 (current regexes, comments skipped as `//` and `*`, scope from `\bdef\s+(\w+)`, arm from `^\s*case\b.*=>`, normalised text).
  - All 6 Scala hits appear with the scopes design.md names.
  - The multi-line sites (NodeSnapshot:130, BinaryRef:108, BinaryRef:128) get arm `case (None, None) =>`.
  - The single-line sites (NodeSnapshot:178, NodeSnapshot:202, BinaryRef:49) get arm = hit text.
  - Round 1's counterexample: in `selectQuery`, delete the `(None, Some(rid))` arm and widen to `case (None, _) =>`. The hit's key becomes `arm: 'case (None, _) =>'`, so no entry matches and the `(None, None)` entry goes stale. **Red, as D2 claims.**
  - The arm field also catches a case the round-1 key would only have caught via the count: dropping `AND root_id = $rid` from a multi-line `(None, Some(rid))` arm. That produces identical hit text but arm `case (None, Some(rid)) =>`, so the hit is unmatched.

- **Round-1 CR2 (mutation table) is addressed.** D5 has the 5-row table with named failing cases, and the procedure is an exact-path `git checkout -- scripts/check-node-root-encoding.mjs`. Task 3.2 requires EVERY row.

- **Round-1 CR3 (stale surfacing) is addressed for the Scala guard.**
  - D4 puts `stale exemption:` messages in the same returned array, filtered by `file === relPath`, so the existing non-empty → `process.exit(1)` path covers them.
  - ENOENT with entries now calls `scanTextForViolations(relPath, "")`, which reports every entry as stale.
  - I checked this against the real entry point (`scripts/check-node-root-encoding.mjs`, the `if (e.code === "ENOENT") continue;` in the main block). The plan replaces that silent skip.
  - **It is not addressed for the TS sibling** (Change Request 2).

- **Counterexample: a newly-unsafe line passes silently (reproduced).** D3 says comment lines are those whose trimmed text starts with `//`, `*` **or `/*`**, and calls this "unchanged behaviour".
  - Today both guards skip only `//` and `*`: `scripts/check-node-root-encoding.mjs` (`if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;`), and the same line in `scripts/check-node-root-encoding.ts.mjs`.
  - Probe input: a new line in OutputRepository.scala:
    `      /* HEL-9999 */ sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"`
  - Today's `scanTextForViolations` returns **1 violation**. I ran it twice with the same result; this is deterministic string logic.
  - Under D3's rule the trimmed line starts with `/*`, so it is classed as a comment and skipped: **0 violations, green.**
  - So this is an unexempted standalone root-NULL DELETE that today's guard catches and the planned guard passes silently. It also contradicts the proposal ("No change to the detection regexes") and the Non-Goals.
  - No such line exists on the tree today (grep found none), so main's whole-file hit parity still holds. The rule itself is weaker, though.

- **Shadowing variant (not caught, and not a regression in kind).** I inserted `val explicitRootId: Option[String] = None` above `val deleteAction` in `overwriteRowsAction`. The hit keeps the key `(overwriteRowsAction, case (None, None) =>, text)`, so it stays green, while every root-bound call now takes the bare DELETE.
  - Today's guard catches this only through the line shift.
  - It misses the in-place equivalents just as the new guard does, e.g. `(nodeStepId, Option.empty[String]) match` on the existing scrutinee line.
  - It is not a resembling line and not a hit, so it is outside the ticket's anti-resemblance claim. But D2's "Residual risk, stated" reads as the complete list and does not mention it (Change Request 3).

- **TS sibling.**
  - context.ts:222 `nodeStepId: o.nodeStepId ?? null,` sits in `buildOutputSummariesByPipeline`, and `rootId: o.rootId ?? null,` follows on the next line.
  - The TS entry point scans only the files `listTsFiles(SRC_ROOT)` finds (it walks the directory). It has no TARGET_FILES list and no ENOENT branch.

- **CI wiring:** `.github/workflows/ci.yml:40-43` runs the four `npm run check:node-root-encoding*` scripts (`package.json:29-32`). `.husky/` does not reference them (grep: no hits).

### Verdict: REFUTE

All three round-1 change requests are addressed for the Scala guard, and the arm key closes round 1's counterexample. The revision still has one stated-but-false "unchanged behaviour" claim that weakens detection, and one spec scenario the TS plan cannot satisfy. Both are small, specific fixes to the artifacts.

### Change Requests

1. **D3 comment rule: either keep it exactly as today, or own the change.**
   - D3 lists `/*` as a comment prefix and calls it unchanged behaviour. Today's code skips only `//` and `*` (both scripts' `scanTextForViolations`).
   - With `/*` added, a line like `/* note */ sqlu"... node_step_id IS NULL"` passes silently (probe above).
   - **Required:** change D3 to "trimmed starts with `//` or `*` (exactly today's rule)".
   - Add a D5 selftest case: a code line with a leading `/* ... */` and a hit → red. That pins the rule against later drift.
   - If the planner deliberately wants `/*` skipped (e.g. so `/**` Scaladoc openers are not scanned), it must say so as a detection change. In that case, only skip a `/*` line when the comment does not close on that line followed by code.

2. **Missing-file stale reporting for the TS sibling (round-1 CR3, second half, not carried over).**
   - The spec scenario "Exempted file missing … the guard fails and names each of that file's exemptions as stale" is written for "the guard" generally.
   - D4's mechanism hangs on the Scala TARGET_FILES ENOENT branch. The TS entry point (`scripts/check-node-root-encoding.ts.mjs`) has no such branch: it only scans what `listTsFiles` finds.
   - So if `helio-mcp/src/context.ts` is renamed or deleted, its entry is never evaluated, and the TS run exits 0 with a dangling entry.
   - **Required:**
     - D4 states that the TS entry point evaluates, after the scan, every table entry whose `file` was not among the scanned files, by calling `scanTextForViolations(file, "")` so those entries report stale.
     - Task 4.1 implements it.
     - Task 4.2 adds a stale case and a missing-file case to the TS selftest, and adds "stale check disabled" to the TS mutation list.
   - **Alternative:** restrict the spec scenario to the Scala guard and record the TS gap as accepted in D4. Do not leave the spec and plan silently disagreeing.

3. **Complete D2's residual-risk statement.**
   - D2 currently names only the same-declaration delete-and-re-add. Add one sentence: a proof-invalidating edit that touches neither the hit line nor its governing arm is not caught by this guard.
     - Examples: rewriting or shadowing the match scrutinee (e.g. a new `val explicitRootId: Option[String] = None` above the match), or a caller passing `None`.
   - State that today's guard catches the line-adding forms of this only incidentally, through the line shift, and misses the in-place forms. Accepting this is unavoidable without keeping the line-shift false positives this ticket removes. The guard stays a text-level net under the HEL-913 proof, whose load-bearing fact is "a caller must say `None` out loud".
   - This is documentation only. No mechanism is required.

### Non-blocking notes

- D5 (b) and the anti-resemblance bullets are sound. My simulation confirms that a duplicate of a single-line site in another scope is unmatched, because scope is part of the key, even though its arm and text equal another site's.
- Task 5.3: also run both selftests after `npm run format:check`. Prettier can rewrap the exemption-table text literals in the scripts; text inside a string literal is safe, but confirm.
- Scratch files I created (`probe1282.mjs` and `sim1282.mjs` under the session scratchpad) were removed by exact path.
