## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `ffdaff1a` (delta over cycle 1's `4be12981`). Gates re-run independently in
`WORKTREE_PATH` (no `CLEAN_WORKTREE`). Cycle 1's findings that were already PASS are not re-litigated;
this report covers the delta plus a re-run of every gate and of the AC5 live measurement.

### Phase 1: Spec Review — PASS

**CR1 is genuinely fixed for the general case, verified by measurement rather than by reading the
diff.** `connectorSchema.ts:44` is now `authType: z.string().min(1).optional()`. I drove the real
schema and the real handler together over four unpredicted values, counting HTTP calls against a fake
API:

| `authType` | schema parse | handler `isError` | message names `/connectors` | HTTP calls |
| --- | --- | --- | --- | --- |
| `"oauth"` | accepted | true | yes | **0** |
| `"OAUTH2"` | accepted | true | yes | **0** |
| `"digest"` | accepted | true | yes | **0** |
| `"none "` (trailing space) | accepted | true | yes | **0** |

`"none"` still parses and proceeds. So the spec delta's *"or any value other than `none`"* scenario and
ticket AC3's *"actionable next step … not a bare validation error"* are now literally true for the
general case, not just for the two values someone happened to predict. The whitespace case (`"none "`)
is worth noting: it lands on the actionable refusal rather than being silently coerced to `none`, which
is the safe direction.

**The widening opens no new channel.** This was the one thing that could have made the fix worse than
the defect. `authType` is never forwarded anywhere: `createConnectorHandler` lets only `undefined`/
`"none"` past, and `helioApi.createConnector`'s parameter type is still `{name, kind, baseUrl}` with
`config: {authType: "none"}` and `credential: ""` hardcoded at the call site (unchanged this cycle). A
free-form `authType` string therefore cannot reach `POST /api/connectors` under any input.

