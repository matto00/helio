## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Round-3 gap — CLOSED, and the exhaustiveness claim independently re-derived (not trusted).**
I re-ran the grep myself against the live tree rather than accepting the restatement:

```
$ grep -rn "EphemeralRestConfig(\|RestApiConfig(" backend/src/main/scala
RestApiConnectorDriver.scala:315          synthetic bridge for the test-only fetchOverride hook
DataSourceConfigCodec.scala:39            (comment)
model.scala:513 / :529                    (definitions)
DataSourceProtocol.scala:352              boundary #1  RestApiConfigPayload.toDomain
PipelineService.scala:368                 boundary #4  inline rest_api dry-analyze
DataSourceRepository.scala:55             sentinel-only RestApiConfig(connectorId = "__malformed__")
RestSourceConnectorMigration.scala:153    legacy->Connector migration
SourceService.scala:117                   boundary #2  createRest bare-url branch
SourceService.scala:217                   boundary #3  toEphemeral
```

Classifying each non-boundary site against ground truth (so "exhaustive" is a derivation, not an assertion):
- `DataSourceRepository.scala:55` — constructs only `RestApiConfig(connectorId = sentinel)`; no body
  reachable, and the sentinel fails Connector resolution on any fetch. Not a boundary. Correct to omit.
- `RestSourceConnectorMigration.scala:153` — sources its fields from `LegacyRestApiConfigPayload`
  (`RestSourceConnectorMigration.scala:45-49`), which has exactly `url`/`method`/`auth`/`headers` and
  **no `body` field** (`jsonFormat4`). There is nothing to drop. Not a boundary. Correct to omit.
- `RestApiConnectorDriver.scala:315` — the `fetchOverride` bridge, reached only when the test-only
  override is installed (`fetchEphemeral`'s `case Some(fn)`); the production arm is
  `issueAndParse(buildEphemeralRequest(config))`, which task 3.3 covers. Not a production boundary
  (still worth forwarding for test fidelity — repeated as a non-blocking note below).

So Decision 3's four-boundary list is now **correct and complete** for production body origination.
Boundaries #2/#3/#4 each verified in the live tree: `SourceService.scala:117-122`,
`SourceService.scala:216-221` (with call sites `:182` `inferRest` and `:210` `testRest`, and the
`Left`-handling pattern to mirror present at `:173`/`:205`), and `PipelineService.scala:365-373`
(builds `EphemeralRestConfig(url, method, headers)` then calls `c.inferSchemaEphemeral`, with the
`(Some(_), None)` `Left`-short-circuit pattern at `:359-361` to mirror). Task 2.3c matches this.

**Other checks:** `toRows` call sites named in task 4.1 re-confirmed (`RestApiConnectorDriver.scala:284`,
`:289`, `:324`; `SourceService.scala:312`); spec.md's ADDED/MODIFIED requirements cover body, GET+body
rejection, `bodyContentType` parse rejection, and the four `rootSelector` scenarios with a scenario per
task; `RestApiConfigPayload` already carries `body` (`DataSourceProtocol.scala:149`, threaded at `:358`/`:372`).

### Verdict: REFUTE

One new, reproduced finding — **`RestApiConfigPayload.toDomain` is also the persisted-config *read*
path, so task 2.2 turns a write-time validator into a decode-time one.**

`DataSourceConfigCodec.decodeRest` (`DataSourceConfigCodec.scala:49-67`) decodes every stored
`rest_api` config by calling `RestApiConfigPayload.toDomain(...)` and treating any `Left` as
`"malformed: ..."`; `DataSourceRepository.rowToDomain` (`:47-56`) maps that `Left` to
`RestApiConfig(connectorId = "__malformed__")`, a source that then fails Connector resolution on
every fetch/preview/refresh, with only a `warnOnce` log.

Task 2.2 says to put **both** new rejections (`rejectBodyOnSafeMethod` and unparseable
`bodyContentType`) inside `toDomain`. Under that instruction, any already-persisted row whose config
carries `method: "GET"` + a non-empty `body` stops decoding and silently degrades to the malformed
sentinel on read. `body` has round-tripped through `RestApiConfigPayload`/`toDomain` as an unused
placeholder since HEL-823, so such a row is producible today by any direct-API caller (the UI never
sets one, so the likelihood is low — but the blast radius is a source that quietly stops working).

This also makes design.md's Migration Plan claim materially false as written: "every pre-existing REST
source simply has `rootSelector = None` and keeps behaving exactly as before" does not hold for a
pre-existing GET+body row under task 2.2's placement.

### Change Requests

1. **Decide and state where the safe-method/content-type rejection actually lives, given
   `decodeRest` reuses `toDomain`.** Add this to design.md Decision 3 explicitly (it currently treats
   `toDomain` as a pure wire-in boundary). Either:
   (a) keep the checks out of `toDomain` and apply them at the create/update call sites that consume
   it (`SourceService.scala:89`, plus the existing #2/#3/#4), leaving the decode path unvalidated and
   backward-compatible; or
   (b) keep them in `toDomain` and have `decodeRest` bypass/tolerate them (e.g. validate only on the
   wire-in call, or map a body-rule `Left` on decode to a *retained* config rather than the
   `__malformed__` sentinel) — with the rationale written down.
   Do not leave the current wording, which does not acknowledge that `toDomain` is on the read path.
2. **Add/adjust the corresponding task** (amend 2.2) to make the chosen option concrete, plus a
   ScalaTest with a real acceptance signal: a stored config with `method: "GET"` and a non-empty
   `body` still decodes via `DataSourceConfigCodec.decodeRest` to a usable `RestApiConfig` (i.e. does
   **not** become `__malformed__`), while the same shape submitted through `POST /api/sources` is
   still rejected 400.
3. **Correct the Migration Plan paragraph** to match whichever option is chosen — as written it
   asserts unconditional read-path compatibility that task 2.2 would break.

### Non-blocking notes

- `RestApiConnectorDriver.scala:315`'s `fetchEphemeral` bridge will drop `body`/`bodyContentType`/
  `rootSelector` when synthesizing its `RestApiConfig` for the `fetchOverride` hook. Production-safe
  (test-only arm), but a stubbed ephemeral-body test would pass for the wrong reason. Forward the
  three fields there for test fidelity. (Carried forward unaddressed from round 3.)
- `RestApiForm.buildConfig()` (`RestApiForm.tsx:24`) still looks unused by `AddSourceModal`, which
  builds its own config at `:120`/`:151`. Executor should confirm rather than assume it is live.
