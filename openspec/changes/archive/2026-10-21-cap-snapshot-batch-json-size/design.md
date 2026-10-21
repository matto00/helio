## Context

HEL-1660 (d622886da) bounds the run walk (`RunLimits`: rows, live cells with text priced by `CellWeight`, created-text
cap) and prices the post-walk JSON copies by cell count (`RunLimits.postWalkCells`, rows priced `columns + 6`, text not
priced). `NodeSnapshotRepository.overwriteRowsActionRendering` groups rows by `SnapshotInsertBatchSize = 200` and renders
each batch's `compactPrint` text lazily inside `DBIO.successful(()).flatMap(_ => insertBatch(batch))`; every `sqlu`
insert is already its own statement. `NodeSnapshotBatchedWriteSpec` pins "at most one batch rendered ahead of the
inserts" by row count. Run (`PipelineRunSucceededWrites.scala:119/146`) and backfill (`PipelineRunBackfill` ->
`overwriteRows`) both reach that method. `NodePayloadHistoryRepository.writeAction` (opt-in, beta/owner) renders
`JsArray(rows).compactPrint` for up to 1,000 rows and only then compares UTF-8 bytes to `PAYLOAD_HISTORY_MAX_BYTES`.

Skeptic-final-3 (HEL-1660) measured `fewrows-utf16-200` at 294 MB real vs 93.6 MB dry: the ~200 MB difference is the
write. 200 rows of ~280,000 characters (2 x 35,000 source + 3 concat results of ~70,000) render ~56M UTF-16 characters
in one batch, plus `StringBuilder` growth.

## Goals / Non-Goals

**Goals:** bound the text the snapshot write holds rendered at once by size, not rows; make the post-walk price see the
widest row the write must render whole; stop the payload write rendering past its own cap; pin all three with
deterministic, mutation-checked CI guards; measure the shapes red first and green after under `-Xmx768m`.

**Non-Goals:** new owner-facing limits or env vars; cross-run admission (HEL-1680); HTTP response serialisation;
any change to the SQL text, transaction boundaries or delete-then-insert atomicity; frontend.

## Decisions

**D1. Exact JSON length without rendering (`JsonTextLength`).** A small pure function over `JsValue` returns the exact
`compactPrint` character length and the UTF-8 byte length (both `Long`) in one scan that builds no text (spray's printer escapes `"`,
`\\`, control characters as `\uXXXX` or the short forms; numbers print via their `toString`). Pinned by a property-style
spec asserting equality with `compactPrint.length` / `getBytes(UTF_8).length` over adversarial values (control chars,
quotes, backslashes, surrogate pairs, lone surrogates (`getBytes(UTF_8)` writes `?`, 1 byte), Cyrillic, nested arrays/objects, big decimals). Alternative rejected: estimating
from string lengths alone underprices escaped control characters up to 6x.

**D2. Size-capped batches.** Batch boundaries are computed from `JsonTextLength` up front (no text built): a batch closes
when adding the next row would pass `SnapshotBatchMaxChars` or it holds `SnapshotInsertBatchSize` (200) rows, and always
holds at least one row. Each batch still renders lazily inside its deferred `flatMap`, so at most one batch's text is
alive: <= max(`SnapshotBatchMaxChars`, widest row). Starting value `SnapshotBatchMaxChars = 1,048,576` (= MaxStringChars);
the executor may lower it if measurement shows a need, never raise it without a measurement. Alternatives rejected:
rendering row by row then flushing (same bound, harder to reason about); one deferred action per row (breaks Slick's
fusion of synchronous inserts, a future hop per row on 100,000-row nodes).

