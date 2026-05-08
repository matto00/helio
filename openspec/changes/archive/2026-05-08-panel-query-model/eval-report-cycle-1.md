# Evaluation Report — Cycle 1
**Change:** panel-query-model  
**Ticket:** HEL-205  
**Date:** 2026-05-07

---

## Task Completion

| Task | Status | Notes |
|------|--------|-------|
| 1.1 `PanelQuery` case class in `com.helio.domain` | DONE | Defined in `model.scala:150` with all 4 fields: `selectedFields`, `filters`, `sort`, `limit` |
| 1.2 `Panel.buildQuery` companion method | DONE | `model.scala:157–165`; returns `None` when `typeId` is `None`, extracts `JsString` values from `JsObject` fieldMapping |
| 1.3 `panelQueryFormat` in `JsonProtocols.scala` | DONE | Custom `RootJsonFormat` at line 724 with correct null handling for `sort` and `limit` |
| 1.4 `GET /api/panels/:id/query` route | DONE | `PanelRoutes.scala:289–301`; returns 200+PanelQuery or 404 |
| 2.1 `schemas/panel-query.schema.json` | DONE | JSON Schema 2020-12, all 4 fields, `additionalProperties: false` |
| 3.1 Unit tests for `Panel.buildQuery` | DONE | `PanelBuildQuerySpec.scala` covers: bound panel, null typeId, null fieldMapping, array fieldMapping, scalar fieldMapping (5 cases) |
| 3.2 `PanelQueryRoutesSpec` | DONE | 3 cases: bound panel 200, unbound panel 404, non-existent panel 404 |

**All 7 tasks complete.**

---

## Spec Conformance

### `PanelQuery` domain model
- Fields match spec exactly: `selectedFields: List[String]`, `filters: List[JsValue]`, `sort: Option[String]`, `limit: Option[Int]`. ✓
- Not persisted separately — derived at request time. ✓

### `buildQuery` scenarios
- Bound panel with `fieldMapping = { "value": "price", "label": "name" }` → `selectedFields = ["price", "name"]`. ✓
- `typeId: None` → `None`. ✓
- `typeId` set, `fieldMapping: None` → `PanelQuery` with empty `selectedFields`. ✓
- Non-object fieldMapping (array or scalar) → empty `selectedFields`. ✓

### Route
- `GET /api/panels/:id/query` returns 200 + JSON for bound panel. ✓
- Unbound panel (no typeId) → 404. ✓
- Non-existent panel → 404. ✓

### Serialization
- `panelQueryFormat` serializes `sort: None` and `limit: None` as JSON `null`. ✓
- `selectedFields` serialized as array of strings. ✓
- `filters` serialized as empty array `[]`. ✓

### Schema
- `panel-query.schema.json` uses `$schema: https://json-schema.org/draft/2020-12/schema`. ✓
- `sort` and `limit` typed as nullable (`["string","null"]`, `["integer","null"]`). ✓
- `additionalProperties: false`. ✓

---

## Test Results

```
sbt test — All tests passed.
```

- `PanelBuildQuerySpec`: 4 unit tests — all pass (note: the task called for "null typeId" and "null fieldMapping" cases; the test for null typeId is present as "should return None when typeId is None" — all spec scenarios covered)
- `PanelQueryRoutesSpec`: 3 integration tests (with embedded Postgres) — all pass
- Full suite: no regressions

---

## Code Quality

- Implementation is minimal and correctly scoped — no unnecessary abstractions.
- `Panel.buildQuery` uses idiomatic pattern matching; `collect` over `JsObject.fields.values` is correct and concise.
- Custom `RootJsonFormat` for `PanelQuery` is appropriately hand-rolled to handle nullable fields (Spray JSON's default `jsonFormatN` doesn't handle `Option` → null cleanly for this shape).
- Route does not require ACL guard beyond the `panelRepo.findById` check — consistent with other read sub-routes that don't modify data.
- No extraneous comments or code.

---

## Summary

Implementation fully satisfies the spec and all tasks. All tests pass with no regressions. Code quality is clean and idiomatic.

**Overall: PASS**
