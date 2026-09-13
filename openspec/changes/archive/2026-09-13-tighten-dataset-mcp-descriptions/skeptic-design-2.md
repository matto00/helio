## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Spawn-cwd guard: READY. Re-read ticket.md, proposal.md, design.md, tasks.md, specs/mcp-data-source-tools/spec.md fresh; re-checked backend/MCP ground truth. Reviewed HEAD 0a22d471.

1. Tool name — RESOLVED. `helio-mcp/src/tools/write.ts:59` registers `create_data_source`; zero hits for `create_dataset_data_source` in any change artifact (excluding skeptic-design-1.md). Other names confirmed: append_dataset_rows (write.ts:98), replace_dataset_rows (:119), update_dataset_schema (:181), get_dataset_schema (read.ts:279).
2. Explicit-null wording — RESOLVED. `DatasetRowValidator.scala:117-142`: rejects only `row.size > declaration.size`; line 122-123 `raw = row.lift(i).getOrElse(JsNull)`, `missing = raw == JsNull` -> default, else required error, else JsNull. Proposal, design Decision 1, tasks 2.1, and spec delta (requirement body + new "Explicit null ... treated as missing" scenario + rejection scenario) all describe short AND explicit-null positions identically and correctly.
3. ADDED vs MODIFIED — RESOLVED. The column-type requirement is under `## ADDED Requirements`; live spec has no such requirement (headers at lines 9-461 checked). Both MODIFIED headers match live spec lines 368 and 384 verbatim.
4. Null-default MODIFIED block — RESOLVED. `create_data_source exposes the full declared-schema shape` is now MODIFIED, carving out the "forwarded unchanged" claim, with a scenario. Confirmed `StaticColumnPayload` uses `jsonFormat4` (DataSourceProtocol.scala:635).
5. Tool list consistency — RESOLVED. create_data_source / get_dataset_schema / update_dataset_schema in proposal, design Decision 3, tasks 1.3 + 4.2(c), and spec ADDED requirement.
6. Test runner — RESOLVED. Root `jest.config.cjs` (ts-jest, `<rootDir>`-anchored worktree ignore, so a worktree-local run collects its own tests); frontend guard walks up from `__dirname` to a dir containing `backend` (lines 13-23), which works from `helio-mcp/src/tools/`. `CanonicalWireValues` + `fromString` confirmed at model.scala:735-749, 7 values in stated order.

No new contradiction introduced.

### Verdict: CONFIRM

### Non-blocking notes
- proposal.md "Why" says findings were "confirmed via a fresh MCP process" — that is task 4.1/4.2 work not yet done; keep it as a claim for the evaluator to check, not evidence.
- proposal.md Capabilities/Impact summary does not mention the new MODIFIED block for `create_data_source` (the spec delta itself is correct).
- tasks 4.2(b) "missing/null-required-field row": use a required field with no default, since a present default is consulted first.
