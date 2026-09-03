## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Ticket + spec delta read before any prior report. All conclusions below are from
commands I ran myself in this worktree.

### What I verified (with evidence)

**Diff scope.** `git diff --stat 08214a36..HEAD`: 16 code files, all under `helio-mcp/`. Zero
`backend/**`, zero migrations, zero frontend. No UI change → design-judgment section N/A.

**Fixture / test-data interrogation (HEL-879 lesson 1).** There are no fixture or test-data
edits in this diff. `helio-mcp/README.md` is a pure table reflow plus one added row (verified
line by line). The only *modified* pre-existing test file is
`restDataSourceSchema.test.ts`, and the diff is `+11 / -0` — a pure addition, nothing altered
or removed. `server.test.ts` is `+1` (tool-name list). The "inverted assertion" flagged in my
brief lives in `connectorSchema.test.ts`, which is a **new file introduced by this change**, not
a pre-existing test bent to fit. I reached the same conclusion as the prior agents but by
independent argument: the spec delta's own scenario says "an `authType` of `bearer`, `api_key`,
**or any value other than `none`** → no Connector created, message directing to `/connectors`".
An enum literally cannot satisfy "any value other than none" — the widening to `z.string()` makes
the implementation *more* spec-conformant, not less, and the refusal moved (not weakened) into
`createConnectorHandler`. I proved the moved refusal live, below, with `oauth2` — a value the
enum would never have reached.

**Credential surface — live adversarial probe.** Backend started against the SHARED dev DB
(`bash scripts/concertino/start-servers.sh . 6318 9225 HEL-886` → `READY backend=…/health`),
then a throwaway-user PAT driving the real MCP server over stdio:

- `create_connector {credential:"sk-LEAK"}` → `isError`, denylist refine, leak value not echoed.
- `create_connector {secret:"sk-LEAK"}` → `Unrecognized key(s) in object: 'secret'` (`.strict()`),
  value not echoed.
- `create_connector {config:{authType:"bearer"}}` → `Unrecognized key(s) in object: 'config'` —
  the backend-shaped credential envelope has no way in.
- `create_connector {authType:"oauth2"}` → actionable `/connectors` refusal, **zero HTTP calls**.
- `create_connector {authType:"NONE"}` → same refusal (case-sensitive compare; correct — a
  case-variant is not the literal `"none"` and refusing is the safe direction).
- `create_connector {baseUrl:"http://127.0.0.1:9225"}` → backend's own egress refusal surfaced
  verbatim: `URL host '127.0.0.1' resolves to a disallowed address`. HEL-879's guard applies
  unchanged and is not replaced with an opaque error.
- Tool-list scan for credential-shaped input-schema keys: only the always-rejecting denylist
  fields appear; no tool offers to supply/update/rotate a credential.

`credential: ""` is structurally unpopulatable: `helioApi.ts:createConnector` writes the literal
in the POST body; it is not a parameter of the method and no caller can reach it. The method's
parameter type is `{name; kind; baseUrl}` only, enforced by `tsc`.

**AC1 / AC5 — live, shared dev DB.** Per the coordinator's correction I re-ran the AC5 e2e
end to end against the shared DB (both prior cycles ran on scratch DBs):
`HELIO_API_BASE_URL=http://localhost:9225 node dist-e2e/connector-authoring.js` → exit 0,
`list_connectors` empty + hint → `create_connector` → `create_rest_data_source`
(`inferredSchema present, fetchError null`) → `create_pipeline` → `run_pipeline` →
`get_output_rows rows=1`. Zero out-of-band HTTP in the measured window. Secondary result the
coordinator asked for: **Flyway validated clean against the shared DB** — the V96 repair holds.

I confirmed the three hard criteria and both preflight exits are `fail()` → `process.exit(1)`,
not logged warnings (`e2e/connector-authoring.ts`, `fail()` at the top of the file).

**AC2.** `credentialDenylist.ts`'s message, instantiated with
`toolName: "create_rest_data_source"` / `alternative: "Pass connectorId instead."`, is
**byte-identical** to the pre-extraction string in `git show 08214a36:…/restDataSourceSchema.ts`
(compared character by character). The pre-existing denylist tests are unmodified and pass.

**AC4.** Verified live: empty `list_connectors` carries a second text block naming
`create_connector`; missing `connectorId` yields
`"connectorId is required — call list_connectors to obtain one, or create_connector if none exist yet."`

