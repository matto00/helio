## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 0a22d471c1574cafb1030896fa2ef8b1ae6350e9 (planning artifacts untracked in the worktree).

### What I verified (with evidence)
- assert-cwd.sh: READY ambient=/home/matt/Development/helio branch=task/tighten-dataset-mcp-descriptions/HEL-1129.
- Finding 1 premise: CONFIRMED. `DatasetRowValidator.validateRow` (DatasetRowValidator.scala:118-142) rejects only `row.size > declaration.size`; missing positions read via `row.lift(i).getOrElse(JsNull)` fall back to `default`, then required/JsNull. NOTE (see CR 2): the `missing` test is `raw == JsNull`, so an explicit `null` *inside* a full-length row is treated identically to a missing trailing field.
- Finding 2 premise: CONFIRMED. `StaticColumnPayload` (DataSourceProtocol.scala:243-248) is `default: Option[JsValue]` with `jsonFormat4` (line 635), which reads a present JsNull as None. `DatasetFieldDeclarationPayload`'s hand-rolled reader (lines 696-705) maps present-null to `Some(None)`, so the distinction is kept on update. Behavioural impact is limited to required+null-default, as the ticket says.
- Finding 3 premise: CONFIRMED. `DataFieldType.CanonicalWireValues` (model.scala:735-736) plus the `fromString` table lists the 7 values in the order the plan gives. The frontend guard pattern exists (canonicalFieldTypesDriftGuard.test.ts).
- Test infra: helio-mcp has no test script. Its `*.test.ts` files run under the root `jest.config.cjs` (ts-jest, NodeNext override), via root `npm test`.
- Scope: no backend change and no HEL-1132 fold-in. The bounds are appropriate.
- Tool names in code: helio-mcp/src/tools/write.ts:58 registers `create_data_source`. No `create_dataset_data_source` tool exists anywhere.

### Verdict: REFUTE

### Change Requests
1. **Wrong tool name throughout.** proposal.md, design.md (Goals, Decision 2, Decision 3), tasks.md 1.3/3.1/4.2, and spec delta all name `create_dataset_data_source`. The real tool is `create_data_source` (write.ts:58), which the live spec also uses (openspec/specs/mcp-data-source-tools/spec.md:368). Replace every occurrence. Task 4.2(a) as written calls a tool that does not exist.
2. **The Finding-1 description fix is still inaccurate.** The validator treats an explicit `null` at any position like a missing field (DatasetRowValidator.scala:124, `missing = raw == JsNull`). That means `[null, 5]` gets the default substituted for the null, or is rejected as `required`. Tasks 2.1 and the spec delta describe only trailing short-row padding. Extend the description, the requirement text, and one scenario to say that an explicit `null` value is handled the same way as an omitted trailing value.
3. **The spec delta's new requirement is mis-sectioned.** "Dataset tool descriptions enumerate valid column types" does not exist in the live spec, yet it sits under `## MODIFIED Requirements`. Move it under `## ADDED Requirements`.
4. **Finding 2 has no spec delta.** The live requirement "create_data_source exposes the full declared-schema shape" (spec.md:368-382) says `required`/`default` are forwarded "unchanged". The plan records that an explicit `default: null` is collapsed at creation. Add a MODIFIED block for that requirement stating the documented limitation and the `update_dataset_schema` workaround. The block's header must be copied verbatim from the live requirement.
5. **Column-type enumeration coverage is contradictory and incomplete.** The proposal lists `create_data_source`, `append_dataset_rows`' callout, and `get_dataset_schema`. Tasks 1.3 and design Decision 3 list only create plus get_schema. `update_dataset_schema` also accepts a `type` string (write.ts:199) and is left out of every list. Pick one set and use it in all four artifacts. At minimum that set must include `update_dataset_schema`, because the spec's own "accepts ... a column's type" wording covers it.
6. **Remove the deferred test-runner decision.** Design Decision 3 says "Jest/vitest (whichever helio-mcp already uses)". State it concretely: root Jest with ts-jest, collected from `helio-mcp/src/**`. Also note that helio-mcp compiles as NodeNext ESM. The frontend guard's `__dirname` walk-up may not port directly, so the implementer must confirm the path resolution works under this config.

### Non-blocking notes
- Task 4.2 should include one creation call with `required: true, default: null` to show on a fresh process that the documented limitation really happens.
- Task 2.2 ("update the delta if implementation reveals nuance") is fine, but CR 2 is exactly such a nuance and belongs in the plan now.
