## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Round-1 findings — all three re-checked against the live tree, all three genuinely closed:

1. **`rootSelector` on `EphemeralRestConfig`** — CLOSED. tasks.md 1.2 now names
   `body`/`bodyContentType`/`rootSelector` explicitly and cites Decision 4's rationale;
   design.md Decision 4 carries the same. Live tree confirms `EphemeralRestConfig`
   (`backend/src/main/scala/com/helio/domain/model/model.scala:529-533`) currently has only
   `url`/`method`/`headers`, and that `inferSchemaEphemeral`
   (`RestApiConnectorDriver.scala:323-324`) is the ephemeral `toRows` consumer — so the field
   is genuinely required. `PipelineService.scala:368` also constructs an `EphemeralRestConfig`;
   defaulted `Option` fields keep it compiling.

2. **Method control** — CLOSED. design.md Decision 6 + tasks 5.2a/5.2b now add a method
   `<select>` before gating the body editor. Verified the premise on the live tree:
   `RestApiForm.tsx:23` hardcodes `method: "GET"` in `buildConfig()`, and
   `AddSourceModal.tsx:119` and `:150` each hardcode it again — **both line numbers cited in
   design.md/5.2a are exact**. Confirmed `RestApiForm.buildConfig()` is only consumed by
   `TestConnectionAffordance` (`RestApiForm.tsx:55`), so the two modal sites really are the
   live infer/create paths and both must change.

3. **`toRows` call-site list** — CLOSED and now exact. `grep -n toRows` over
   `backend/src/main` yields precisely the four sites task 4.1 lists:
   `RestApiConnectorDriver.scala:284` (`inferSchema`), `:289` (`fetch(config, maxRows, ctx)`),
   `:324` (`inferSchemaEphemeral`), and `SourceService.scala:312` (`previewRest`,
   `connector.toRows(json).take(10)`). `fetch(config, resolveContext)` is correctly excluded —
   it returns raw `JsValue`. `previewRest` has `source.config` in scope, so passing
   `source.config.rootSelector` is mechanically possible.

Additional independent checks: spec delta read in full; Migration Plan's "no Flyway needed"
claim is consistent with the JSONB-backed config; Decision 1's byte-identical-when-unset
contract is expressible against the existing 3-way match at `RestApiConnectorDriver.scala:215`.

### Verdict: REFUTE

Two new findings, same class as round-1 #3 (a stated behavior with no task that implements it),
both traced to code:

`SourceService.createRest` (`SourceService.scala:77-124`) has **three** distinct
body-carrying-config origins, not the two design.md Decision 3 names:
- `case (Some(_), None)` — connectorId path, line 89, routes through
  `RestApiConfigPayload.toDomain`. **Guarded** by task 2.2.
- `case (None, Some(url))` — bare-`url` create, lines 91-124, builds
  `RestApiConfig(connectorId=…, endpoint=…, method=…, headers=…)` **directly, never calling
  `toDomain`**. Unguarded, and task 2.3 asks only that `body` be *forwarded* here.
- `toEphemeral` (`SourceService.scala:216-221`), reached from the bare-`url` infer branch
  (`:182`) and test branch (`:210`). Unguarded; no task touches it for validation.

### Change Requests

1. **The bare-`url` create path can send a body on GET, contradicting the spec delta.**
   The spec delta's scenario "A body on a GET request is rejected" states it applies "for
   either the `connectorId` or bare-`url` path", but `SourceService.scala:91-124` bypasses
   `RestApiConfigPayload.toDomain` entirely (confirmed: `toDomain` appears at
   `SourceService.scala:54,89,150,173,191,205` — never inside the `(None, Some(url))` branch),
   so task 2.2's rejection never runs there. Amend design.md Decision 3 to name this third
   boundary, and amend task 2.3 (or add a task) to call `rejectBodyOnSafeMethod` in the
   bare-`url` branch and return `ServiceError.BadRequest`, with a ScalaTest for
   bare-`url` + `method: "GET"` + body → 400.

2. **Decision 3's ephemeral-boundary rejection is specified but has no task, and needs an
   unspecified signature change.** Decision 3 says the check runs at "`SourceService`'s
   ephemeral-payload construction (`toEphemeral`)", but `grep rejectBodyOnSafeMethod
   tasks.md` matches only 1.3 (helper + unit test) and 2.2 (`toDomain`). Task 2.3 mentions
   `toEphemeral` for *forwarding* only. Additionally `toEphemeral` is currently
   `private def toEphemeral(payload: RestApiConfigPayload): EphemeralRestConfig` — returning a
   rejection requires changing it to `Either[String, EphemeralRestConfig]` and handling the
   `Left` at both call sites (`:182` infer, `:210` test), a decision the tasks leave the
   executor to invent mid-flight. Either (a) add a task specifying that signature change and
   the curated-400 handling at both call sites plus a test, or (b) if the intent is that the
   ephemeral path is deliberately *not* guarded, say so explicitly in Decision 3 and remove
   `toEphemeral` from its "both boundaries" claim so design and tasks stop contradicting.

### Non-blocking notes

- Task 5.1 states the invariant "the payload key sent to the backend must be `rootSelector`"
  but, unlike 5.2a, does not enumerate the sites. The live `jsonPath` payload key is emitted at
  **three** places: `RestApiForm.tsx:24`, `AddSourceModal.tsx:120`, `AddSourceModal.tsx:151`.
  Only the two modal sites are on the real infer/create paths. Enumerating them the way 5.2a
  enumerates `:119`/`:150` would remove the risk of renaming only `buildConfig()`'s copy — a
  miss that would leave AC #3 silently unmet. Task 5.3's live verification should catch it
  regardless, which is why this is a note and not a Change Request.
- design.md Decision 6 says the body editor is "disabled/hidden for GET/HEAD" while task 5.2b
  says "hidden/disabled" — pick one; a disabled-but-visible field and a hidden field are
  different UX, and DESIGN.md compliance will be judged against whichever ships.
