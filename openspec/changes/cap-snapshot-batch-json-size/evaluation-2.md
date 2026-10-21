## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `7781503060d9fca0c539a7ff4e222c559710d4e0`. This review covers the diff since `d3b27663c` and was re-checked against the live base `e88acadb9`. The change is backend only, so Phase 3 does not apply.

### Phase 1: Spec Review — PASS

Evaluation-1 change requests:
- **CR1 (lower and re-certify): addressed.**
  - `RunLimits.MaxRowRenderChars` is now 2,000,000, and the `RunLimitsGuardSpec` tripwire is 2,000,000.
  - Certification evidence is in `evidence/cert-2000000-1cpu-jvm-{a,b}-xmx768m.summary.txt`: 2 JVMs x 12 repeats = 24 boundary and 24 baseline repeats, all with `maxMemory MB: 742` (single CPU, SerialGC).
  - I recomputed the figures from those files:

    | Measure | Boundary | Baseline |
    |---|---|---|
    | Mean | 142.04 | 137.63 |
    | Max | 158.8 | 155.0 |

    - Mean shift: 4.40. Max-to-max shift: 3.80.
    - Rule: 164.4 + 4.40 = 168.8 MB.
    - The executor's stated figures are correct.
  - **Amended C1 is met:** at least 20 repeats each, at least 2 JVMs, single CPU, every boundary repeat ≤ 192, and 168.8 ≤ 192.
- **CR2 (inline FQNs): fixed.**
  - `PipelineRunLimitsServiceSpec.scala` now imports `java.nio.file.{Files, Paths}`.
  - `JsonTextLengthSpec.scala` now imports `java.math.{BigDecimal => JBigDecimal}`.
- **CR3 (duplicated frame selection): fixed.**
  - A private `RunLimits.retainedFrames` is now used by both `postWalkCells` and `widestRetainedRowChars`.
  - Behavior is preserved. The terminal-first seeding is identical for both callers, because `postWalkCells` only filters the terminal back out with `filterNot(_ eq terminalRows)`. M7, M8, the AC6 pin and the full suite are green.
- **CR4 (proposal): fixed.** `proposal.md` "What Changes" and "Impact" now describe the separate `MaxRowRenderChars` limit.
- **CR5 (C3 on disk): fixed.** `design.md` (Risks) and `tasks.md` 2.10 name both `fewrows-utf16-200` and `rowwidth-at-limit`. The "Disclosure (C3)" paragraph in `design.md` states that a row wider than 2,000,000 rendered characters is now refused, and names `fewrows-utf16-20` and `fewrows-utf16-1w` as shapes that were accepted before.

Standing constraints: C1 (amended) holds, C2 holds (the boundary cell is still `中`), and C3 holds as recorded.

**Is refusing the ~20-row shape consistent with AC1 and the HEL-1660 rulings? Yes. This is not an owner question.**
- **AC1 is met.** AC1 requires that every listed shape "stays at or under 192 MB peak". The refused `fewrows-utf16-20` peaks at 96.0 and 95.9 MB. The ticket already planned the 1-row shape as a clean refusal, so AC1 anticipated refusals.
- **The rulings cover it.** Ruling 3 is the share. The other ruling is "a run over a limit fails with a step error worded as a pipeline run limit; clean failures are accepted". The refusal is exactly that step error: "Pipeline run memory limit reached ... Shorten the text in the row, or drop its widest columns". It happens before any write.
- **The design gate already accepted this class of refusal.** D3's floor clause says rows that "carry many other columns may be refused; that is an accepted clean failure". The guarantee the floor protects still holds: a row holding one ruling-4 value (1,048,584 rendered characters) is writable under 2,000,000. Each row of the 20-row shape holds five long values, about 2.8M characters in total. On main that shape was accepted at 256.4 MB, over the share.
- **It matches the ticket's own note.** The ticket suggests "pricing the snapshot write by its JSON length ... so new shapes are refused instead of discovered".
- **Choosing 2,000,000 over 4,000,000 is calibration, not product.** The limit is a measurement-sized constant inside the design's self-approval, and 4,000,000 is shown not to hold.

