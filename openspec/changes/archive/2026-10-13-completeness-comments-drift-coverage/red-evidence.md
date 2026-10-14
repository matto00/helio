# HEL-1467 red / mutation evidence

## 2.0 Unmodified tree: oneOf "form" branch removed from schemas/panels/panel.schema.json
Command: remove the branch, then `node scripts/check-schema-drift.mjs`. The drift goes undetected today (exit 0).
```
schemas in sync with JsonProtocols (124 checked across 54 protocol files)
panel-type enums in sync with backend canonical sets (9 surfaces checked)
panel-kind enum coverage: 5 schema enums detected, each checked or exempted
AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces checked)
exit=0
```
Restore: `git checkout -- schemas/panels/panel.schema.json`; `git diff --exit-code -- schemas/panels/panel.schema.json` -> exit 0.

## 2.1 Self-test cases against a `findPanelKindConstGroups` stub returning [] (enumKey unchanged)
Assertion failures (no load error; module loads, cases run). Output of `node scripts/check-schema-drift.selftest.mjs | grep -v '^ok'`:
```
FAIL findPanelKindConstGroups detects a oneOf per-branch const group as one wildcard path
     []
FAIL findPanelKindConstGroups detects an allOf if/then const group (create-panel shape)
     []
FAIL an unchecked, unexempted const group fails coverage, naming file and wildcard path
     
FAIL the real panel.schema.json and create-panel-request.schema.json each yield a const group
     panels/panel.schema.json: []
FAIL a nested combinator const group is reported once, by its innermost combinator
     []
FAIL a Windows-style key (panels\x.json) matches the same surface written panels/x.json
     panel-kind enum coverage: schemas/panels\x.schema.json#properties.type.enum holds a panel-kind enum but is neither a checked surface (panelTypeSurfaces in scripts/check-schema-drift.mjs) nor exempted (PANEL_KIND_ENUM_EXEMPTIONS in scripts/lib/panelKindEnumCoverage.mjs)

6 check-schema-drift selftest case(s) failed
```
Labels (the nested-case expectation was later corrected from `oneOf.*.anyOf.*...` to `oneOf.0.anyOf.*...` before the real helper; it is red against the stub either way):
- RED vs stub: "detects a oneOf per-branch const group"; "detects an allOf if/then const group"; "an unchecked const group fails coverage" (stub finds nothing so no error is produced); "real panel.schema.json and create-panel-request.schema.json each yield a const group"; "nested combinator reported once".
- RED vs current enumKey: "Windows-style key matches" (raw `panels\x` != `panels/x`, so coverage reports a spurious uncovered enum).
- GUARD (passes against the stub, so NOT a red; failable only by a mutation of the real helper): "consts outside a combinator, and a one-kind combinator const group, are ignored".

# Mutations after the fix (files staged with explicit `git add`, so `git diff --exit-code -- <file>` compares the working file with the fixed version)

## m1: findPanelKindConstGroups made to return []
```
FAIL findPanelKindConstGroups detects a oneOf per-branch const group as one wildcard path
     []
FAIL findPanelKindConstGroups detects an allOf if/then const group (create-panel shape)
     []
FAIL an unchecked, unexempted const group fails coverage, naming file and wildcard path
     
FAIL the real panel.schema.json and create-panel-request.schema.json each yield a const group
     panels/panel.schema.json: []
FAIL a nested combinator const group is reported once, by its innermost combinator
     []

5 check-schema-drift selftest case(s) failed
selftest exit=1
restore proof: git diff --exit-code -- scripts/lib/panelKindEnumCoverage.mjs -> exit 0
```

## m2: "form" oneOf branch removed from panel.schema.json (same mutation as red 2.0, now with the fix)
```
Schema/JsonProtocols drift detected:

schemas/panels/panel.schema.json oneOf.*.properties.type.const:
  missing: form

Update either the schema in schemas/ or the case class under backend/.../api/protocols/ so they agree.
For panel-type enum mismatches, widen the diverging surface to match the backend canonical set (PanelType.fromString / DataPanelKinds).
For AssistantProposalToolSchemas.scala mismatches, update the tool's hand-rolled JsObject schema (or the schemas/ JSON Schema it mirrors) so they agree.
exit=1
restore proof: git diff --exit-code -- schemas/panels/panel.schema.json -> exit 0
```

## m3: panel.schema.json oneOf const surface removed from panelTypeSurfaces
```

panel-kind enum coverage: schemas/panels/panel.schema.json#oneOf.*.properties.type.const holds a panel-kind enum or const group but is neither a checked surface (panelTypeSurfaces in scripts/check-schema-drift.mjs) nor exempted (PANEL_KIND_ENUM_EXEMPTIONS in scripts/lib/panelKindEnumCoverage.mjs)

Update either the schema in schemas/ or the case class under backend/.../api/protocols/ so they agree.
For panel-type enum mismatches, widen the diverging surface to match the backend canonical set (PanelType.fromString / DataPanelKinds).
For AssistantProposalToolSchemas.scala mismatches, update the tool's hand-rolled JsObject schema (or the schemas/ JSON Schema it mirrors) so they agree.
exit=1
restore proof: git diff --exit-code -- scripts/check-schema-drift.mjs -> exit 0
```

## m4: enumKey stops normalizing separators
```
FAIL a Windows-style key (panels\x.json) matches the same surface written panels/x.json
     panel-kind enum coverage: schemas/panels\x.schema.json#properties.type.enum holds a panel-kind enum or const group but is neither a checked surface (panelTypeSurfaces in scripts/check-schema-drift.mjs) nor exempted (PANEL_KIND_ENUM_EXEMPTIONS in scripts/lib/panelKindEnumCoverage.mjs)

1 check-schema-drift selftest case(s) failed
selftest exit=1
restore proof: git diff --exit-code -- scripts/lib/panelKindEnumCoverage.mjs -> exit 0
```

## m5 (makes the GUARD case failable): const-group threshold lowered to >= 1 kind
```
FAIL consts outside a combinator, and a one-kind combinator const group, are ignored
     [["oneOf","*","properties","type","const"]]

1 check-schema-drift selftest case(s) failed
selftest exit=1
restore proof: git diff --exit-code -- scripts/lib/panelKindEnumCoverage.mjs -> exit 0
```

## Cycle 2 note
Change requests CR1 (SecondSourceGuardSpec re-derive command now a kind-id grep, S16/S16b/S16c), CR2 (full spec name, S17), non-blocking (a) (PipelineShape list marked as examples, S18) and (b) (enumKey doc corrected: exemption keys are compared as written; no behavior change, so no new mutation, S19).
