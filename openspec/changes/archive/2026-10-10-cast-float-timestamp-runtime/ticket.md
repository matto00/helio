# HEL-1436: Cast step silently leaves values as strings for "float" and "timestamp" (castValue falls through) while analyze reports the cast type

## Description

Origin: HEL-1423 (matto00/helio#881), lane-reported. The driver confirmed this in code on main e7470bc6.

`backend/src/main/scala/com/helio/domain/steps/CastStep.scala` `castValue` handles `string`, `integer`, `long`, `double`, `boolean` and `date`. Everything else, including `"float"` and `"timestamp"`, falls through to `case _ => str`, so the value stays a string. Analyze, meanwhile, declares the column as the cast type (float/timestamp). The HEL-1423 skeptic saw this live. Downstream numeric functions, sorts and aggregates then operate on strings in a column declared numeric.

## Acceptance Criteria

* Inventory the cast target types every surface accepts (save validator, UI picker, analyze inference, assistant/MCP schemas) and make `castValue` handle every accepted type. Alternatively, make the validator reject types castValue can't produce, but check prod/dev for stored `float`/`timestamp` casts first (read-only).
* `case _ => str` should not silently disagree with analyze: either remove the fallthrough or make it an explicit, tested choice.
* Red-first: casting "1.5" to float yields a number, and a timestamp cast yields the same representation other timestamp producers emit (compare with HEL-1408's timestamp inference). Include a pipeline-level test.

## Owner Rulings (2026-10-10, escalation HEL-1436-1791625162451-8a5c47, recorded via `concertino answer --channel=chat`)

1. **null-on-unparseable** — a `timestamp`/`date` cast of a value that does not parse as a timestamp yields `null` (parity with every other cast target). This changes existing `date` casts, which previously passed junk through as a string; the PR body must call this out.
2. **reject-at-write** — the cast write validator rejects targets the runtime cannot honestly produce: `string-body`, `binary-ref` and any unrecognised string. Already-stored legacy targets get an explicit, tested runtime passthrough.
3. **keep-original-string** — a successful timestamp/date cast keeps the value's original string (no ISO rewrite), matching every other timestamp producer (JSON/SQL timestamp columns, datebucket), which all carry strings. (Note: CSV inference types every column string since HEL-893; the ticket's HEL-1408 reference is to the blank-cells-null change.)

Driver additions: float casts to `Double` (same as `double`), with analyze/apply parity proven; update `AnalyzeSchemaWarnings.castRuntimeTargets` (HEL-1455 item 3) if in scope; PR body gives the owner a read-only PROD count query of cast steps by target.

Status-code note: the escalation question's "(400)" was the orchestrator's own wording, not an owner choice. Every write surface returns 422 for a step-configuration rejection (shipped spec `pipeline-step-config-rejection`), so the rejection uses 422; the PR body states this.