### Phase 2: Code Review — PASS

Gates, all fresh runs of mine on `7781503`:
- `sbt testFull` (under the sbtfull flock, `nice -n 19`): 674 suites, 9406 succeeded, 0 failed, 5 canceled. The 5 canceled are the opt-in `HELIO_MEASURE` specs. Exit 0. Log: `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/eval1679/testfull-2.log`.
- `check:scala-quality`: clean, soft size warnings only.
- `check:openspec`: clean.
- `format:check`: clean.

Code: the cycle-2 diff is small and correct. It contains the constant change, the shared `retainedFrames` and the import fixes. The cycle-1 review of the rest of the change still stands.

**Independent certification probe** (same spec, `HELIO_RUN_HEAP_ONLY=rowwidth-at-limit,rowwidth-base`, 12 repeats, forked `-Xmx768m`, `taskset -c 7`, `maxMemory MB: 742`). Log: `.../scratchpad/eval1679/probe-2m-1cpu.log`, verbatim:
```
repeats rowwidth-at-limit  real MB 141.0, 142.2, 138.2, 145.7, 142.2, 154.4, 146.3, 153.6, 138.7, 142.2, 120.9, 150.7
repeats rowwidth-base      real MB 136.3, 119.0, 149.4, 154.6, 138.3, 150.9, 128.9, 112.5, 150.8, 141.5, 151.1, 154.9
max over shapes MB: 154.9 (bound 192.0); maxMemory MB: 742
```
- Boundary: max 154.4, mean 143.0.
- Baseline: max 154.9, mean 140.7.
- Mean shift: 2.3 MB.

This reproduces the executor's result.

**On the missing ≥160 MB mode.** No boundary repeat at 2,000,000 reached 160 MB, either in the executor's 24 repeats or in my 12. At 4,000,000 my probe reached 170-190 MB. That gap is expected: the boundary's high readings come from the wide row's render transient, which roughly halves at 2,000,000. Amended C1 deliberately replaced the "a boundary repeat must hit ≥160" clause with the 164.4 MB anchor, and the anchor is the conservative stand-in for the high mode. It is above every baseline repeat measured here: 155.0 maximum over 48 runs.

I do not take the measured 2.3-4.4 MB shift at face value, though. The sampled peak catches a shorter render transient less often. A conservative cross-check scales my own 4,000,000 single-CPU shift linearly (mean 30.2, max-to-max 35.0) down to 2,000,000, giving about 15-17.5 MB. Then 164.4 + 17.5 = 181.9 MB, which is still under 192 by about 10 MB. That is consistent with the analytic render cost:
- 4 MB for the UTF-16 rendered string
- up to about 8-12 MB of StringBuilder growth
- 6 MB of UTF-8 for the driver

So the 192 MB share is credibly held at 2,000,000 even under the pessimistic reading. The honest margin is about 10 MB, not the 23.2 MB the C1 formula yields (see suggestions).

### Phase 3: UI Review — N/A
Backend-only diff (no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`).

### Overall: PASS

### Non-blocking Suggestions
- `design.md` "Measured Results": next to "margin 23.2 MB", add the conservative cross-check above. Scaling the 4,000,000 single-CPU shift (about 30 MB) to 2,000,000 gives 164.4 + about 17.5 = about 182 MB, a margin of about 10 MB. That way the next reader does not overestimate the headroom. The formula result is correct as written; it is the headroom it implies that reads as larger than the evidence supports.
- Follow-up for the driver, already listed by the executor and worth prioritising: some HEL-1660 shapes now sit higher in the single-CPU regression (`evidence/green-full-regression-1cpu-xmx768m.summary.txt`):

  | Shape | Single-CPU result |
  |---|---|
  | `just-under-light@2600000` | up to 169.9 MB |
  | `ac6-ordinary` | 163.5 MB |

  Both are under 192, but closer than their G1-era certification recorded.
