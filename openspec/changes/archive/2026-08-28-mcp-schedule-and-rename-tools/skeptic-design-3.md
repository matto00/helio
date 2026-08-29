## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Round-2 blocking item 1 (write.ts unimportable → extraction) — VERIFIED TRUE AS WRITTEN, with one residual gap (CR1):

- `write.ts` exports ONLY `boundPipelineStepSchema` (:42) and `registerWriteTools` (:63). `jsonResult` (:47) and
  `guarded` (:51) are module-private. Confirmed by `grep -n "^export" src/tools/write.ts`.
- The extraction precedent D10 cites is real and exact: `assertSchemas.ts:100` exports `addPipelineStepHandler(api, input)`
  — a thin handler that RETURNS the api value and THROWS on failure; `metricSchemas.ts`/`updateSchemas.ts` export body
  builders. `write.test.ts:12-20` documents verbatim why tests import those and NOT `./write.js` (~"pathologically
  expensive to type-check under this repo's root tsconfig/ts-jest", reproduced against unmodified `main`).
- So D10, tasks 5.0 and 5.0b are grounded, and 5.0b's honest statement that the Zod `inputSchema` shapes are consequently
  NOT unit-testable matches the codebase's actual structure.
- Tasks 7.1/7.2/7.5/7.7 (path/method/body assertions) ARE executable without `write.ts`: `helioApi.test.ts:26-34` is an
  existing fetch-injection harness (`new HelioHttpClient(config, { fetchImpl })` recording `{url, init}`) that asserts
  request shape directly. Good precedent, and the plan's assertions fit it.

Round-2 blocking item 2 (D8/task 8 stdio-transport claim) — VERIFIED TRUE AS WRITTEN:

- `helio-mcp/scripts/verify.ts:1-45` is exactly what D8 now claims: real `Client` +
  `StdioClientTransport` spawning `../dist/index.js`, `textOf()` reading `result.content[].text`, requiring
  `HELIO_API_BASE_URL` + `HELIO_PAT`. `package.json` has both `"build": "tsc"` and `"verify": "tsx scripts/verify.ts"`.
- D8 and tasks 8.1-8.3 now require traversal of that transport and scope "unreachable" to the calling agent's own client
  only. That scoping is correct — I can find no further in-repo segment left unmeasured.
- Task 1.3 does provision the live backend + `HELIO_PAT` and instructs escalation rather than substitution. Good.

Round-2 non-blocking notes — all three addressed: D11 states the `{deleted:true,pipelineId}` divergence as a decision
(and its reasoning about `JSON.stringify(undefined)` matches `guarded`/`jsonResult` at `write.ts:47-51`); tasks 7.5-7.7
now read in order; task 1.3 exists.

Independent re-derivation (standing requirement 5 — enumeration, not counts):

- Registered tools: `grep -n "registerTool(" src/tools/*.ts` → 66 hits, of which the real registrations are
  read.ts 16, write.ts 33, proposal.ts 2, pipelineProposal.ts 3, refinement.ts 3, combinedProposal.ts 1 = **58**
  (the remainder are comment/test mentions); unique name literals = 58. Design D7 says "all 57".
- The gap itself is REAL: `grep -rn "update_dashboard\|schedule" src/tools/*.ts src/helioApi.ts` shows only
  `update_dashboard_layout` (:1116) and prose mentions of scheduled refresh. No `update_dashboard`, no
  `update_dashboard_appearance`, no schedule tool, no schedule client method. D7's corrected justification holds.

### Verdict: REFUTE

### Change Requests

1. **Tasks 7.3, 7.4 and 7.6 still require reaching `guarded()`, which lives module-private inside `write.ts` — the
   exact unimportability D10/5.0 was written to route around, and D10 enumerates only the Zod schemas as the
   consequence.** 7.3: "reaches the caller as an **error result** carrying the status"; 7.4: "**surfaced as an error**,
   not converted into a success value"; 7.6: "surfaces as an **error result** ... assert the message CONTENT, not
   `isError` alone". `isError` and the `"<name> (status <n>) for <url>: <message>"` string are produced solely by
   `write.ts:51`'s non-exported `guarded` (six near-identical private copies exist — `read.ts:23`, `proposal.ts:103`,
   `pipelineProposal.ts:41`, `refinement.ts:48`, `combinedProposal.ts:38` — none exported). Read literally, these three
   tasks require importing `./write.js`, which task 5.0 forbids absolutely and which OOMs node at 4 GB. The repo's own
   precedent already resolves this and the plan should adopt it explicitly: `pipelineProposalHandlers.test.ts:16-20`
   states "`guarded`'s `isError`/message-formatting behavior is `proposal.ts`/`write.ts`'s existing, already-covered-
   by-convention logic and is not re-tested here". Rewrite 7.3/7.4/7.6 to assert at the **handler boundary** — the
   handler REJECTS with a `HelioApiError` whose `status` is 400/404 and whose `message` contains the backend's own text
   (assert the status and the message content, never merely `rejects.toThrow()`), and add to D10/5.0b that `guarded`'s
   `isError` wrapping is likewise out of unit-test reach and is covered by convention plus the section-8 stdio probe.
   Leaving the current wording invites exactly the mid-cycle improvisation that round 2 blocked on.

### Non-blocking notes

- D7 says "all 57 registered tools"; enumeration gives 58 unique tool names. The claim that depends on it (no
  `update_dashboard_appearance`, no schedule tool) is independently true, so this is a count nit, not a defect — but
  standing requirement 5 says distrust counts, so fix it in passing if the doc is touched anyway.
- D10 (echoing `write.test.ts`'s pre-existing header) calls write.ts a "~20-tool Zod-schema surface"; it is 33
  registrations / 1175 lines. Understates rather than overstates the problem, so it changes nothing.
- Section 8's probe closes AC4 through the stdio transport; that same run is also the natural place to capture AC2/AC3
  evidence (tasks 9.1/9.2), which currently name no mechanism. Not blocking — 9.1's "request-level trace plus the UI
  read" is adequate given all four planned methods are pure `http.*` pass-throughs with no MCP-side store.
