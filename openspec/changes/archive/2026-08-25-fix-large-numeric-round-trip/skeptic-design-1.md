## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Read all artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/datatype-row-snapshot/spec.md`.

- **D1 mechanism is real** — unpacked
  `~/.cache/coursier/.../spray-json_2.13-1.3.6-sources.jar`:
  - `spray/json/JsonParserSettings.scala:51` — `maxNumberCharacters: Int = 100`;
    `:54` — `withMaxNumberCharacters(newValue)` exists.
  - `spray/json/package.scala:51` — `def parseJson(settings: JsonParserSettings)`
    overload exists. So `raw.parseJson(settings)` compiles as designed.

- **Boundary reasoning is correct, and the design is right to correct the ticket** —
  `JsonParser.scala:142`: `else if (numberLength <= settings.maxNumberCharacters) JsNumber(...)`.
  `<=` means length 100 passes and only 101+ throws. design.md's "ticket's '>=100' is an
  off-by-one; true boundary is 100 passes / 101 fails" is derived correctly from source.
  tasks.md 3.3 correctly requires the executor to *re-derive it empirically* (lengths
  99/100/101/102) rather than trust the doc. Good.

- **Defect site confirmed** — `DataTypeRowRepository.scala:73,80`: the query is
  `SELECT (data)::text ...` and the map is `_.map(_.parseJson.asJsObject)` — bare
  zero-arg `parseJson`, i.e. defaults. Single call site, as claimed.

- **D3 (test directly against the repo, not through the fan-out)** is sound and matches
  the HEL-373 precedent; `WorkspaceContextService.scala:342` does indeed fan out through
  `dataTypeService.listRows` over all DataTypes, which is exactly the poisoning vector.

- **Storage type checked** — `V29__data_type_rows.sql:5`: `data JSONB NOT NULL`. There is
  no `double precision` column anywhere in this path (grep of the migration).

- **Caller list checked** — `grep -rn "dataTypeRowRepo\.|listRows" backend/src/main/scala`.

### Verdict: REFUTE

D1's *shape* is right (scoped settings override beats both rejected alternatives, and the
rejections are argued correctly). But three factual claims in the artifacts are refuted by
the source tree, and two of them bear on ticket acceptance criteria.

### Change Requests

1. **design.md "Risks / Trade-offs", first bullet — the mitigation's premise is false, and
   the residual ceiling is understated.** It says "today's Structured-value numeric fields
   are backed by `double precision`/standard JSON number semantics; 400 chars is already
   ~30% headroom over the theoretical max-`double` plain-decimal expansion." Ground truth:
   `V29__data_type_rows.sql:5` stores `data JSONB`, and `overwriteRows`
   (`DataTypeRowRepository.scala:26-33`) inserts `row.compactPrint::jsonb` from an arbitrary
   `JsObject` whose `JsNumber` is `BigDecimal`-backed. Postgres `jsonb` numerics are
   `numeric` (arbitrary precision, exponent range far past `double`), so a perfectly
   writable value such as `1e400` — or a denormal like `5e-324`, whose `::text` expansion is
   ~325 chars — is *not* bounded by the max-`double` 309-digit figure the headroom argument
   rests on. As written, D1 moves a write-succeeds-then-read-throws data-loss ceiling from
   100 to 400 rather than establishing that no writable value can exceed it. Required:
   either (a) correct the risk bullet to state the real bound (Postgres `numeric` /
   `BigDecimal`, not `double`), justify 400 against what `overwriteRows` can actually
   *accept* today, and explicitly record the residual ceiling as a known limit; or (b)
   choose a cap/handling that is not falsifiable by a value the write path accepts. Add a
   corresponding task that empirically probes the small-magnitude direction too (a denormal
   / many-leading-zeros decimal), which the current sweep (3.4–3.6) does not cover — every
   listed case is large *integer part* or "high precision", none is a tiny-magnitude value
   whose expansion is long on the fraction side.

2. **proposal.md "Impact" — the caller list is wrong.** It asserts all of
   `PipelineRunService`, `BoundPanelService`, `PanelCapabilityService`, `DataTypeService`,
   `WorkspaceContextService` "all read through this one method". Grep shows
   `PipelineRunService.scala:523` and `BoundPanelService.scala:313` call **`overwriteRows`
   only** — neither calls `listRows`, so neither inherits the fix and neither is evidence
   for it. Actual `listRows` callers: `DataTypeService.scala:52`,
   `PanelCapabilityService.scala:46`, and `WorkspaceContextService.scala:342` (via
   `DataTypeService`). Correct the list; the ticket AC requires *findings reported*, and an
   inaccurate inherited-fix claim will propagate into the executor's report unchallenged.

3. **The sibling-path audit is incomplete and misses a live candidate with the same
   defect.** design.md Non-Goals claims the audit covered `DataTypeRepository`,
   `MetricRepository`, `PanelRowMapper` "etc." and that "none of them re-parse a
   `jsonb::text` cast of arbitrary Structured-value numeric data". Not audited:
   `AlertEventRepository.scala:31` — `value = row.value.parseJson` where
   `V61__alert_events.sql:29` declares `value JSONB NOT NULL`. That column holds the
   observed metric value sourced from the very same DataType rows, read back as text and
   re-parsed with the default 100-char settings — i.e. the identical failure mode. Audit it
   (and `AlertRuleRepository.scala:30`, `condition.parseJson`, on the same basis), and
   report the finding per the ticket's "sibling numeric round-trip paths are checked …
   findings reported" AC. Reporting is sufficient — do **not** widen the code change beyond
   `DataTypeRowRepository` without escalating first, per the ticket's own constraint.

### Non-blocking notes

- tasks.md numbering is broken: section `## 1. Backend` is followed by a `### Tests`
  subsection numbered `3.1`–`3.9`, with no section 2 or 3 heading. Renumber for legibility.
- `scripts/concertino/next-report-number.sh` does not exist in this worktree (only
  `assert-phase/cleanup/setup-worktree/start-servers` are present); I ran the canonical copy
  from the main checkout at `/home/matt/Development/helio/scripts/concertino/`. Not a
  blocker for this gate, but the executor/evaluator will hit the same gap.
- The spec delta (`specs/datatype-row-snapshot/spec.md`) is well-formed and its four new
  scenarios map 1:1 onto tasks 3.4–3.7. If CR#1 lands, add a scenario (or an explicit
  documented-limit statement) for the small-magnitude/denormal case.
