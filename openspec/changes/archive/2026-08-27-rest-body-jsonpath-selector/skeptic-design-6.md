## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Narrow confirming pass on design.md Decision 3's "decode-is-total" sweep only.
Rounds 1-5 findings not reopened.

### What I verified (with evidence)

1. **Construction-path enumeration independently re-derived, not read from design.md.**
   `grep -rn "RestApiConfig(\|EphemeralRestConfig(" backend/src/main/scala` yields exactly
   seven real construction sites (excluding the two `final case class` definitions and one
   comment in `DataSourceConfigCodec.scala:39`):
   `DataSourceProtocol.scala:352`, `SourceService.scala:117`, `SourceService.scala:217`,
   `RestSourceConnectorMigration.scala:153`, `DataSourceRepository.scala:55`,
   `RestApiConnectorDriver.scala:315`, `PipelineService.scala:368`.
   This is an exact set-match with Sweep 2's seven. **No missed site.**

2. **Closed the enumeration's blind spot (a `.copy(...)` is also a construction path).**
   `grep -rn "restConfig\.copy\|cfg\.copy\|config\.copy" backend/src/main/scala` returns only
   panel-domain hits (`TextPanel`, `MarkdownPanel`, `PanelServiceHelpers`) — zero
   `RestApiConfig`/`EphemeralRestConfig` copies. The only `.copy` touching a REST payload is
   `DataSourceConfigCodec.scala:57`'s `.copy(url = None)` on the *payload*, which Sweep 1
   already accounts for. So "construct via `apply`" is genuinely the complete set of paths.

3. **No second write/re-encode path.** `grep -rn "encodeRest"` → only
   `DataSourceRepository.scala:83`/`:166` (persist an already-built `RestSource.config`) and
   `RestSourceConnectorMigration.scala:160`. There is no PATCH/update path that mutates a
   stored REST config field-by-field, so no fourth "unvalidated value reaches the row" route.

4. **Sweep 1's classification of the three pre-existing `toDomain` validations checked against
   source, not narrative** (`DataSourceProtocol.scala:335-362` + `DataSourceConfigCodec.scala:49-66`):
   - `auth` rejection: `fromDomain` hardcodes `auth = None` (`:372`) and none of the seven
     construction sites sets auth (verified by reading `SourceService:117-122`,
     `RestSourceConnectorMigration:153-158`, `DataSourceRepository:55`) — a stored row cannot
     carry `auth`. Safe-on-decode as claimed.
   - `connectorId`/`url` exclusivity: `decodeRest` forces `.copy(url = None)` and only reaches
     `toDomain` after confirming a non-empty `connectorId` JsString — both the "both present"
     and "neither present" arms are structurally unreachable from decode. Verified in source.
   - Reserved-sentinel rejection: correctly a decode-time security guard, not a business rule.
   No **fourth** validation exists in `toDomain` — the method body is a single `if (p.auth.isDefined)`
   plus one 4-arm match; I read all of it. So there is no other field that could reject a
   previously-decodable row.

5. **New-field decode safety.** `RestApiConfig` (`model.scala:513-522`) and the payload gain
   `bodyContentType`/`rootSelector` as `Option[String] = None` (tasks 1.1/1.2/2.1), so a
   pre-existing stored blob lacking those keys still decodes (spray-json `Option` ⇒ `None`);
   the `jsonFormat9 → jsonFormat11` bump is arity-checked by the compiler in both places it
   appears (`DataSourceConfigCodec.scala:21`, `DataSourceProtocol.scala:~397`). No new
   `DeserializationException` surface on old rows.

6. **Invariant holds uniformly on the safety boundary.** Tasks 3.2 and 3.3 both call
   `rejectBodyOnSafeMethod` AND `parseBodyContentType`, both "FIRST", and 3.3 additionally
   converts `buildEphemeralRequest` to `Either` and fixes its two direct callers with
   `inferSchemaEphemeral` inheriting transitively. Task 1.3 places the sole `ContentType.parse`
   in `parseBodyContentType` and states explicitly it is "never called from `toDomain`", and
   2.2 requires a red-if-violated test that an unparseable `bodyContentType` still decodes.
   The bodyContentType/body asymmetry that round 5 left behind is genuinely closed.

### Verdict: CONFIRM

### Non-blocking notes

- **Doc/task contradiction inside the explicitly non-authoritative layer.** design.md:165
  says "the SAME two checks are also called at create-time", but tasks.md 2.3 specifies only
  `rejectBodyOnSafeMethod`, and 3.2 parenthetically says the create-time calls "cover only
  `rejectBodyOnSafeMethod`, not content-type parsing". Not blocking — this is the
  belt-and-braces UX layer design.md itself declares "explicitly NOT required for correctness";
  the structural guard in 3.2/3.3 covers both. Worth reconciling one of the two sentences so a
  future reader doesn't mistake it for a gap.
- `RestApiConfig.parseBodyContentType` (task 1.3) puts a Pekko-HTTP `ContentType` in the
  `domain/model` companion, importing an infrastructure type into the domain layer. Consider
  `RestApiConnectorDriver`'s companion instead; purely a layering preference.
- `buildResolvedRequest` resolves the Connector and decrypts the credential (`:111-122`)
  before `resolveTemplatedRequestParts`; "FIRST" in task 3.2 can only mean "before templating/
  URI/entity work", not literally the first statement. Behaviourally equivalent (no request is
  issued), just imprecise wording.
- `RestApiConnectorDriver.scala:315`'s `fetchOverride` adapter drops `body` on the floor;
  Sweep 2 flags this as test-fixture-only. Confirmed from source — it is only reached when a
  caller supplies `fetchOverride`, never on a live path. Agreed out of scope.
