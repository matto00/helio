## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit evaluated: 07dd1042 (HEL-982 Widen helio-mcp queryParams to the ordered array encoding).

### Phase 1: Spec Review — PASS
Issues: none.

- All acceptance criteria addressed: array encoding expressible + forwarded unchanged in order
  (`helioApi.ts`, `restDataSourceSchema.ts`, `pipelinesHandlers.ts`, `write.ts`, `types.ts`);
  legacy object encoding still accepted unchanged; red-before test present for
  `create_rest_data_source`; completeness grep returns zero (verified independently below).
- All six sites from design.md's re-enumeration are touched: `types.ts:323` (now via the shared
  `QueryParamsInput` union), `helioApi.ts:438/451` (input type widened, forward already a pure
  pass-through — no change needed at 451, correctly noted in files-modified.md), `restDataSourceSchema.ts:50`
  (union), `pipelinesHandlers.ts:88` (cast retyped), `write.ts:163/175` (pass-through unchanged,
  description updated per D7).
- No scope creep: diff confined to `helio-mcp/src/**` and `openspec/**`.
- No regression risk to existing behavior: legacy object encoding path is asserted unchanged by
  a dedicated test (D3), and the whole `helio-mcp` suite (238 tests, 24 suites) passes.
- No schema/API-contract change needed or made (backend already dual-reads/emits per HEL-844;
  `schemas/pipelines/create-pipeline-request.schema.json` already declares the `oneOf` — correctly
  left untouched).
- Planning artifacts (design.md, tasks.md, spec deltas) match the implemented behavior; tasks.md
  has all items checked and each matches what the diff actually does.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates run fresh in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set at this speed):
- `npm run lint` — clean (zero warnings).
- `npm run format:check` — clean.
- `npm --prefix helio-mcp run typecheck` (`tsconfig.typecheck.json`) — clean.
- Root `npx tsc --noEmit -p tsconfig.json` — clean (exit 0).
- `npx jest` (root, full suite) — 24 suites / 238 tests, all green.
- `npx openspec validate mcp-ordered-query-params --strict` — "Change ... is valid".

Canonical standards: `QueryParamsInput` is a single named union (D1) referenced from all six sites
— no repeated inline unions, consistent with CONTRIBUTING.md's DRY expectations. No inline FQNs.
No dead code, no leftover TODO/FIXME. Type safety is strict throughout (no untyped escape hatches);
the one remaining `as QueryParamsInput | undefined` cast in `pipelinesHandlers.ts:88` is
unavoidable at that call site (values come off an untyped `config: Record<string, unknown>`) and
is the same pattern used for the sibling fields on the same line — not a new hazard. Security:
`.strict()` is preserved on the object schema and the new pair schema, closing the malformed-entry
path loudly rather than silently dropping fields (verified by dedicated tests). No frontend/backend
touched, so DESIGN.md tokens are not applicable here (no UI).

**Hard constraints — verified independently, all clear:**
```
git diff --name-only main...HEAD | grep -E "backend/src/main/resources/db/migration|^backend/|\.husky/|frontend/src/features/pipelines"
```
returns nothing (grep exit 1) — no Flyway migration, no backend change at all, no `.husky/**`
change, nothing under `frontend/src/features/pipelines`.

