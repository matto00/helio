## Skeptic Report — design gate (round 1, skeptic-design-2.md)

### Note on report numbering

`next-report-number.sh` (see Environmental note below) returned `skeptic-design-2.md` because
`skeptic-design-1.md` already exists in this change directory, timestamped *after* this review began —
i.e. a prior skeptic pass for this same round actually did complete and write a report, contradicting
the framing that it "never produced a report file." I read `skeptic-design-1.md` after discovering it
and independently re-verified its central claims against the same primary source files below before
including them here; this report is my own conclusion, not a relay of the other agent's narrative. The
two passes converge on the same overall verdict and substantially the same root causes, which is exactly
the kind of reproduction the evidence-discipline law asks for before trusting a surprising result.

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-proposal-analyze-api/spec.md` in full.
- Read the referenced ground-truth files directly, in full or via targeted `grep`/`sed`:
  - `backend/src/main/scala/com/helio/services/PipelineService.scala` — confirmed `analyze()`'s real
    shape (resolve source schema → `PipelineAnalyzeService.PipelineStepInput` →
    `PipelineAnalyzeService.analyze` → `toAnalyzeStepResponse`), and that `toAnalyzeStepResponse(s:
    PipelineAnalyzeService.AnalyzedStep): AnalyzeStepResponse` (line ~211) already takes only a single
    `AnalyzedStep`, not a persisted `Pipeline` — it needs no factoring to be reused from a new
    `analyzeProposal` method on the same class (tasks.md §2.4's framing is imprecise here; not blocking).
  - `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — confirmed it's a pure
    function (`Vector[PipelineStepInput] => Vector[AnalyzedStep]`, no DB/IO), so "reuse verbatim" is
    accurate.
  - `backend/src/main/scala/com/helio/services/SourceService.scala` — confirmed `inferSql`/`inferRest`
    call exactly `SqlConnector.checkQuery` → `SqlConnector.inferSchema` / `RestApiConnector.inferSchema`
    as design.md D2 claims; confirmed `SqlSourceConfigPayload.toDomain` cannot fail (bare `SqlSourceConfig`)
    while `RestApiConfigPayload.toDomain` returns `Either[String, RestApiConfig]` (can fail — a Left case
    design.md doesn't spell out but which mirrors `inferRest`'s own handling, so it's not ambiguous).
  - `backend/src/main/scala/com/helio/domain/SqlConnector.scala` — confirmed `checkQuery`/`inferSchema`
    live on the `object` (no DI needed) and that `inferSchema(config)` internally calls `checkQuery`-free
    `execute(config, maxRows=100)`, so the caller (design's D2) is right that `checkQuery` must be called
    explicitly first.
  - `backend/src/main/scala/com/helio/api/routes/PipelineRoutes.scala` +
    `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — confirmed `PipelineIdSegment =
    Segment.map(PipelineId(_))` is an unconstrained matcher, so design.md D5's routing concern is real.
  - `backend/src/main/scala/com/helio/api/protocols/PipelineProposalProtocol.scala` +
    `schemas/pipeline-proposal.schema.json` (HEL-379, merged, confirmed present in this worktree's git
    history at `93d317bd`) — confirmed the actual `PipelineProposalSource`/`PipelineProposal` shapes.
    Traced `pipelineProposalSourceFormat.read`: when `type` is set (e.g. `"sql"`) but the JSON has no
    `"config"` key, `config = obj.fields.get("config") = None`, so `config.map(_.convertTo[...])` yields
    `None` — no `deserializationError` is thrown. `PipelineProposalSource`'s own `$defs` entry in
    `pipeline-proposal.schema.json` has **no `required` array**, so `{"type": "sql"}` alone is structurally
    valid per the shipped HEL-379 schema. This state is real and reachable, not hypothetical.
  - `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — confirmed
    `CsvSourceConfigPayload(path: String)` (design's csv claim — no inline-content field anywhere on this
    payload) and `StaticColumnPayload`/`StaticDataPayload(columns, rows)` (design's static claim).
  - `backend/src/main/scala/com/helio/services/DataSourceService.scala` — confirmed `createCsv(name,
    bytes: Array[Byte], ...)` receives raw bytes from the route layer's multipart handler (not from
    `CsvSourceConfigPayload`) and only builds `CsvSourceConfig(filePath)` **after** `fileSystem.write`
    persists them; `previewCsv` reads back from `fileSystem.read(source.config.path)`. There is no
    alternate inline-bytes path anywhere in this file. **This independently confirms design.md's central
    claim under review: a `PipelineProposal`'s inline `csv` source genuinely cannot be dry-analyzed given
    the wire shape HEL-379 already shipped — the 400 in Decision 2 is a real constraint, not a design
    gap the executor could route around.**
  - `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — confirmed `PipelineProposalProtocol` is
    already mixed in (`entity(as[PipelineProposal])` needs no new plumbing) and confirmed the trait-mixin
    convention a new `PipelineAnalyzeProposalProtocol` would need to join.
  - `grep -rln "ExceptionHandler" backend/src/main/scala/` → **no results**. There is no custom
    `ExceptionHandler` anywhere in this route tree, so an uncaught Scala exception inside a service
    `Future` (e.g. `None.get`) falls through to Pekko's default handling, which returns `500`.
  - `schemas/pipeline-analyze-response.schema.json` vs.
    `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — read both in full
    and compared the schema's `$defs.AnalyzeStep` against what `analyzeStepResponseFormat.write` actually
    emits (see Change Request 1 below — this is the most consequential finding).
  - `git log --oneline -- schemas/pipeline-analyze-response.schema.json` → **one commit only**,
    `26963121 HEL-233` (the file's creation). `git log --all --oneline | grep -i CS2c-3a` → HEL-236's
    CS2c-3a series (`dc85c47a`, `f2928f04`, `e4b0608f`, …) postdates it and is the series whose own code
    comment in `PipelineAnalyzeProtocol.scala` says "After CS2c-3a the analyze response carries ... `type`
    discriminator + typed `config` object" — independently confirms the schema file was never updated for
    that shape change.
  - `grep -rln "JsonSchemaValidation" backend/src/test/scala/` → exactly two files: the harness itself and
    `WorkspaceContextServiceSpec.scala` (its one live consumer). Confirmed no test anywhere validates
    `pipeline-analyze-response.schema.json` (or would validate the new proposal-response schema) against a
    real response body.
  - `scripts/concertino/next-report-number.sh` (main checkout) — ran twice to confirm the anomalous
    `skeptic-design-1.md` finding (see Note above), not a flaky one-off read.

### Verdict: REFUTE

The overall shape of the plan is sound: reusing `PipelineAnalyzeService` verbatim, reusing the existing
inline-source inference/guard calls instead of a second implementation, owner-scoped RLS resolution via
the same pattern `DataSourceService.refresh` already uses, and the route-ordering care are all correct
and each building block named actually exists with the signature claimed — including the CSV
non-analyzability conclusion I was specifically asked to check, which holds up under direct inspection of
`DataSourceService.createCsv`/`previewCsv`. But two concrete gaps would produce wrong/untestable behavior
if implemented as currently specified.

### Change Requests

1. **The plan to satisfy AC #6 ("`sbt test` green; response validates against its schema") would fail if
   attempted, and nothing in tasks.md would catch that before merge.** `tasks.md` §1.1 says the new
   `pipeline-analyze-proposal-response.schema.json`'s `steps` field reuses "the existing `$defs` shape from
   `pipeline-analyze-response.schema.json`." That `$defs.AnalyzeStep`
   (`schemas/pipeline-analyze-response.schema.json:54-73`) requires `op` (string) and `config` (**string**),
   and sets `additionalProperties: false` with no `type` property declared. The real endpoint's actual wire
   shape (`PipelineAnalyzeProtocol.scala:226-253`, `analyzeStepResponseFormat.write`, confirmed by reading
   the code, not inferred) emits a `type` discriminator and a **nested typed `config` object** (e.g. a
   `RenameConfig`'s own fields) — there is no `op` field at all. A real response validated against that
   `$defs` shape would fail on three independent grounds: missing required `op`, `config` typed as object
   where a string is required, and an extra `type` property that `additionalProperties: false` forbids.
   This is pre-existing drift on the *already-shipped* `/analyze` endpoint's schema (it was never updated
   when HEL-236/CS2c-3a introduced the discriminated-union shape — confirmed via `git log`), not something
   this ticket introduces. But this ticket's plan proposes copying that stale shape verbatim into a *new*
   schema, and none of tasks.md §3.1–3.10 add a test that actually validates a real response against the
   new schema (the `JsonSchemaValidation` harness already exists and is proven — `WorkspaceContextServiceSpec`
   is its only current consumer — but nothing wires it to this new endpoint). AC #6 is therefore asserted
   but has no planned verification signal, and the signal that *would* exist (if someone added it) would
   fail.

   **Required revision:** (a) define `pipeline-analyze-proposal-response.schema.json`'s step shape against
   the *actual* discriminated-union wire format (`type` discriminator + object `config`, e.g. `oneOf` per
   step kind, or a permissive `config: {"type": "object"}` if a full per-kind union is out of scope for
   this ticket) — not a copy of the stale existing `$defs`; (b) add an explicit task in the Tests section
   that runs a real `analyzeProposal` response through `JsonSchemaValidation` against the new schema, so
   AC #6 has an actual, executable verification signal rather than an assertion with nothing behind it.

2. **design.md D2 doesn't specify behavior when a proposal's `source.type` is a recognized inline kind
   (`sql`/`rest_api`/`static`) but the matching config field is absent.** This is a real, reachable state:
   `pipelineProposalSourceFormat.read` (confirmed by reading it) sets `sqlConfig`/`restConfig`/
   `staticConfig` to `None` whenever the wire JSON has no `"config"` key, regardless of `type`, and
   `PipelineProposalSource`'s JSON-schema `$defs` entry has no `required` array — so `{"type": "sql"}`
   alone is structurally valid per the already-shipped HEL-379 schema, not a hypothetical edge case. D2's
   per-branch prose reads as though the config field is always populated once `type` matches (e.g. "Inline
   `sql` → `SqlConnector.checkQuery(sqlConfig.query)`"), with no `None` case named. An implementer
   following that literally and calling `.get`/unwrapping the `Option` without a guard would throw
   `NoSuchElementException`, and since there is no `ExceptionHandler` anywhere in this route tree
   (confirmed by grep), Pekko's default handling turns that into an unhandled `500` for a
   structurally-valid-per-schema proposal — directly contradicting D2's own stated principle for the
   sibling csv branch ("this is a structurally valid proposal per the HEL-379 schema... it must fail
   through the normal `ServiceError` channel, not an unhandled exception").

   **Required revision:** add an explicit D2 branch — when `type` names a recognized inline kind but its
   matching config `Option` is `None`, return `ServiceError.BadRequest(s"inline '$type' source requires a
   'config' object")` (mirroring the csv branch's already-correct treatment) — and add a task-3.x test for
   at least one case (e.g. `type: "sql"`, no `config`) asserting `400`, not `500`.

3. **D2 doesn't state a precedence rule for when `sourceId` and an inline `type` are both present on the
   same `PipelineProposalSource`.** `schemas/pipeline-proposal.schema.json`'s own
   `$defs.PipelineProposalSource.description` explicitly flags this as unresolved: "Both forms are
   representable at once — this schema does not enforce mutual exclusivity; resolving which branch wins
   when both are present is an apply-time (HEL-342) concern." HEL-381 is not the apply ticket, but it is
   the *first* consumer that must actually resolve this ambiguity to produce a schema at all for dry-analyze
   purposes — there is no apply implementation yet to defer to. D2's bullet list (`sourceId` present →
   existing-source branch; else dispatch on inline `type`) implies `sourceId` wins by virtue of being
   listed first, but this is never stated as a decision, and no task/test exercises the both-present case.
   Leaving a precedence rule to fall out of bullet-list ordering, when the very schema this ticket consumes
   flags the ambiguity by name, is exactly the kind of deferred decision the design gate exists to force
   into the open.

   **Required revision:** add one sentence to D2 stating the precedence explicitly (e.g. "`sourceId`, when
   present, always wins over an inline `type`, matching the order these branches are checked"), and add a
   test case with both `sourceId` and an inline `type`/`config` populated, asserting the existing-source
   branch is what actually resolves.

### Non-blocking notes

- design.md D5's stated failure mode ("an unordered placement would have the literal segment swallowed
  as a bogus pipeline id, returning a 404") is imprecise: `path(PipelineIdSegment)` only exposes
  `get`/`patch`/`delete`, so a misplaced `POST /pipelines/analyze-proposal` would surface a Pekko
  `MethodRejection` (→ 405), not a 404. Doesn't change the routing recommendation (placing the new route
  first is still correct) — just the stated rationale's exact status code is off. Not blocking.
- tasks.md §2.4's framing ("factoring the existing `PipelineService.toAnalyzeStepResponse` to accept a
  step-list pair rather than reading off a persisted `Pipeline`") mischaracterizes the current code — it
  already takes only a single `AnalyzedStep`, not a `Pipeline`, and needs zero factoring to be reused.
  Worth tightening so the task doesn't send someone hunting for a refactor that isn't needed.
- tasks.md §3.1's fallback ("or extend the existing `PipelineServiceSpec` if that fits") names a file that
  doesn't exist (`find backend/src/test/scala/com/helio/services -iname "*Pipeline*"` shows no
  `PipelineServiceSpec.scala` — `PipelineService` is currently tested entirely through route-level specs
  under `api/routes/`). The primary instruction (new file `PipelineServiceAnalyzeProposalSpec.scala`) is
  still clear and actionable; only the parenthetical fallback is stale.
- design.md's citation "the existing `checkQuery` short-circuit test pattern in
  `DataSourceRoutesSpec.scala:898`" — that test actually starts at line 894, not 898. Cosmetic.
- design.md D4 doesn't say what `sourceName` should be when an inline source's `name` field is absent
  (also `Option[String]`, not required at the `PipelineProposalSource` schema level). Likely resolves
  naturally once Change Request 2's config-absent handling is decided, but worth a one-line call-out
  alongside that fix.

### Environmental note (reporting infrastructure, not a design finding)

This worktree's checked-out `scripts/concertino/` (HEAD `93d317bd`) contains only `assert-phase.sh`,
`cleanup.sh`, `README.md`, `setup-worktree.sh`, `start-servers.sh` — it is missing `next-report-number.sh`,
`persist-evidence.sh`, and `emit-event.sh`, which exist in the up-to-date `main` checkout at
`/home/matt/Development/helio/scripts/concertino/` (confirmed: `scripts/concertino/` is entirely
`.gitignore`d as a directory pattern, but several files under it were tracked before that rule was added
and remain committed; the three missing scripts are newer, locally-generated, never-committed files that a
`git worktree add` checkout does not receive). I invoked the canonical, read-only, no-side-effect copy of
`next-report-number.sh` from the up-to-date `main` checkout, passing this worktree's actual change
directory as the argument, rather than guessing a fallback filename. I'll do the same for
`persist-evidence.sh`/`emit-event.sh` below. This matches the same note left in `skeptic-design-1.md`
(independently reproduced, not a one-off).
