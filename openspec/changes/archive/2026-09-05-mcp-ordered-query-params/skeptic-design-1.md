## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Six-site enumeration is accurate, not stale.** Ran `grep -rn "queryParams" helio-mcp/src` and
   `grep -rn "Record<string, string>" helio-mcp/src` myself against the live tree. Every non-test
   hit matches design.md's list exactly: `types.ts:323`, `helioApi.ts:438,451`,
   `restDataSourceSchema.ts:50`, `pipelinesHandlers.ts:88`, `write.ts:163/175`. No seventh site found.

2. **HEL-844 archived design.md D2 confirms the premises this change relies on**: `QueryParams`'s
   companion `RootJsonFormat` reads `JsArray` (new, ordered) or `JsObject` (legacy), always writes
   the array; the legacy branch decodes key-sorted (spray-json parses `JsObject` fields into a
   `TreeMap`). `schemas/pipelines/create-pipeline-request.schema.json` already declares the
   dual-read `oneOf`. design.md's Context section states this accurately — read both files directly,
   not from any agent's paraphrase.

3. **D4's honesty split is factually correct, verified against the actual code, not asserted.**
   - `restDataSourceSchema.ts:50` — `z.record(z.string(), z.string())` inside a `.strict()` object.
     Zod's `z.record(z.string(), z.string())` will reject a `JsArray`/array value at runtime
     (values must individually validate as strings; an array of objects fails). This path is
     genuinely runtime-red today — confirmed.
   - Inline-root path: `pipelinesHandlers.ts:56` types `config?: Record<string, unknown>`, and the
     zod schemas that actually gate `create_pipeline`/`add_root`'s `config` field
     (`pipelines.ts:50`, `write.ts:334/525/694`) are all `z.record(z.string(), z.unknown())` —
     no per-field shape enforcement, so an array under `queryParams` already passes zod validation
     today. Line 88's `as Record<string, string> | undefined` is a bare TypeScript type assertion
     with zero runtime effect. So an array-shaped `queryParams` on this path is NOT rejected today
     — it flows through by accident, exactly as D4 claims. The design's requirement (task 5.7) that
     this be labelled a guard, not a red-before proof, is the honest characterization.

4. **Order-not-just-multiplicity is actually addressed, not just claimed.** D5 mandates a 6-pair
   fixture with a non-adjacent duplicate name and no numeric-like names — this defeats both the
   "small fixture" and "alphabetical fixture" traps named in HEL-844's post-mortem, plus a
   JS-specific trap (integer-like keys reordering under object round-trip) not present in the
   Scala case, showing real adversarial thought rather than a copy-paste of the Scala mitigation.
   Task 5.8 requires mutation-proving each ordering assertion against both a sort-by-name mutation
   and a group-duplicates mutation — this is the correct pair of mutations to rule out "reordered"
   and "grouped-but-reordered" failure modes, satisfying the "order survives, not merely
   multiplicity" bar explicitly.

5. **Hard constraints are respected and enforced.** No Flyway migration referenced anywhere in
   design.md/tasks.md (task 7.4 explicitly checks the diff contains none). No browser/Playwright
   work — design.md's proof strategy (D4) uses a real `node:http` server against the MCP↔backend
   seam only, never a browser. No frontend river/preview edits — Impact section and task 7.4 both
   scope the diff to `helio-mcp/src/**` plus openspec, and task 7.4 explicitly greps for
   `frontend/src/features/pipelines` to guard against it.

6. **No placeholders, hand-waving, or unresolved decisions.** Read proposal.md, design.md, tasks.md,
   and both spec deltas in full — no `TODO`/`TBD`, no deferred type decisions; D1–D7 each land on a
   concrete choice with a stated alternative-considered and rejection reason (D1 rejects tuple pairs,
   D3 rejects both normalization directions with a security-flavored rationale, D2 states branch
   order is a nicety not a correctness requirement and explains why).

7. **Spec deltas correspond to design decisions and AC.** Both `mcp-data-source-tools` and
   `mcp-pipeline-root-tools` deltas add scenarios for repeated-key authoring, order preservation,
   legacy-object continuity, and malformed-entry rejection — covering every ticket AC bullet. No
   scope drift: no new capability, no unrelated tool touched.

8. **Completeness proof (D6) is mechanically checkable and not a hand tally** — task 6.1 requires a
   recorded, empty grep for `Record<string, string>`/`z.record(z.string(), z.string())` adjacent to
   `queryParams`, explicitly scoped away from `headers` (which legitimately keeps the old shape).
   Ran the equivalent grep myself in step 1; it already returns the expected non-empty set that the
   fix will drive to zero, confirming the grep's mechanics are sound before any code changes.

### Verdict: CONFIRM

### Non-blocking notes
- D2 notes the array-first branch ordering in the zod union is not load-bearing for correctness
  (the branches are disjoint) but affects error-message quality only — correctly flagged as such,
  not overstated.
- The design is honest that hop-2 (backend → target REST host) is proven only by HEL-844's Scala
  specs and deliberately not re-proven in TypeScript; this is a reasonable non-goal, not a gap,
  given the seam-only proof strategy is explicit about what it covers.