**Soft spot 1 — red-before-fix guard, re-verified by mutation (not accepted on the executor's word):**
The commit's own comment states the true pre-fix ZodError transcript was captured manually and is
no longer re-runnable since the old schema is gone. I mutated the shipped code to restore the old
schema (`queryParams: z.record(z.string(), z.string()).optional()` in `restDataSourceSchema.ts`)
and reran `queryParamsOrdering.test.ts`. Result: 4 of 8 tests went RED, including the
"RED-BEFORE-FIX PROOF" test itself (its `safeParse(...).success` assertion flips to `false`,
throwing the exact captured ZodError: `expected: "object", received: "array"`), plus the
authored-order test and both mutation-proof tests (which depend on the array parsing at all).
Reverted cleanly (`git diff` empty afterward). **Conclusion: the shipped suite is a real guard,
not a comment-only claim — reverting the union to the old scalar-record schema does go red.**

**Soft spot 2 — mutation-proofs re-run by me against real source, not just the test's own inline
comparison:** I mutated `helioApi.ts`'s `createRestDataSource` to sort `queryParams` by name
before the POST (`Array.isArray(input.queryParams) ? [...input.queryParams].sort(...) : ...`) and
reran the suite. Result: 3 tests went RED (the authored-order assertion, the sort-by-name
mutation-proof test, and the inline-root GUARD test) — confirming the ordering assertions are not
vacuous against a real sort mutation, not merely against a hand-computed comparison array baked
into the test file. Reverted cleanly (`git diff` empty afterward). Did not additionally re-run the
group-duplicates mutation against real source (the sort mutation already proves the harness reacts
to real behavior changes, and the group-duplicates assertion uses the identical mechanism against
the same real request capture) — this is a lighter-touch confirmation than re-mutating both, but
sufficient given the sort mutation already demonstrates the guard is load-bearing.

**Task 6.1 completeness grep — independently re-run:**
```
grep -rn "queryParams" helio-mcp/src | grep -i "Record<string"
```
returns empty (exit 1) on the committed tree, confirming zero remaining `Record<string, string>`
declarations adjacent to any `queryParams` site. (Other unrelated `z.record(z.string(), z.string())`
hits exist for `headers` and `proposal.ts`'s `fieldMapping`, correctly out of scope per D6's own
carve-out.)

**Fixture (D5) — independently inspected, not accepted on description alone:**
```ts
const FIXTURE: QueryParamPair[] = [
  { name: "z", value: "1" }, { name: "tag", value: "a" }, { name: "alpha", value: "2" },
  { name: "tag", value: "b" }, { name: "m", value: "3" }, { name: "beta", value: "4" },
];
```
Six pairs (not two); non-alphabetical (z, tag, alpha, tag, m, beta); duplicate name `tag` at
indices 1 and 3 — non-adjacent; no numeric-like names. Satisfies D5 exactly.

**Real-server assertion — confirmed, not a mock:** `queryParamsOrdering.test.ts`'s `startHarness()`
starts an actual `http.createServer` on an ephemeral port, records the parsed JSON body of every
request, and points a real `HelioApi`/`HelioHttpClient` at its address. Assertions are against
`harness.requests[0].body.config.queryParams`, i.e. what the server actually received — not a
return-code check. No `jest.mock`/stubbed fetch anywhere in the file.

**Legacy encoding pass-through (D3) — confirmed unchanged in both directions:** the "legacy object
encoding" test asserts `body.config.queryParams` deep-equals the exact object literal passed in,
with no reordering/array-conversion; `helioApi.ts`'s POST body construction performs no
transformation on `input.queryParams` in either direction (confirmed by reading the diff and by
the sort-mutation experiment above, which required editing this exact pass-through line to break
it — i.e. as-shipped it does nothing but forward).

### Phase 3: UI Review — N/A
No `frontend/**`, no `backend/src/main/scala/routes/ApiRoutes.scala`, no `schemas/**`, no
`openspec/specs/**` changes (only `openspec/changes/mcp-ordered-query-params/specs/**` deltas,
which are change-scoped proposal artifacts, not the live spec tree). Diff is confined to
`helio-mcp/src/**` and `openspec/changes/mcp-ordered-query-params/**`. Per the orchestrator's
explicit instruction, dev servers and Playwright were not started for this ticket.

### Overall: PASS

### Non-blocking Suggestions
- The group-duplicates mutation-proof was only re-verified via the test file's own inline
  hand-computed comparison array, not by mutating real source (unlike the sort-by-name proof,
  which I did mutate for real). This is very low risk given the identical mechanism, but a future
  cycle could re-run that second mutation against real source for full parity with the sort-proof.
- `files-modified.md` slightly undersells the shared `types.ts` union's reach (states widening
  `helioApi.ts`'s POST body "needed no change," which is correct, but doesn't call out that this
  is exactly the fully-behavior-preserving, non-normalizing forward D3 requires) — purely a
  documentation clarity nit, not a defect.
