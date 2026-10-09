## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD b409172a53ebe6f80db154847cb1b85c286293e1 (= base; change dir untracked, no commits yet).
Base file: `git -C <wt> show b409172a:backend/src/main/scala/com/helio/domain/model/model.scala` → scratch copy.
sbt not run (design gate, concurrent lanes).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/split-model-appearance-types/HEL-1376`.
- **Artifacts present:** ticket.md, proposal.md, design.md, tasks.md, `.openspec.yaml` (`schema: spec-driven`, `skip_specs: true`), workflow-state.md, skeptic-design-1.md.
- **Round-1 CR1 (range) — fixed.** I printed the base lines myself: 1306 lines; 3 `import ...RequestValidation`, 7 `import org.slf4j.LoggerFactory`, 8 `import spray.json._`; 205 blank; 206-209 four leaf case classes; 210-216 `ChartAppearance(...)` ending `)`; 217 blank; 218 `PanelAppearance(...)`; 219 blank; 220 `object ChartAppearance {`; 373 `  )`; **374 `}`**; 375 `DashboardLayoutItem`; 383/390 `object DashboardAppearance` / `object DashboardLayout`; 398 blank; 399 `object PanelAppearance {`; 406 `private val log = LoggerFactory.getLogger(getClass)`; 491 `}`; 492 blank; 493 `Dashboard(`. design.md Context/D1/D3 and tasks 2.1/2.2 now all say 220-374 / 375-398 / 399-491. Correct everywhere.
- **Round-1 CR2 (javap signal) — fixed.** D6b now allows exactly one `Compiled from` line per class with a positive per-D1 file mapping, `$anonfun$` lines byte-identical, no other filtering, precedent filter explicitly not reused; C4 and task 3.2 mirror it. The D6b class list (6 classes + 6 companions + 4 `Patch`/`Patch$`) matches exactly the 16 class files I found for these types in the main checkout's build (`backend/target/scala-2.13/classes/com/helio/domain/model/`) — no nested/anonymous class is missing from the dump list, and the class-name-set check covers anything else.
- **Round-1 CR3 (blank coverage) — fixed.** D6a exempts blank base lines from coverage while the positional reverse walk still fails on any extra/missing/altered non-blank line. Consistent with D2/D3.
- **Import claims:** in the moved spans, `RequestValidation` appears at 269 (comment), 301, 424 (comment), 433, 439, 445; `LoggerFactory` only at 406; no other model.scala top imports (`SchemaField`, `Instant`, `ContentType(s)`) are referenced in 206-491. `spray.json._` is still needed by kept code (`QueryParams` at 577-610 with `RootJsonFormat`/`JsValue`). The moved code needs `spray.json._` for `JsObject/JsString/JsNull/JsBoolean/JsNumber/JsArray/JsValue/deserializationError/DeserializationException` — D1 gives both new files that import. No local imports inside the moved spans.
- **Same-file constraints:** no `sealed` trait is declared in or extended by the seam (all 18 sealed traits in model.scala are outside 206-491); no top-level `private`/`implicit` decls in model.scala; each case class moves with its companion. Splitting cannot break sealed-hierarchy or companion rules.
- **Consumers:** `PanelProtocol.scala:225-230` `jsonFormatN(X.apply)` for all six types (verified); `panelAppearanceResponseFormat` at 233 and `PanelAppearanceResponse.fromDomain` at 193-194 exist, so D5's response golden is buildable with production implicits (`JsonProtocols` mixes in `PanelProtocol`, line 95). All 33 referencing files are same-package or import from `com.helio.domain.model`; `api/package.scala` only aliases protocol payload/response types. `PanelAppearanceMergeSpec` is package `com.helio.domain.model` with explicit same-package imports, so it compiles with zero edits.
- **Path-coupled tooling:** `scripts/check-schema-drift.mjs:27` and the two `canonical*DriftGuard.test.ts` read model.scala only for `PanelType.fromString` / `CanonicalWireValues` (kept spans). No scalafmt config exists, so there's no formatter to rewrite moved bytes. `check-scala-quality.mjs` hard-fails only on inline FQNs. The file-size rule is soft. Both new files (~171 / ~101 lines) fit the 250 budget.
- **README claim:** `domain/model/README.md` omits `Connector.scala`, `ConnectorCompletionToken.scala`, `StepGroup.scala`, `WriteBackSink.scala` (verified with `ls`). The planner now addresses this explicitly (Planner Notes + task 2.4), so it is no longer folded in silently.
- **Does the evidence plan prove preservation and catch a real regression?** Yes:
  - The byte-move checker (forward + positional reverse + coverage, two red runs) catches any altered body, default, doc or reorder.
  - javap with positive file mapping catches signature, arity, class-name and logger-FQCN drift (the logger uses `getClass` of the unchanged `PanelAppearance$`).
  - Goldens committed green on base before any move catch wire and `Default` drift that javap can't see, including the HEL-1304 chartless-panel patch case. Their red run mutates `ChartAppearance.Default`, which is in a golden.
  - Per-suite count equality catches a suite silently not running.
  - `git diff -- backend/src/test` enforces "only the added spec".
  - Every layer has a red run that targets that layer.
- **ACs → tasks:** AC1 → C1, C5, 3.3, 3.4. AC2 → D5, 1.3, D6b, compile. AC3 → D6d, 2.4. No placeholders or TBDs, no contradictions between proposal, design and tasks, no scope beyond the ticket.

### Verdict: CONFIRM

### Non-blocking notes

- **Cross-repo pointer comments to `ChartAppearance.Default`'s location** go further out of date with this move:
  - `helio-mcp/src/helioApi.ts:180` (`backend/.../domain/model.scala`)
  - `frontend/src/theme/appearance.ts:16` (`domain/model.scala`)

  Both have already been wrong since HEL-633 moved the file to `domain/model/model.scala`. The non-goals forbid comment edits outside `domain/model/`, so list both in 3.5 as a follow-up candidate. They are not fixed here. This also slightly qualifies proposal.md's "no frontend or helio-mcp impact": there is none at code level, but two doc pointers go stale.
- `domain/model/README.md` says "No behavior belongs here beyond simple, total companion helpers". The appearance decode/merge logic already contradicts that at base. That is a follow-up candidate alongside the `RequestValidation` layering smell.
- Compiled classes for this repo were observed under `backend/target/scala-2.13/classes/`. D6b says "sbt 2 output dir", so the executor should record the actual path it dumped from in api-evidence.md.
- model.scala after the change = 1306 - 2 - 11 - 1 - 155 - 93 = 1044 before blank tidying (about 1040 after). That is a sanity check, not an acceptance number.
- Correction to round 1's report: it cited `QueryParams` at 336-352. At base that range is inside `object ChartAppearance`; `QueryParams` is at 577-610. Its conclusion (`spray.json._` stays in model.scala) still holds.
