## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `4be12981`. Gates re-run independently in `WORKTREE_PATH` (no `CLEAN_WORKTREE`).

### Phase 1: Spec Review — FAIL

Verified PASS:

- **AC1 / AC5 — independently reproduced.** I re-ran the e2e myself (I did not trust the executor's
  report). The shared dev DB is currently poisoned by an unrelated Flyway checksum mismatch (another
  worktree's migration — this branch touches zero backend files), so I ran the backend against my own
  throwaway DB `helio_hel886eval`, exactly as the executor did. Transcript of my run:

  ```
  SETUP: registering a throwaway user + minting a PAT (out-of-band, pre-measurement)... done.
  MEASURED: reaching the backend ONLY via the spawned MCP child process over stdio.
    list_connectors: empty, with create_connector hint -- as expected.
    create_connector: id=e453ce5b-81e8-46e0-a5f6-0679240ea68a
    create_rest_data_source: source=e9aa0f84-..., inferredSchema present, fetchError null.
    pipeline=6c2ec100-... output=ca2c224a-... rows=1
  All AC5 pass criteria evaluated and satisfied. Zero direct HTTP calls in this phase.
  TEARDOWN: WARNING: teardown of connector e453ce5b-... failed: 409 ConnectorHasDependents
  EXIT=0
  ```

  My scratch DB was dropped, `backend/.env` restored, `helio-mcp/dist-e2e` removed, dev servers
  stopped; `git status` clean.

- **Decision 8's teardown claim is FINALLY accurate.** The brief flagged this as wrong three times.
  Verified against my own live run, not the executor's: teardown issues `DELETE /api/connectors/:id`,
  the backend returns **409 `ConnectorHasDependents`** (repository rule at
  `backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorRepository.scala:186-191`),
  and `e2e/connector-authoring.ts:138-140` logs it as a non-fatal `WARNING` — the run still exits 0.
  So the Connector **is** orphaned per run, exactly as design.md Decision 8 now says. The
  "nothing leaks across runs" claim also holds and I verified its mechanism rather than the prose:
  every run registers a new `hel-886-e2e-<uuid>@example.invalid` user
  (`e2e/connector-authoring.ts:105`) and every created resource is owned by that user, so the
  zero-Connector precondition is true by construction on run *n+1*. My run's `list_connectors` was
  genuinely empty on a database that already contained other users' data.

- **4.7c assertions are real hard failures, not warnings.** `fail()`
  (`e2e/connector-authoring.ts:88-91`) writes to stderr and calls `process.exit(1)`. The three AC5
  criteria (`inferredSchema === null`, `fetchError !== null`, `rows.items.length === 0`, lines
  253-282) each call it directly. I proved `fail()` really exits non-zero by triggering it twice (see
  Phase 2, preflight).

- **4.7b preflight cannot downgrade or report success.** Measured, not read: with the host rewritten
  to an unresolvable name the script exited **1** naming the host and the egress requirement; with
  `CONNECTOR_MASTER_KEY` unset it exited **1** naming that variable. There is no static-source
  fallback anywhere in the file.

- **AC2 — the HEL-828 guarantee survives, and I checked the executor's claim rather than accepting
  it.** `git diff main...HEAD -- helio-mcp/src/tools/restDataSourceSchema.test.ts` is a **pure
  addition** (one new `it` block at the end); every pre-existing denylist assertion is byte-for-byte
  unmodified. I did not rely on the executor's string-concatenation argument for message identity —
  I extracted the pre-change message from `git show main:...` and compared it to the post-change
  message produced at **runtime**:
  - pre-change: `apiKey is not accepted by create_rest_data_source — credentials live on the referenced Connector, never on this call. Pass connectorId instead.`
  - post-change (runtime): identical, character for character.

- **AC4 — both discoverability messages verified at runtime**, not by reading: empty
  `list_connectors` emits a second text block naming `create_connector` (proven live above), and a
  missing *or blank* `connectorId` yields
  `connectorId is required — call list_connectors to obtain one, or create_connector if none exist yet.`

- **Decision 1 — `credential: ""` is structurally unpopulatable.** `helioApi.ts:322-332` hardcodes
  the literal in the POST body; `createConnector`'s parameter type is `{name, kind, baseUrl}` only,
  so there is no parameter to thread one through; `connectorSchema.ts` rejects `credential` (and four
  siblings) explicitly and is `.strict()` besides. No code path can populate it.

- **Fixture/test-data interrogation (per the HEL-879 lesson).** There are **no** fixture or test-data
  edits in this diff to compensate for anything. The only two edits to pre-existing tests are
  `server.test.ts`'s `EXPECTED_TOOL_NAMES` (an addition demanded by registering a new tool — the list
  is an exhaustive registry assertion, so *not* editing it would be the bug) and the additive
  `restDataSourceSchema.test.ts` case. Nothing was loosened, renamed, or weakened.

