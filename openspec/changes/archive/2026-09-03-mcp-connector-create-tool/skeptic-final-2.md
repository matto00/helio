## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review, focused per brief on commit 2d53e697 (`.strict()` → `.passthrough()` + `superRefine`)
and commit db8541d2 (spec restatement). Everything skeptic-final-1.md confirmed is treated as
established; I did not re-litigate it. All findings below are from probes I wrote and ran myself
in this worktree, each reproduced at least twice.

### What I verified (with evidence)

**The spec restatement (db8541d2) is sound — it does not weaken the requirement.** Read the full
diff. It replaces the combinator name with the guarantee ("reject each key it does not recognize —
by `.strict()`, or by an equivalent exhaustive unrecognized-key check that is no more permissive",
"naming BOTH the offending key and the out-of-band path", "never merely be stripped or passed to
the handler"). That is strictly stronger than the `.strict()` text it replaced (`.strict()` cannot
name the key). `create_rest_data_source`'s lines 64/84 are untouched and its schema is unchanged
(`git diff` on `restDataSourceSchema.ts` is +11/-0 test-only plus the denylist extraction).
**The spec is not the problem. The code no longer satisfies it.**

**Direct schema probe** (`createConnectorSchema.safeParse`, 14 inputs). Correctly rejected, each
naming the key + `/connectors`: `secret`, `config` envelope, `constructor`, `""` (empty-string
key), `Name`/`APIKEY` (case variants), `" token"` (leading space), all five denylist fields.
Symbol keys are dropped by JSON transport and by Zod alike (no own symbol survives) — not a hole.

**Live MCP SDK probe** (`Client` + `InMemoryTransport` against the real `createServer`, with an
API proxy that logs any HTTP call) — this is where the two defects below were confirmed end to
end, not by reasoning.

**Side-by-side regression proof.** I registered the pre-fix schema (`git show
ffdaff1a:helio-mcp/src/tools/connectorSchema.ts`) and the post-fix schema on one server and
compared what the SDK does with each. Output verbatim:

```
pre  -> {"type":"object","properties":{"name":{...},"baseUrl":{...},"kind":{...},"authType":{...},
         "auth":{},"apiKey":{},"token":{},"password":{},"credential":{}},
         "required":["name","baseUrl"],"additionalProperties":false,...}
post -> {"type":"object","properties":{}}
PRE  __proto__: false      (rejected)
POST __proto__: true       (accepted)
```

**Gates.** `npx jest --testPathPatterns=helio-mcp` → 22 suites / 213 tests pass. The green suite
does not catch either defect below; both live outside what the new tests exercise. Per brief I
place no weight on `check:no-credential-leak` (scans zero files of this diff).

**Residue.** `git status --short` clean after my probes (all temp files removed). I did not run
`cleanup.sh`.

### Verdict: REFUTE

The CR1 fix is a net regression on the validation boundary it was meant to tighten. It fixed the
message and, in the same stroke, (a) made the tool advertise an **empty** input schema to every
MCP client and (b) let a key through that `.strict()` rejected. Both were introduced by 2d53e697
and neither existed at ffdaff1a.

### Change Requests

