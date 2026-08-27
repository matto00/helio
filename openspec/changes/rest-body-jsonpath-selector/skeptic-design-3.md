## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Round-2 gaps — both CLOSED:
1. Decision 3 now enumerates `SourceService.createRest`'s bare-`url` branch as boundary #2.
   Confirmed against the live tree: `backend/src/main/scala/com/helio/services/sources/SourceService.scala:117-122`
   builds `RestApiConfig(connectorId, endpoint, method, headers)` directly and never calls
   `RestApiConfigPayload.toDomain`. Task 2.3 covers both the forwarding and the rejection there.
2. Decision 3 boundary #3 + task 2.3b cover `toEphemeral`. Confirmed live:
   `toEphemeral` is at `SourceService.scala:216-221`, returns a bare `EphemeralRestConfig`, and has
   exactly the two call sites the design names — `inferRest` `(None, Some(_))` at `:182` and
   `testRest` at `:210`. The `Left`-handling pattern the design says to mirror does exist in the
   sibling `(Some(_), None)` branches (`:180` / `:208`). Signature change to `Either` is specified.

Other checks against ground truth:
- Task 4.1's `toRows` call-site list is accurate and complete for the `RestApiConnectorDriver` /
  `SourceService` pair: `RestApiConnectorDriver.scala:284` (inferSchema), `:289` (fetch/maxRows),
  `:324` (inferSchemaEphemeral), `SourceService.scala:312` (previewRest). `grep -n "toRows("` finds
  no others.
- Task 5.1's frontend site enumeration is accurate: `dataSourceService.ts:37`,
  `RestApiForm.tsx:24`, `AddSourceModal.tsx:120` and `:151`. Task 5.2b's "rendered, not merely
  disabled" clarification is unambiguous.
- Migration Plan's "no Flyway needed" holds — `RestApiConfig` is JSONB-backed via
  `DataSourceConfigCodec`; new `Option` fields with defaults.

### Verdict: REFUTE

One new, reproduced finding: Decision 3's exhaustiveness claim is false against the live tree.

Decision 3 states the three boundaries are "the exhaustive list of places a body-carrying request
can originate in this codebase — confirmed by grep for `RestApiConfig(` / `EphemeralRestConfig(`
construction sites during the design gate". I re-ran exactly that grep:

```
$ grep -rn "EphemeralRestConfig(" backend/src/main/scala
backend/src/main/scala/com/helio/domain/model/model.scala:529            (definition)
backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:368   <-- not in Decision 3
backend/src/main/scala/com/helio/services/sources/SourceService.scala:217       (toEphemeral)
```

`PipelineService.scala:365-372` is a **fourth** boundary: the inline-`rest_api` pipeline dry-analyze
path builds its own `EphemeralRestConfig` from a `RestApiConfigPayload` (`url`/`method`/`headers`),
bypassing `SourceService.toEphemeral` entirely, and then calls `c.inferSchemaEphemeral(ephemeral)`.
Because named args with defaults compile fine, adding `body`/`bodyContentType`/`rootSelector` to
`EphemeralRestConfig` will **not** break this site — it will silently drop all three, which is
precisely the spray-json-silent-drop failure class this ticket exists to eliminate (and precisely the
preview-vs-actual schema divergence that cycle 1's REFUTE cited as the reason `rootSelector` had to
be on `EphemeralRestConfig` at all). A pipeline proposal carrying a `rootSelector` would infer a
schema from the response *wrapper* while the eventually-created source yields shaped rows.

No task touches `PipelineService`. This is not a fatal design flaw, but the design asserts as
verified something that is verifiably not true, and the artifacts as written will ship a silent drop.

### Change Requests

1. **Correct Decision 3's boundary enumeration.** `PipelineService.scala:368`
   (inline-`rest_api` dry-analyze, `(None, Some(url))` branch) constructs `EphemeralRestConfig`
   directly and is not covered by any of the three listed boundaries. Either (a) list it as boundary
   #4 and add a task forwarding `body`/`bodyContentType`/`rootSelector` there plus a
   `rejectBodyOnSafeMethod` call — ideally by having it reuse the now-`Either`-returning
   `SourceService.toEphemeral` (or a shared helper) rather than hand-rolling a second copy of the
   same mapping — or (b) explicitly declare it out of scope in Decision 3 with a stated rationale
   and a note that `rootSelector`/`body` are knowingly ignored on the inline-pipeline-source path.
   Do not leave the current "exhaustive … confirmed by grep" wording standing either way: it is
   contradicted by that exact grep.
2. **Add a corresponding task** under section 2 (e.g. 2.3c) making whichever option is chosen
   concrete, with an acceptance signal (a ScalaTest asserting the inline-pipeline path either honors
   `rootSelector`/rejects GET+body, or a comment + design note if deliberately excluded).

### Non-blocking notes

- `RestApiConnectorDriver.fetchEphemeral` (`:315`) bridges the ephemeral config into a synthetic
  `RestApiConfig(connectorId = "__ephemeral__", endpoint, method, headers)` for the test-only
  `fetchOverride` hook. Once `body`/`rootSelector` exist on both types, this bridge will drop them —
  harmless in production (the hook is test-only) but it will make a stubbed ephemeral-body test look
  like it passes for the wrong reason. Worth forwarding the new fields there for test fidelity.
- `RestApiForm.buildConfig()` (`RestApiForm.tsx:24`) appears unused by `AddSourceModal`, which builds
  its own config at `:120`/`:151`. Task 5.1/5.2a correctly names all three, but the executor should
  confirm whether `buildConfig` is dead code rather than assume it is a live path.