**Issue 1 (blocking) — AC3 / spec scenario "Agent requests an authenticated Connector" is not
satisfied for `authType` values outside the enum.** The spec delta this change authors says
literally: *"WHEN `create_connector` is called with an `authType` of `bearer`, `api_key`, **or any
value other than `none`** … THEN … the tool returns a message … explicitly naming that path."* The
ticket's AC3 says the agent must get *"an actionable next step naming the out-of-band path — not a
bare validation error."* `connectorSchema.ts:41` narrows `authType` to
`z.enum(["none","bearer","api_key"])`, so any other value never reaches
`createConnectorHandler`'s good refusal. Measured at runtime with `authType: "oauth"`:

```
["Invalid enum value. Expected 'none' | 'bearer' | 'api_key', received 'oauth'"]
```

That is exactly the bare validation error design.md Decision 2 itself argues against ("Rejecting it
at the Zod layer instead would produce a generic enum error — exactly the 'bare validation error' the
ticket rules out"). The implementation applies that reasoning to two values and not to the rest. The
shipped test `connectorSchema.test.ts` ("rejects an unrecognized authType value") asserts only
`success === false` and deliberately does not assert the message — so the gap is visible in the test
suite as written.

**Issue 2 (blocking, orchestrator-owned) — AC3's filing half is unmet.** tasks.md 5.1 is unchecked
and design.md Decision 7's *"Follow-up ticket id: _(filed at task 5.1; recorded here)_"* placeholder
is still empty. AC3 permits deferral only *"if it is deferred, record that decision **and file the
follow-up**"*. The recording half is done; the filing half is not. `files-modified.md` states this
was left out per explicit instruction, so this is not an executor failing — but the AC is not
satisfiable at merge time with the slot empty.

Everything else in Phase 1 is clean: no AC silently reinterpreted, no scope creep (zero
`backend/`, `frontend/`, `schemas/` files touched), no regression to other specs, planning artifacts
match the implementation (including the corrected Decision 8).

### Phase 2: Code Review — PASS

Gates re-run by me, fresh, in `WORKTREE_PATH`:

| Gate | Result |
| --- | --- |
| `npm run lint` (`eslint . --max-warnings=0`) | PASS |
| `npm run format:check` | PASS |
| `npm test` (root + frontend) | PASS — 22/22 + 252/252 suites, 209 + 2588 tests |
| `npm --prefix helio-mcp run typecheck` | PASS |
| `npm --prefix helio-mcp run build` | PASS |
| `tsc` on `e2e/connector-authoring.ts` | PASS |

`sbt test` not run: zero `backend/**` files changed.

- **No-half-created-state proof is genuine.** `connectorHandlers.ts:31-47` returns the refusal before
  the `guarded(...)` block, so `api.createConnector` is never reached.
  `connectorHandlers.test.ts` proves it the right way — a fake API records calls and the two refusal
  tests assert `expect(calls).toHaveLength(0)`, i.e. **zero calls**, not merely that an error came
  back. That is the correct boundary for this claim (the HTTP call is made inside `api.createConnector`
  and nowhere else).
- Denylist extraction (Decision 3) is parameterized on both varying axes; no duplication.
- Tests do not leak the fake secret: `connectorSchema.test.ts` asserts the rejected value
  (`sk-should-never-be-accepted`) does not appear in the serialized Zod issues — a meaningful check,
  not a tautology.
- Type safety: `CreateConnectorResult` is mapped field-by-field, never spread, so backend
  `config`/`ownerId` cannot leak into a result. The two `as unknown as HelioApi` casts are confined to
  test fakes.
- Error handling: backend refusals surface verbatim (Decision 6), proven by test.
- No dead code, no TODO/FIXME, no `any` escape hatches in `src/`, comments follow the repo's
  "why not what" standard.

### Phase 3: UI Review — N/A

No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**` (the spec delta lives
under `openspec/changes/**`). Servers were nonetheless started and exercised as part of the AC5
measurement above.

### Overall: FAIL

### Change Requests

1. `helio-mcp/src/tools/connectorSchema.ts:41` — widen `authType` so *every* non-`none` value reaches
   `createConnectorHandler`'s actionable refusal, instead of dying at a bare Zod enum error. Either
   change the field to `z.string().min(1).optional()` (the handler at
   `connectorHandlers.ts:31` already accepts `authType?: string` and refuses anything `!== "none"`,
   so no handler change is needed), or attach an `errorMap`/`invalid_type_error` to the enum whose
   message names the in-app `/connectors` page. Then strengthen
   `connectorSchema.test.ts`'s "rejects an unrecognized authType value" case (currently asserting only
   `success === false`) to assert the resulting message contains `/connectors`, and add a
   `connectorHandlers.test.ts` case for an arbitrary value such as `"oauth"` asserting the refusal
   message **and** `expect(calls).toHaveLength(0)`. This is what makes the spec delta's own scenario
   ("or any value other than `none`") and ticket AC3 literally true.

2. (Orchestrator) File the deferred pending-connector-handoff follow-up ticket, record its HEL-id into
   design.md Decision 7's empty `Follow-up ticket id:` slot, and check tasks.md 5.1. AC3 permits the
   deferral only together with the filing.

### Non-blocking Suggestions

- `helio-mcp/src/tools/read.ts:200-210` duplicates `guarded`'s `HelioApiError` message-mapping inline
  because `guarded` hardcodes `jsonResult`. Consider `guarded(produce, toResult = jsonResult)` so
  `list_connectors` can pass `buildListConnectorsResult` and the error mapping stays in one place.
- `connectorSchema.ts`'s denylist message inherits the shared body "credentials live on the
  **referenced Connector**, never on this call" — accurate for `create_rest_data_source`, slightly odd
  for `create_connector`, which is creating the Connector. The `alternative` clause carries the useful
  content, so this is cosmetic.
- `e2e/connector-authoring.ts:178` checks `CONNECTOR_MASTER_KEY` in the **script's** process env, not
  the backend's. The comment is admirably honest about this being a proxy; worth noting that a
  false-positive still degrades only to the opaque-500 status quo (which `fail()`s non-zero anyway), so
  it never reports success.
- `helio-mcp/src/tools/write.ts` is now 829 lines, well past CONTRIBUTING's ~400-line "propose a split"
  threshold. Pre-existing and this change moved logic *out* into two small modules, so it is going the
  right direction; flagging only so the eventual split is on record.
- On a failing measured phase, `fail()`'s `process.exit(1)` bypasses the `finally` teardown, so the
  Connector delete is not even attempted. Harmless given the per-run-user isolation, but worth a line
  in the file header if the teardown story is revisited.

### Residue check — clean

- No `helio_hel886` database exists (`psql -l`); neither does my own `helio_hel886eval` (dropped).
- `backend/.env` `DATABASE_URL` points at the shared `helio` database, restored.
- `git status --porcelain` is empty in the worktree; no `dist-e2e/` or stray artifacts.
- `git worktree list` shows no HEL-886 stragglers beyond the live delivery worktree.
- Unrelated environmental note (NOT this ticket, no action for the executor): the shared dev Postgres
  currently fails Flyway validation with a checksum mismatch (`Applied -1171980264` vs
  `Resolved -657209829`), the known shared-dev-DB collision hazard from a parallel worktree. It blocks
  `start-servers.sh` against the shared DB for any ticket until repaired.