1. **`create_connector` now advertises an EMPTY JSON Schema — tool discovery is silently
   degraded.** `helio-mcp/src/tools/write.ts:132` passes `createConnectorSchema`, which since
   2d53e697 is a `ZodEffects`, not a `ZodObject`. The SDK's `normalizeObjectSchema`
   (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js:79-120`) returns
   `undefined` for a v3 `ZodEffects` (it only unwraps things with a `.shape`), and
   `mcp.js:75-83` then falls back to `EMPTY_OBJECT_JSON_SCHEMA`. Confirmed live over
   `Client.listTools()`: `create_connector inputSchema: {"type":"object","properties":{}}`,
   while its sibling `create_rest_data_source` correctly advertises all 14 properties, and the
   pre-fix `.strict()` version advertised the full schema with `additionalProperties:false` and
   `required:["name","baseUrl"]`. An agent discovering this tool now sees a parameterless tool:
   it cannot learn that `name`/`baseUrl` are required, cannot see `authType`, and — directly
   against this change's own security narrative — cannot see the always-rejecting
   `auth`/`apiKey`/`token`/`password`/`credential` denylist fields advertised at all. Runtime
   enforcement does still hold (`validateToolInput` falls back to `schemaToParse = tool.inputSchema`
   when normalization returns `undefined`), so this is a discoverability/contract defect, not a
   security hole — but it is a real, shipped, client-visible regression that the executor's claimed
   "verified via `Client.callTool` over InMemoryTransport" check missed because `callTool` never
   reads the advertised schema. Fix so the registered schema stays a `ZodObject` (e.g. keep
   `.strict()` and do the actionable-message work where the message can interpolate — a
   `.superRefine` over the *raw* input on a `ZodObject` via `z.object(...).strict()` is not
   available, so consider instead a custom `errorMap`, or `.catchall(z.never())`, or keeping
   `.strict()` and post-processing the error text in the tool wrapper). Whatever the mechanism,
   add a test asserting `listTools()` advertises `name`/`baseUrl` as required and
   `additionalProperties:false` for `create_connector` — the assertion whose absence let this ship.

2. **`__proto__` was rejected before this fix and is now silently accepted and stripped — and the
   tool goes on to create a Connector.** The `superRefine` iterates `Object.keys(value)` of the
   *parsed* value. `.passthrough()` builds its output by assigning unknown keys onto a fresh
   object, and assigning `"__proto__"` sets the prototype instead of creating an own key, so the
   key is invisible to the refinement. Reproduced twice, live over `client.callTool`:
   `{"name":"n","baseUrl":"http://x","__proto__":"sk-LEAK"}` and the object-valued variant both
   return a **success** result and my API proxy logs `!!! HTTP CALL createConnector`. The same
   input at ffdaff1a returned `Unrecognized key(s) in object: '__proto__'`. (No prototype
   pollution results — the parsed object's prototype is still `Object.prototype` and no global
   is touched — so the impact is confined to the boundary itself.) This directly violates the
   requirement db8541d2 just wrote: "An unrecognized key SHALL fail the parse outright, never
   merely be stripped or passed to the handler." Fix and add a `connectorSchema.test.ts` case
   parsing `JSON.parse('{"name":"n","baseUrl":"b","__proto__":"x"}')` and asserting rejection.

3. **The unrecognized-key message is masked whenever another field fails hard — the arm CR1 was
   about is the one that regresses.** Zod aborts a `ZodEffects` refinement when the inner object
   parse produces an `invalid_type`/`Required` issue, so the `superRefine` never runs. Probed:
   `{name:"n", secret:"sk-LEAK"}` (no `baseUrl`) → the only message is `baseUrl: Required`;
   `{name:1, baseUrl:"http://x", secret:"sk-LEAK"}` → only `Expected string, received number`.
   The old `.strict()` reported the unrecognized key *alongside* the field errors in exactly these
   cases (verified: `{name:"", secret}` under `.strict()` yields name + baseUrl + `Unrecognized
   key(s) in object: 'secret'`). So for a partially-malformed call — the realistic shape of a
   first attempt by an agent that guessed a credential key — the shipped code is now *less*
   informative than the `.strict()` it replaced, and does not satisfy the spec's "fails loudly
   with a message naming BOTH the offending key and the out-of-band path". Whatever mechanism
   resolves CR1/CR2 must also fire independently of other field failures; add a test for
   `{name:"n", secret:"sk-LEAK"}` (baseUrl absent) asserting the message names `secret` and
   `/connectors`.

### Non-blocking notes

- The three defects on this ticket (authType enum, unrecognized-key message, and now this pair)
  share one shape: the guard was tested only on inputs its author predicted. CR1's fix was itself
  never probed on an unpredicted input. Worth a line in the change's design.md.
- skeptic-final-1.md's non-blocking notes (`dist-e2e/` not gitignored, the runner-env
  `CONNECTOR_MASTER_KEY` preflight) still stand; `evaluation-2.md` is now committed.