**D3. A calibrated widest-row render limit (run and backfill), separate from `postWalkCells`.** The one thing a batch
cannot split is a single row, and `postWalkCells` has no text term, so pricing only a render "excess" against
`MaxPostWalkCells` (~179 MB on its own) would accept a ~31M-character row that peaks well over the share (design gate
round 2). Instead a run refuses any row whose exact rendered JSON (`JsonTextLength`) exceeds `MaxRowRenderChars`, a new
constant in `RunLimits` sized end to end by measurement at the JOINT worst the other limits allow: the heaviest
retained post-walk state (HEL-1660's `post-wide-4@3.9M`, 164.4 MB real, `archive/2026-10-19-bound-run-path-memory/
evidence/heap-post-3900000.summary.txt`) with one row at exactly `MaxRowRenderChars` added in its remaining walk headroom
(e.g. one long UTF-16 source cell, uncapped by `MaxStringChars`, in a column the step chain never touches), rendering.
Certification (heap modes swing: HEL-1660 recorded `post-wide-4@3.9M` at 164.3 / 133.1 / 164.4 MB, a 31.3 MB swing
against 27.6 MB of headroom): in one forked `-Xmx768m` JVM, >= 3 repeats each of a no-wide-row BASELINE (the same shape
without the wide cell) and the BOUNDARY shape; at least one baseline repeat must land in the high mode (>= 160 MB) or the
probe is re-run; the limit is certified only if (i) every boundary repeat is <= 192 MB AND (ii) the highest recorded
high-mode baseline (164.4 MB, or higher if measured) plus the largest measured boundary-minus-baseline delta of a paired
repeat is <= 192 MB. The remaining margin is stated. Planning estimate only (design gate round 3): ~3-4M characters.
- Floor (ruling 4 caps created text at 1,048,576 characters; it does not promise every such value is writable): the
  floor is the rendered length of a defined ruling-4 row, `{"v": <1,048,576 unescaped characters>}` = 1,048,584
  characters. If measurement puts `MaxRowRenderChars` below that floor, STOP and ESCALATE. Rows whose maximal values
  escape (control characters, up to ~6x) or carry many other columns may be refused; that is an accepted clean failure.
  `SnapshotBatchMaxChars` = min(1,048,576, `MaxRowRenderChars`), so a batch never renders more than the row limit allows.
- It is independent of `postWalkCells`/`MaxPostWalkCells` (both unchanged), and a row at or under 1,048,576 characters
  can never trip it, so `RunLimitsGuardSpec`'s AC6 pin (`cost(16, Seq(11)) == 3,900,000`), the `post-wide-*`/`post-tall-*`
  shapes and every HEL-1660 shape stay accepted unchanged.
- Rows checked: every row of every retained Output frame and of the terminal (the frames the success path renders).
  Engine rows are `Map[String, Any]`; each row's width is computed by a transient conversion through the same
  `PipelineRowJson.anyToJsValue` the writes use, then `JsonTextLength` (one row's structure at a time, strings shared, no
  text built), so the check and the write cannot drift. The D1 spec includes engine-row equality cases through
  `anyToJsValue` (Int/Long/Double/Float/BigDecimal/Boolean/null/nested Map/Seq/the `toString` catch-all).
- Run: checked in `refuseOverPostWalkBudget` (before any write), failing with the run-limit step error worded like the
  existing post-walk message (names the row width and the limit).
- Backfill (`PipelineRunBackfill.persistBackfilledRows`, which never reaches `refuseOverPostWalkBudget`): the exact
  comparison is `rows.exists(JsonTextLength(anyToJsValue row) > MaxRowRenderChars)`; when true it writes nothing and
  fails through the existing `.recover` -> `logExecutionFailure`. Backfill's other post-walk copies (its full JsObject
  conversion) stay unpriced, as today; recorded as a follow-up candidate.
This applies ruling 3 (192 MB share) through the ruled mechanism (clean failure); the threshold is a measurement-sized
constant like HEL-1660's `MaxLiveCells`, not a new kind of limit.

**D4. Payload write measures before rendering.** `writeAction` computes the node's exact UTF-8 bytes with
`JsonTextLength` (array brackets and commas included) and renders only when within `maxBytes`; an over-cap node is never
rendered. The outcome and the WARN text (including the exact byte count, now logged as a `Long`) are unchanged. The render is bounded by the
configured `maxBytes` (default 1 MiB; `PayloadHistoryConfig.scala:70` has a floor of 1 and no ceiling), so the share holds
at the default and for any operator value kept well under it; documented, not enforced.

**D5. Guards (deterministic, in `testFull`).**
- `NodeSnapshotBatchedWriteSpec`: a render-counting case with few long rows asserts rendered-but-not-inserted characters
  never exceed `SnapshotBatchMaxChars` + the widest row; the existing 450-row case stays green.
- `RunLimitsGuardSpec`: pins `MaxRowRenderChars` as a tripwire (`<=` the measured value), a row at exactly the limit is
  accepted and one character over is refused (deterministic, no heap), AC6 pin unchanged; a backfill spec shows the
  refusal writes nothing. Mutations: raise the limit; compare `>=`/off-by-one; skip the terminal or an Output frame.
- Payload repository spec: an over-cap node is never rendered (counting seam like `overwriteRowsActionRendering`).
- `JsonTextLength` equality spec (D1).
- Mutations recorded in `mutations.md`, each turning a named guard red: eager render; batch by count only; drop the
  widest-row term; payload renders before measuring; length off by one for an escape class.

**D6. Measurement (`RunPathHeapSpec`, opt-in `HELIO_MEASURE=1`, forked `-Xmx768m`, >= 2 repeats, one probe at a time).**
Shapes: `fewrows-utf16-200` (skeptic-final-3's), a ~20-row variant of the same total text (350,000-char cells, concat
results under the 1,048,576 cap), a 1-row variant (expected: clean concat text-cap failure; recorded), two joint-worst
shapes (D3: `post-wide-4@3.9M`'s retained state plus one wide row in its headroom): one row at exactly `MaxRowRenderChars` (must SUCCEED: certified per D3, >= 3 paired
repeats with the no-wide-row baseline) and one just above it (must be REFUSED with the run-limit step error), the 200-row shape with a history payload opted in, plus
every existing shape as a regression. The text-held
state (HEL-1660 `heavy-utf16`, ~102 MB) is not a separate boundary probe: it is dominated by `post-wide-4` (164 MB). The
green summary also records the per-row width check's own cost (wall time of the scan on the largest shape). Red first on unchanged code, summaries persisted under the change dir.

## Risks / Trade-offs

- [The length scan costs one extra pass over the node's text] -> no allocation, linear; cheaper than rendering.
- [`JsonTextLength` drifts from spray's printer on an upgrade] -> the equality spec fails in CI.
- [D3 refuses a currently accepted very-wide-row run] -> only rows wider than `MaxRowRenderChars` (>= the batch budget),
  whose render would pass the share; accepted under HEL-1660's rulings (share + clean failures).
- [The run's HTTP response renders the whole terminal frame (`RunResultResponse(jsRows, ...)`)] -> out of scope; listed
  as a follow-up candidate in the hand-back (the driver files follow-ups), naming BOTH reproducers: the 200-row long-text shape (`fewrows-utf16-200`) and the D3 wide-row boundary shape (`rowwidth-at-limit`). A row whose rendered JSON is wider than the certified `MaxRowRenderChars` is now refused with the run-limit step error.
- [Heap peaks swing between repeats (~23 MB seen in HEL-1660)] -> repeats recorded; margin stated.

## Planner Notes

- Self-approved: D3's `MaxRowRenderChars` is a measurement-sized run limit, like HEL-1660's `MaxLiveCells` and
  `MaxPostWalkCells`, enforcing ruling 3 (192 MB share) through the ruled clean failure; it needs no owner ruling.
  ESCALATE only for: a new env var; a change to an existing constant (`MaxLiveCells`, `MaxPostWalkCells`,
  `MaxStringChars`, `MaxNodeRows`) or the AC6 pin; or a `MaxRowRenderChars` below the ruling-4 floor above.
- Self-approved: D4 widens scope to the payload write because the same shape with a payload opted in would breach the
  share by the same mechanism; outcome unchanged.
- Premise: the row-count lazy-render guard already exists (HEL-1660's last commit); this change extends it to size.

## Measured Results (HEL-1679, filled by the executor; cycle 2 supersedes the cycle-1 certification at 4,000,000)

Heap numbers: forked test JVM `-Xmx768m`, `HELIO_MEASURE=1`, `nice -n 19`, one probe at a time under the sbtfull lock. **Certification is single-CPU**
(the forked JVM pinned with `taskset -c 2`), because production is Cloud Run `--cpu=1` with no GC flag, i.e. SerialGC (`maxMemory MB: 742` in every
single-CPU run, 768 under 12-CPU G1). The multi-CPU G1 runs of cycle 1 (`evidence/superseded/`) are NOT production-representative and do not certify:
the wide row's real cost is about 30 MB at 4,000,000 characters under the production collector, not the 5-10 MB G1 showed.

**Root cause (probe-confirmed, red on unchanged code).** `fewrows-utf16-200` real 294.8 / 294.8 MB, dry 93.6 / 93.6 MB (`evidence/red-fewrows-xmx768m.summary.txt`):
same walk, same frames, so the extra ~200 MB is the snapshot write's batch render. With size-capped batches the real run is within ~4 MB of the dry run.
`fewrows-utf16-20`: 256.4 / 256.4 red. Payload shape with the payload rendered first (M11): 361.6 MB (`red-payload-rendered-first-xmx768m.summary.txt`).

**`MaxRowRenderChars` = 2,000,000 (D3, amended C1).** Boundary: `post-wide-4@3.9M`'s retained state plus row 0's untouched column `b` of `中` (3-byte UTF-8) sized so
the terminal row renders to exactly 2,000,000 characters (`rowwidth-at-limit`); baseline is the same shape with a one-character cell (`rowwidth-base`).
Two JVM invocations x 12 repeats, 24 each (`evidence/cert-2000000-1cpu-jvm-{a,b}-xmx768m.summary.txt`), real MB:
- boundary JVM a: 114.9, 142.2, 138.4, 134.0, 145.8, 142.4, 129.4, 148.6, 154.7, 133.0, 150.1, 158.8
- boundary JVM b: 125.0, 149.8, 149.8, 119.4, 124.3, 149.8, 139.6, 158.5, 145.3, 150.1, 146.4, 158.6
- baseline JVM a: 140.3, 145.6, 123.5, 154.8, 111.9, 133.2, 142.8, 150.8, 138.4, 146.9, 122.3, 150.8
- baseline JVM b: 131.7, 132.6, 155.0, 155.0, 126.3, 131.5, 144.5, 142.5, 120.8, 138.6, 129.0, 134.4

Boundary max 158.8, baseline max 155.0, boundary mean 142.04, baseline mean 137.63, mean shift 4.40, max-vs-max shift 3.80. (i) every boundary repeat <= 192: yes (max 158.8).
(ii) 164.4 + max(4.40, 3.80) = 168.8 MB, **margin 23.2 MB**. No boundary repeat reached the 160 MB high mode; the 164.4 anchor (HEL-1660's recorded high-mode baseline)
in (ii) is what covers it, and (ii) is more conservative than the observed tail. 2,000,000 is above the 1,048,584 floor, so the ESCALATION condition does not apply.
`SnapshotBatchMaxChars` = min(1,048,576, 2,000,000) = 1,048,576.

**Listed shapes, single-CPU, full regression, 2 repeats** (`evidence/green-full-regression-1cpu-xmx768m.summary.txt`; maximum over all shapes 169.9 MB, the HEL-1660
`just-under-light@2600000` shape, bound 192; other maxima: ac6-ordinary 163.5, post-wide-4 146.7, post-tall-2 157.2, rowwidth-base 154.9), real MB per repeat:
`fewrows-utf16-200` 103.2, 101.2 (dry 93.5); `fewrows-payload-200` 108.3, 102.7; `rowwidth-at-limit` 134.0, 125.1 (succeeds); `rowwidth-over` 91.7, 91.8 (refused with the
run-limit step error); `fewrows-utf16-1` 0.1, 0.1 (refused by the concat text cap); `fewrows-utf16-1w` 6.7, 6.7 (refused by the row limit; the dry run succeeds);
**`fewrows-utf16-20` 96.0, 95.9: refused by the row limit** (its rows render ~2.8M characters; before this change it was accepted at 256.4 MB). Row-width scan: 38.7 ms best of 5
over 50,000 rows x 13 columns.

**Disclosure (C3).** A row whose rendered JSON is wider than 2,000,000 characters is now refused with the run-limit step error (`fewrows-utf16-20` and `fewrows-utf16-1w` shapes
were accepted before). The HTTP-response render and HEL-1660's limits (certified under multi-CPU G1; `post-wide-4@3.9M` is 134-153 MB single-CPU vs 130-133 G1) are follow-ups.
