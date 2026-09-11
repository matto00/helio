# HEL-1076: Declared-schema model and write-time validation

## Description

The dataset's schema is user-declared and authoritative. Model the declaration (field name, `DataFieldType`, required, default) and validate every write against it, rejecting on mismatch.

Use the canonical `DataFieldType` set — string/integer/float/boolean/timestamp/string-body/binary-ref. Note `"double"` is **not** canonical and has silently produced unbindable fields before (HEL-891).

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- A write with a wrong-typed value is rejected with a field-level error, not coerced.
- A write missing a required field is rejected.
- A failable probe shows the reject arm firing (a guard that goes red when the check is mutated out).

## Context (driver brief, HEL-1076 delivery)

- `dataset_schema` (added HEL-1074, V106) currently stores only `SchemaField(name, type)` pairs — no `required`/`default`. This ticket introduces the richer declaration model.
- `DataFieldType` canonical set and `DataFieldType.asString`/`canonicalize` already exist in `domain/model/model.scala` — reuse them; do not reinvent.
- Scope for "every write" in this ticket = the validator itself (a reusable component), applied wherever `dataset_rows` is written today (create, refresh paths in `DataSourceRepository`/`DataSourceService`). The write API surface for interactive/user-facing writes is HEL-1077 (next lane) — this ticket must leave a clear, directly callable validation entry point for HEL-1077 to call.
- Declared-schema mutation (editing the declaration when rows exist) semantics: check the design spec; if silent on this, do not invent product behavior — escalate.
- spray-json omits `Option=None` on the wire — normalize `required`/`default` absent-vs-null at the service boundary; test with fields absent.
- Keep `schemas/` JSON Schemas + `openspec/` OpenAPI + frontend types in the same change as any server wire-shape changes.
- No migration expected. If one is needed, V107 is next free — confirm before adding.
- RLS: any code touching `data_sources`/`dataset_rows` must be exercised under the non-superuser `helio` role path, not just local/CI superuser.
