## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: `openspec/changes/history-payloads-toggle/` (ticket.md, proposal.md, design.md, tasks.md, specs/*). The directory is untracked on top of HEAD `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`. Owner rulings Q1–Q4 are treated as settled.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/output-history-payloads-toggle/HEL-1331`.
- **Round-1 CR1 (false RLS premise): addressed.** The design.md Context now says `users` carries no RLS (citing V88:9-10) and that grantees can read pipelines (V39). D1 gives the three real reasons and restates safety as "authorization happens before the lookup". The NodePayloadHistoryRepository class doc ("Every method runs on the privileged pool: callers authorize the Output first") matches. The Risks bullet was reworded.
- **Round-1 CR2 (Save semantics): addressed in D5 and the spec, but NOT in tasks.md.** In D5 and the spec, the key is omitted unless the toggle is enabled and changed, and an untouched toggle leaves the stored value as it was. The spec adds a "never-set Output" scenario. Task 4.2 tests the absent, null and true seeds. **However, task 2.3 still reads "seeding from config and sending an explicit boolean on update".** That is the round-1 wording CR2 asked to remove, and it contradicts D5. See CR1 below.
- **Round-1 CR3 (D2 conditional): addressed, but it names the wrong identifier.** D2 now states the exact parameter shape and the ApiRoutes call site, and requires a production-wired test. That test is feasible: `NodePayloadWiringSpec` builds `new ApiRoutes(..., dbContext = ctx)` with no payload repo. **But D2 and task 1.3 say to pass `Some((nodePayloadHistoryRepo, payloadHistoryConfig))`.** In `ApiRoutes.scala:222`, `nodePayloadHistoryRepo` is the nullable constructor parameter (default `null`). The non-null value is `resolvedNodePayloadHistoryRepo` (`:256-257`). Its comment at `:250-252` says it is named `resolved*` "because the plain names are the (nullable) constructor params above". `Main.scala` passes the real repo, so prod would work. Every test fixture that builds `ApiRoutes` without it (ApiRoutesSpec, NodePayloadWiringSpec, ApiTokenAuthSpec, and ~7 others) would get `Some((null, cfg))`, and then an NPE on every Output route. See CR2.
- **Round-1 CR4 (D6 anchor and acceptance signal): addressed.** In the live `SettingsPage.tsx`, the "Beta access" `<h2>` sits in a bare `<section className="settings-page__section">` that wraps `<BetaAccessSection />`. Placing the anchor there is correct. The three loading flags D6 names (`preferencesLoading`, `agentMemoryLoading`, `apiTokensLoading`) exist. `MfaSecuritySection` and `AuditHistorySection` own their fetches internally, which is why D6 says "audit loading" loosely. `waitForSettingsAuditTable` exists in `e2e/support/settingsReady.ts`. Task 4.4 now has the "heading in viewport" signal.
- **D1/ruling fidelity:** `PayloadTierLimit.allowsPayloads = maxRuns > 0 && maxAge > 0` (`PayloadHistoryConfig.scala:11`). This matches the ticket's "maxRuns > 0 and maxAge > 0" and the spec's "runs > 0 and age > 0".
- **D2 field shape:** `OutputResponse` currently has 12 fields with `jsonFormat12` (`OutputProtocol.scala:116`). Adding a 13th is well within spray's limit. `panelCount`/`rootId` already use the same `Option[...] = None` pattern, so None is omitted. The 6 patch-set callers are confirmed at the cited files.
- **Independent review: AC coverage.** Every AC, ruling and additional-acceptance item maps to a task:
  - Toggle and copy: 2.2, 2.3, 4.2
  - Free tier disabled with upsell: 2.2, 2.4, 4.2, 4.4
  - Pipeline-owner gating: D1–D3, 1.1–1.3, 4.1, C1
  - Schema: 1.4
  - MCP: 3.1, 4.3
  - Both-theme check: 4.4, 4.5
  - Free/beta/owner/cross-tier route tests: 4.1

  I found no TODO/TBD and no scope drift.

### Verdict: REFUTE

All four round-1 items have been substantively addressed. Two of the fixes introduced or left a literal inconsistency that an implementer following the text would act on, and one copy requirement is still underspecified. All three are one-line artifact edits.

### Change Requests

1. **tasks.md 2.3 contradicts D5.** Replace "sending an explicit boolean on update" with D5's rule: on edit Save, add `historyPayloads` to the PATCH config only when `historyPayloadsAvailable === true` and the toggle differs from its seeded value. Otherwise omit the key. Tasks are what the executor checks off, and 2.3 currently instructs the exact behaviour round-1 CR2 rejected. Under that behaviour, an untouched toggle writes `historyPayloads: false` into a never-set config, which breaks the spec's "Unchanged switch on a never-set Output" scenario.
2. **D2 and task 1.3 name the nullable constructor param.** Change `Some((nodePayloadHistoryRepo, payloadHistoryConfig))` to `Some((resolvedNodePayloadHistoryRepo, payloadHistoryConfig))` in both places (`ApiRoutes.scala:222` vs `:256-257`). The current text works in prod (Main passes the repo) but NPEs every Output route in each ApiRoutes-built test fixture that omits it. That is the HEL-466 "built in Main but not in the spec" defect class, in reverse.
3. **Pin the Q4 opt-out sentence verbatim.** Planner Notes says "The Q4 sentence in the spec is the ruling's own example wording, made final". But the spec only paraphrases it: "SHALL state that turning it off stops storing rows while rows already kept expire…". Put the exact string in the spec requirement and in D7's constants: "Turning this off stops storing rows; rows already kept expire on the normal schedule." Otherwise the unit test and the copy can each pick different wording, and the Planner Note is false.

### Non-blocking notes

- D6's "never after the user has scrolled" needs a concrete mechanism, e.g. a `scroll`/`wheel`/`keydown` listener that sets a ref, or a stop once the heading's top is within the viewport. The executor should pick one and unit-test it. It is acceptable as-is because the e2e signal bounds the behaviour.
- D6 lists "audit loading flags", but the audit fetch is internal to `AuditHistorySection`, so `SettingsPage` cannot see that flag without lifting state. Scrolling on the three page-level flags plus a final settle is enough. The e2e waits for the audit table anyway.
- Round-1 note still applies: the beta viewer on a free-owned pipeline lands on "You have Beta access." after following the link. Task 4.2 pins the disabled state, which is enough.