**Gates re-run by me.** `npx jest --testPathPatterns=helio-mcp` → 22 suites / 211 tests pass.
`npm run check:helio-mcp-types` clean. `npm run lint` clean. `npm run typecheck` clean.
`npm run check:openspec` clean.

**Gate-scope check (the "verify what a gate actually scans" lesson).**
`npm run check:no-credential-leak` prints OK, but reading
`scripts/check-no-credential-in-agent-surface.mjs` shows it scans only
`frontend/src/features/assistant/**` and `backend/src/test/resources`. It scans **zero files of
this diff** and is not evidence for this change. (Pre-existing scope, not a defect of HEL-886 —
recorded so nobody later cites it as coverage.)

### Verdict: REFUTE

One blocker, and it is the class of defect my brief told me to hunt: the shipped behavior is
**looser than the change's own spec delta text**, on a path every test happens to sidestep.

### Change Requests

1. **`create_connector`'s `.strict()` unrecognized-key rejection does not name the out-of-band
   path, contradicting this change's own spec delta.**
   `specs/mcp-data-source-tools/spec.md`, "Scenario: An agent attempts to pass a credential to
   create_connector", reads:
   *"**WHEN** `create_connector` is called with an `auth`/`apiKey`/`token`/`password`/`credential`
   field, **or with any key its `.strict()` schema does not recognize** — **THEN** validation fails
   loudly **with a message naming the out-of-band path**…"*
   Reproduced live (twice, same result): `create_connector {name, baseUrl, secret:"sk-LEAK"}`
   returns `Unrecognized key(s) in object: 'secret'`, and `{config:{authType:"bearer"}}` returns
   `Unrecognized key(s) in object: 'config'`. Neither names `/connectors` or any next step — a
   bare Zod validation error, exactly the shape AC3 and this scenario rule out. The five
   denylisted names get the good message; the unlisted-key arm (the arm that catches the
   *unpredicted* credential-shaped key, e.g. `secret`, `bearerToken`, `authorization`) does not.
   Security is unaffected — the rejection is loud, nothing is created, the value is not echoed —
   but the spec delta is the durable artifact and it currently over-claims.
   Fix at `helio-mcp/src/tools/connectorSchema.ts:57`: pass a custom message to `.strict()`, e.g.
   `z.object(createConnectorInputSchema).strict(CREDENTIAL_REJECT_OPTS.alternative)` (or a
   message that both names the unrecognized key and points at the in-app `/connectors` page), and
   add a `connectorSchema.test.ts` case asserting the unrecognized-key error text contains
   `/connectors`. Note the existing `defaultHeaders` strict-rejection test would then also cover
   it. Apply the same judgment to `createRestDataSourceSchema.strict()` only if you agree its
   spec text makes the same promise — as written it does not, so leaving it alone is defensible;
   do not change it silently either way.
   (If you instead conclude the spec sentence is the thing that is wrong, the alternative fix is
   to narrow that scenario's WHEN clause to the five denylisted fields and state plainly that an
   unrecognized key gets `.strict()`'s generic error. Either resolution is acceptable — what is
   not acceptable is shipping the two disagreeing.)

### Non-blocking notes

- `e2e/connector-authoring.ts`'s `CONNECTOR_MASTER_KEY` preflight checks **the runner process's**
  env, not the backend's. I satisfied it with `CONNECTOR_MASTER_KEY=x` while the backend used a
  real key from `backend/.env` — so the check can pass with a value that is not the one in use,
  and could equally fail spuriously. The code comment discloses this honestly and it is a
  diagnostic, not a pass criterion, so it is not a blocker; a follow-up could probe the backend
  instead.
- The documented e2e compile step emits `helio-mcp/dist-e2e/`, which is **not gitignored** —
  running the documented command leaves an untracked build dir. I removed mine. Consider adding
  `dist-e2e/` to `helio-mcp/.gitignore`.
- `evaluation-2.md` is untracked in the worktree; it needs to be committed before delivery.
- Residue check after my live run: `git status --short` shows only the untracked
  `evaluation-2.md`. `backend/.env` untouched and still pointing at the shared `helio` DB.
  I did not run `cleanup.sh`. The e2e leaves one orphaned Connector + source/pipeline/output
  under a disposable per-run user, as designed and pre-accepted.