**CR2 is genuinely done — I verified the ticket exists rather than trusting the id.** HEL-955
("Pending-connector handoff: let an MCP agent start a credentialed Connector that a human completes
out-of-band") is real, `Backlog`, parented to epic **HEL-857**, in the v0.7 project, related to
HEL-820/828/829/886. Its body carries the deferral rationale, five ACs, and re-states the inherited
"no MCP tool accepts a credential" constraint. design.md Decision 7's slot is filled with that id *and*
its title, and tasks.md 5.1 is checked with `FILED: HEL-955`. Both halves of AC3 (record **and** file)
are now satisfied.

**Interrogation of the test edit (the HEL-879 lesson, applied literally).** The executor did not follow
the literal instruction in CR1 — it replaced `connectorSchema.test.ts`'s "rejects an unrecognized
authType value" (`success === false`) with "accepts an authType value outside the predicted enum
(validation deferred to the handler)" (`success === true`). I checked this independently rather than
accepting the stated reason, asking what the edit is compensating for:

- **The old assertion could not survive, and not because it was inconvenient.** It asserted the exact
  behavior CR1 identified as the defect. Keeping it green would have required keeping the enum, i.e.
  keeping the bug. This is the legitimate case of a test changing because the *guarantee* moved — the
  opposite of HEL-879, where a fixture was bent so an unchanged-but-wrong implementation could pass.
- **The assertion genuinely moved rather than evaporating.** `connectorHandlers.test.ts` gains an
  `authType: "oauth"` case asserting `isError`, `/connectors` in the message, **and**
  `expect(calls).toHaveLength(0)`. That is strictly more than the deleted line asserted.
- **Net assertion strength is higher, not merely preserved.** Before, an unpredicted value was proven
  only to be *rejected somewhere* (schema), with nothing proving the agent got an actionable message.
  Now the same input is proven to (a) reach the handler, (b) receive the `/connectors`-naming refusal,
  and (c) cause zero HTTP calls. Nothing the old test protected is now unprotected: "an unpredicted
  authType never reaches the backend" is still proven, just by the call-count assertion instead of by
  a parse failure. The rewritten schema test also does real work as a regression guard — re-narrowing
  `authType` to an enum turns it red immediately.

**Your `authType: ""` question — my call: genuinely fine, not an AC3 violation in miniature.** It is
rejected at the schema layer by `.min(1)` with a bare `String must contain at least 1 character(s)`,
and it never reaches the handler. I read this as materially different from CR1, on three grounds:

1. **The requirement's own scoping clause.** The spec requirement opens *"When an agent indicates …
   that the target host requires authentication — by requesting any `authType` other than `none`"*.
   The literal "any value other than none" phrase is subordinate to "indicates … requires
   authentication". `"oauth"` is such an indication; `""` indicates nothing at all. It is malformed
   input, not a declaration about the host.
2. **Routing it to the handler would produce a worse message, not a better one.** The handler's prose
   interpolates the value: `authType "" needs a credential, which cannot be supplied through MCP`.
   Naming the out-of-band path in response to an empty string is not an actionable next step — it is a
   confident non-sequitur, which is a failure mode this repo has been bitten by before.
3. **No class of realistic agent behavior is stranded.** CR1 mattered because "an agent uses a word we
   didn't enumerate" (`oauth`, `digest`, `basic`, `hmac`) is the *normal* case and it was dead-ended.
   An agent expressing a credentialed host writes a word; `""` is a serialization slip, and the
   correct response to a serialization slip is a schema error.

Recorded as a non-blocking suggestion below rather than a change request, with the one-line tightening
available if anyone wants belt-and-braces.

No new scope creep (the cycle-2 delta touches three `helio-mcp` files plus planning artifacts, zero
`backend/`/`frontend/`/`schemas/`). Planning artifacts match the implementation; `connectorSchema.ts`'s
header comment was updated to explain the widening rather than left describing the old enum.

### Phase 2: Code Review — PASS

Gates re-run by me this cycle, fresh:

| Gate | Result |
| --- | --- |
| `npm run lint` (`eslint . --max-warnings=0`) | PASS |
| `npm run format:check` | PASS |
| `npm test` (root + frontend) | PASS — 22/22 + 252/252 suites, **211** (was 209) + 2588 tests |
| `npm --prefix helio-mcp run typecheck` | PASS |
| `npm --prefix helio-mcp run build` | PASS |
| `tsc` on `e2e/connector-authoring.ts` | PASS |

`sbt test` not run: zero `backend/**` files changed on this branch.

The +2 test count matches the delta exactly (one added schema case, one added handler case; one case
rewritten in place) — no test was quietly dropped. The schema→handler seam is type-checked rather than
assumed: `write.ts` passes the parsed input straight into `createConnectorHandler`, whose
`authType?: string` parameter accepted the widened type with no cast and no handler edit, which is why
this fix needed one line of production code.

### Phase 3: UI Review — N/A

No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`. Servers were started
and exercised anyway as part of the AC5 re-measurement below.

### AC5 live re-measurement — PASS (provenance: scratch DB, see below)

Re-run end to end this cycle, not carried over from cycle 1:

```
SETUP: registering a throwaway user + minting a PAT (out-of-band, pre-measurement)... done.
MEASURED: reaching the backend ONLY via the spawned MCP child process over stdio.
  list_connectors: empty, with create_connector hint -- as expected.
  create_connector: id=1da84c2d-d344-48ad-a86f-e3f6e6ee41fe
  create_rest_data_source: source=44807739-..., inferredSchema present, fetchError null.
  pipeline=8ae78220-... output=77e4f5fe-... rows=1
All AC5 pass criteria evaluated and satisfied. Zero direct HTTP calls in this phase.
TEARDOWN: WARNING: teardown of connector 1da84c2d-... failed: 409 ConnectorHasDependents
EXIT=0
```

**Provenance caveat, stated because it is the one gap between this evidence and a real
shared-environment run:** this ran against an isolated scratch database (`helio_hel886eval2`), not the
shared dev Postgres. That was not a preference — I tried the shared DB first, per instruction, and the
backend failed to boot on Flyway validation:

```
Migration description mismatch for migration version 96
 -> Applied to database : canonicalize inferred schema types
 -> Resolved locally    : canonicalize inferred schema type
```

I reported this to the orchestrator before working around it, including a measured diagnosis: every
V96 file on disk across main and all worktrees is `V96__canonicalize_inferred_schema_type.sql`
(singular), while the repaired history row reads `96|canonicalize inferred schema types|-657209829|t`
— the checksum half of the earlier repair is correct, the description half matches no file that
exists. **Entirely unrelated to HEL-886** (this branch adds no migrations and touches no backend file),
but it means no HEL-886 evidence in either cycle has been produced against the shared dev DB. What the
scratch-DB run does *not* prove is anything about shared-DB state; what it does prove — the MCP tool
chain, the egress path, the AC5 criteria — is independent of which database backs the API.

### Overall: PASS

Both cycle-1 change requests are resolved, verified independently rather than by report. No new issues.

### Non-blocking Suggestions

(carried forward from evaluation-1.md, none blocking, plus one new)

- **New:** if the `authType: ""` edge is ever revisited, `z.string().min(1, { message: "authType must
  name an auth scheme — create_connector only creates unauthenticated (authType: none) Connectors; a
  credentialed host is completed by a human at the in-app /connectors page." })` makes the spec
  sentence literally true for that input too, at zero behavioral cost. My judgment is that this is
  optional, per Phase 1's reasoning.
- The schema layer and handler layer are each tested for the unpredicted-`authType` path, but nothing
  composes them in one assertion. `write.ts`'s wiring is covered only by `server.test.ts`'s
  registration check plus the type-checked seam. Adequate as-is; a single parse-then-handle test would
  close it outright.
- `read.ts:200-210` duplicates `guarded`'s error mapping inline because `guarded` hardcodes
  `jsonResult`; a `toResult` parameter would de-duplicate it.
- `connectorSchema.ts`'s denylist message inherits "credentials live on the **referenced Connector**",
  slightly odd for the tool that creates the Connector. Cosmetic.
- `e2e/connector-authoring.ts:178` checks `CONNECTOR_MASTER_KEY` in the script's own process env, a
  documented proxy for the backend's.
- `write.ts` is 829 lines, past CONTRIBUTING's ~400-line "propose a split" threshold — pre-existing,
  and this change moved logic out rather than in.
- `fail()`'s `process.exit(1)` bypasses the `finally` teardown on a failing measured phase.

### Residue check — clean

- Scratch DB `helio_hel886eval2` dropped; no database matching `hel886` exists (`psql -l`).
- `backend/.env` `DATABASE_URL` restored to the shared `helio` database.
- Dev servers on 9225/6318 stopped; both ports free.
- `helio-mcp/dist-e2e/` removed; `git status --porcelain` empty.
- No new `git worktree` entries; `cleanup.sh` was not invoked at any point.
