## Why

REST sources cannot express a POST/PUT payload at all, and the UI's `jsonPath` field is decorative —
spray-json silently drops it at the payload→domain-model boundary, so users type a value that does
nothing while the form implies it worked. Both gaps make REST sources unable to write data or consume
typical wrapped API responses (`{"data": [...]}`).

## What Changes

- Add `body: Option[String]` + `bodyContentType: Option[String]` to `RestApiConfig`, wired into
  `RestApiConnector.buildRequest` as an actual `HttpEntity`.
- A body on a GET is rejected with a curated validation error (not silently sent).
- Body content participates in HEL-823's `{{name}}` templating via the existing `TemplateInterpolator`
  — no second templating path — with content-type-aware escaping (JSON-string-escaped for
  `application/json`).
- Add `rootSelector: Option[String]` to `RestApiConfig`: a minimal dot-path (e.g. `data.items`) locating
  the row array/object within the response body. Unset behaves byte-identically to today's `toRows`.
  Deliberately NOT building: flatten, pagination-loop composition, curated `fetchError` envelope,
  HEL-473 inference-facade integration — reserved for HEL-599, which this selector is a strict subset
  of (same dot-path convention).
- Frontend: `RestApiForm.tsx` gains a body/content-type editor; existing `jsonPath` field is rewired to
  actually persist as `rootSelector` (not removed — it becomes real).
- Deliberate decisions on two known inherited defects: `splitUrl`'s repeated-query-key collapsing, and
  the auth/source header collision — recorded and resolved in design.md, not silently carried forward.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `rest-api-connector`: adds request body (payload + content type + method interaction + templating)
  and a minimal response root-selector to the REST source model.

## Impact

- `backend/src/main/scala/com/helio/domain/model/model.scala` (`RestApiConfig`)
- `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` (`buildRequest`, `toRows`,
  `buildResolvedRequest`)
- `backend/src/main/scala/com/helio/JsonProtocols.scala`
- `frontend/src/features/sources/ui/forms/RestApiForm.tsx`,
  `frontend/src/features/sources/services/dataSourceService.ts`
- Flyway migration for `rest_api_config` JSONB shape is not required (JSONB, additive fields).

## Non-goals

Pagination (HEL-591), OAuth2 (HEL-595), rate limiting (HEL-597), form-parity/dual-support retirement
(HEL-827), agent/MCP surface (HEL-828), in-chat credential capture (HEL-829), flatten/pagination
composition/curated-fetchError/HEL-473-facade for response shaping (HEL-599).
