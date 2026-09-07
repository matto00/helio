## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold spawn. Round 1 and 2 reports were read only to use their CRs/notes as a checklist; every finding below
is derived from the current artifacts in the tree.

### Round 2 CR1 — genuinely CLOSED (no survivor, no escalation)

The expiry dead-end is decided, not acknowledged:
- `design.md:131-153` D9 states the problem, names two recovery routes, and gives the reasoning for why
  re-initiation grants no new capability.
- `specs/connectors/connector-completion-token/spec.md:70-91` adds a real requirement ("An expired
  completion token is recoverable by re-minting") with three scenarios: post-expiry completion, no
  duplicate pending Connector on re-initiation, and previous-token invalidation.
- `tasks.md:68-75` adds 4.6 (implement re-mint) and 4.7 (end-to-end expiry-recovery test, explicitly
  rejecting "expired token authorizes nothing" as sufficient for the ticket AC).

I checked D9's re-mint against the threat statement independently: it grants the agent nothing it lacked,
since the same caller could already mint a token by creating a second pending Connector, and the owner
route discloses the token to the owner's own session. That part of D9 is sound. **No round-2 change request
survives** — the new CRs below are consequences of D9 itself plus one claimed-addressed note that is not.

### Round 2 non-blocking notes — 3 of 4 closed

- `SourceService:138` now named in `tasks.md:51-53` alongside `RestSourceConnectorMigration:131`. CLOSED.
- proposal/D4 SQL-path contradiction: `proposal.md:20-21` now states the SQL driver is deliberately not a
  chokepoint, matching D4/task 3.3. CLOSED.
- `WorkspaceContextService` line: `design.md:13` and `:95` now say 253. CLOSED in design — but
  `tasks.md:48` still says "(246-247)". Partial (non-blocking note 3 below).
- **"hard 15-minute" vs configurable: NOT closed — it is now an outright internal contradiction.** CR1.

### My own checks

- `design.md` length: 208 lines. I looked for fat. Context (5-25), D1-D8 and the Migration Plan are dense
  and each line carries a decision or a probed fact. The overage is D4a (17 lines), D9 (18 lines) and the
  threat bullet (17 lines) — all three added at this gate's own request. Cutting any undoes a prior CR.
  Overage justified; the declaration is appropriate. (The declaration itself says "~200" for 208 and
  contains a doubled word — note 4.)
- `create_connector`'s no-credential contract, `.strict()`/denylist preservation, the recording-repo
  evidence requirement, the atomic conditional consume, indistinguishable failures, cascade-on-delete:
  all re-checked and all hold.
- 60 minutes as a *default* is a sensible correction for a flow whose defining property is that the human
  is elsewhere. My objection is not to the number; it is that the security reasoning was not re-derived
  against it (CR1).

### Verdict: REFUTE

Three change requests. All are consequences of the round-2 revisions, not survivors of them.

### Change Requests

1. **The threat statement still computes its residual risk against a 15-minute expiry that no longer
   exists — `design.md:170-177` contradicts `design.md:150-153` inside the same document.** D9 raises the
   default to 60 minutes and permits configuration up to a hard-coded 24-hour ceiling, and asserts (line
   152) "so the residual-risk statement below remains bounded regardless of operator configuration". The
   statement it points at says "a hard **15-minute** expiry" (171) and "a token read and used within 15
   minutes" (176). The accepted residual risk is therefore stated against a window 4x shorter than the
   actual default and 96x shorter than the permitted ceiling. This is the exact trade a reviewer is being
   asked to sign off, expressed with the wrong number, and it is round 2's non-blocking note reported as
   addressed while the sentence it named is unchanged. Rewrite the threat bullet's mitigation and residual
   risk against 60 minutes and against the 24-hour ceiling (i.e. state the worst case an operator can
   configure, since that is the bound the reader must accept), and say explicitly whether the mitigation
   set is still judged sufficient at 24 hours — if it is not, the ceiling is wrong, not the prose.

2. **"Minting invalidates any previously outstanding token" has no mechanism, and the schema decided in D2
   has no column that can express it.** D2 (`design.md:52-53`) deliberately chose "consumption replacing
   revocation" — the table in D2 and `tasks.md:11-15` has `consumed_at` and nothing else — while D3
   defines consumption as happening "on successful bind, atomically", with an explicit rule that a
   rejected submission must not consume. D9 (`design.md:146-148`) and `tasks.md:70-71` now require a
   second, different invalidation event (superseded-by-a-new-mint) with no bind and no submission. As
   written the executor must either overload `consumed_at` to mean two different things — which breaks
   D3's stated meaning and muddies the `8.3` assertion that consumed/expired/nonexistent are
   caller-identical — or invent a column the migration task does not create. Decide it in D2/D9: either
   add the column (e.g. `superseded_at`/`revoked_at`) to the D2 schema and `tasks.md:1.3`, or state
   explicitly that `consumed_at` carries both meanings and amend D3's definition to match. Also state the
   atomicity requirement for the mint-and-invalidate pair, as D3 does for bind-and-consume.

3. **D9's two re-mint routes are underspecified in ways an executor must guess at.**
   a. **The owner re-mint route has no surface.** `design.md:143-144` and `tasks.md:70` say "an
      authenticated owner may re-mint", but no endpoint, no request/response shape, and no
      `connector-management` scenario exists for it, while `tasks.md:7.1` (contracts) is generic. This is a
      new authenticated API that returns a bearer secret in its response body; it needs the same
      treatment D5 gave the completion endpoint (route, body shape, where the token appears, and the
      "disclosed only at mint time" rule from the completion-token spec applied to it).
   b. **The match key `owner + kind + baseUrl` is not defined and excludes the auth shape.** Base-URL
      equality is unspecified (scheme, case, trailing slash, port, path) — two agent calls a human would
      call identical may or may not match. Worse, a pending Connector persists its *intended auth shape*
      (`specs/connectors/pending-connector-handoff/spec.md:14`), and the completion page renders from it;
      re-initiating with the same owner/kind/baseUrl but a different auth type re-mints onto a row whose
      auth shape no longer matches what the agent just requested, and the human is then asked for the
      wrong kind of credential with no signal that anything diverged. Decide: normalize the base URL (say
      how), include the auth shape in the match key or state what happens on a mismatch, and say which row
      wins if more than one pending Connector matches.

### Non-blocking notes

- `tasks.md:48` still cites `WorkspaceContextService.buildConnectors` "(246-247)"; the `findAll` call is at
  253, as `design.md:13`/`:95` now correctly say. Align the task.
- `tasks.md` section 4 is ordered 4.4, 4.6, 4.7, 4.5. Harmless, but 4.5 reads as an afterthought appended
  after the tasks that cite it.
- `proposal.md:30-31` still says "a pending Connector's status is also readable, deliberately without
  exposing anything a human is mid-configuring", which reads as a status endpoint — dropped per
  `design.md:201-203`. It is true via the connectors list; wording it that way would avoid sending the
  executor looking for an endpoint.
- `design.md:205-207`: says "(~200)" for a 208-line file, and contains a doubled "explicit explicit".
