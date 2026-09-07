## Skeptic Report — final gate (round 2, skeptic-final-2.md)

HEAD `a7303725`. Cold spawn; every conclusion below is from a command I ran or a screenshot I looked at.

### What I verified (with evidence)

**Environment freshness.** `start-servers.sh` reported "already healthy … reusing", which proves nothing
about which binary is loaded, so I probed the branch-only routes directly:
`GET /api/connectors/completion?token=bogus` and `POST /api/connectors/completion` both returned
`400 {"message":"This completion link is invalid or has expired"}` — routes that do not exist on `main`.
Fresh binary confirmed before any UI observation.

**CR1 (the critical one) — RESOLVED, mutation-proven.** Baseline
`testOnly ConnectorCompletionServiceSpec ConnectorCompletionTokenSpec ConnectorCompletionServiceClampExpirySpec`
→ 31/31 green. I then deleted `&& r.supersededAt.isEmpty && r.expiresAt > now` from
`ConnectorCompletionTokenRepository.consume`'s filter and re-ran: **2 tests failed** —
"consume() itself refuses a token that was superseded AFTER being read as live" (line 249) and
"…that expired AFTER being read as live" (line 269). The round-1 vacuity is gone: the new tests call
`tokenRepo.consume(hash)` directly, bypassing `resolveValidToken`'s in-memory check, so the conditional
UPDATE is genuinely reached. File restored; `git status` clean.

**CR2 — RESOLVED.** `ConnectorCompletionTokenSpec` (5 tests) covers `isValid` strictly-before, **exactly
at** (exclusive boundary), strictly-after expiry, consumed, and superseded.
`ConnectorCompletionServiceClampExpirySpec` (8 tests) covers over-ceiling clamp, exactly-at-ceiling,
under-ceiling both directions, zero, negative, unparseable, absent, and whitespace. End-to-end expiry
recovery exists in `ConnectorCompletionServiceSpec` ("expiry recovery (task 4.7 / ticket AC4)"): a real
50ms token expires, is refused with the byte-identical refusal, leaves the Connector still pending,
recovers via both agent re-mint and owner re-mint, and the stale token stays refused after recovery.
`grep '\[ \]' tasks.md` → no unchecked task, and 4.7/8.3 now have real specs behind them.

**CR3 — RESOLVED, and verified live, not just in unit tests.** `ConnectorsPage.tsx:completionLabel`
renders the D10 signal; `ConnectorsPage.test.tsx` asserts anonymous renders "completed anonymously" and
*not* the id, while a named principal renders "completed by u-42" and *not* "anonymously", plus a
never-completed row renders no signal. Live: I minted a real pending Connector via
`POST /api/connectors/pending`, completed it through the actual completion page, and the `/connectors`
row then read "Completed by 9532cfcf-… · 9/6/2026, 8:54:35 PM"
(`.playwright-mcp/hel955-connectors-light.png`). The `Pending completion` chip also renders live for an
uncompleted row (`.playwright-mcp/hel955-connectors-pending.png`), using the same `StatusChip
dashed` pattern as the existing `Auto-created` chip.

**CR4 — RESOLVED.** Both error paths (shape-fetch failure and submit failure) render
`<p role="alert" className="auth-error">`. Screenshotted in both themes:
`.playwright-mcp/hel955-error-dark.png`, `hel955-error-light.png` — a proper bordered error panel, not
bare text.

**Non-blocking notes from round 1 — all four handled.** `read.ts`'s empty-list hint now describes the
pending path (diff read); design.md D5's logging claim is qualified as an application-layer property at
lines 216/221; `evaluation-2.md` is tracked in the diff; `ConnectorCompletionToken.isValid`'s doc comment
now correctly states it is a live check and names `consume`'s predicate as the sole atomic enforcement
point.

**Acceptance criteria traced.**
- AC1 — `POST /api/connectors/pending` returned a real `{connectorId, token, expiresAt}`;
  `createConnectorHandler` routes any non-`none` `authType` to `createPendingConnector` and returns the
  completion URL. ✔
- AC2 — I submitted `sk-probe-secret-hel955` through the completion page anonymously-shaped endpoint and
  got the success state (`hel955-success-light.png`); no MCP surface carries a credential —
  `connectorSchema.ts` adds only `apiKeyName`/`apiKeyPlacement` (non-secret) and keeps the
  `rejectCredentialField` denylist. ✔
- AC3 — `SourceService.checkConnectorPending` guards the REST create path. I mutation-tested it myself:
  deleting the guard call turns `SourceServiceSpec` red (2 failures, incl. the "refuses while pending,
  then SUCCEEDS once completed" test). Restored, 47/47 green after. ✔
- AC4 — expiry specified and tested; see CR2 above. ✔
- AC5 — `helio-mcp` jest: 24 suites / 239 tests pass (`helio-mcp` is not CI-selected, so I ran it
  explicitly); denylist and `.strict()` tests survive unchanged. ✔

**Other gates.** Frontend jest 262 suites / 2684 tests green; `npm run lint` (zero-warnings) and
`npm run typecheck` clean. Backend targeted suites green post-restore. Note: `npx vitest run` in
`helio-mcp` fails instantly — that project uses jest, not vitest; a measurement artifact of mine, not a
defect (jest passes).

**UI judgment (DESIGN.md).** The completion page reuses `auth-page`/`auth-card`/`auth-field`/`auth-submit`
and the shared `TextField`, matching `LoginPage`; the new CSS rule uses `--space-1`/`--text-xs`/
`--app-text-muted` tokens with no hardcoded values. Light/dark parity verified by toggling
`helio-theme` and re-screenshotting both. No console errors beyond the browser's own log line for the
expected `400` on an invalid token.

**Hygiene.** `.hel927-selftest-planted.sql` is not present in this worktree's fixtures dir and appears in
zero commits on this branch (`git log main..HEAD --name-only | grep -c hel927` → 0); I neither committed
nor deleted it. Shared dev DB: I created 2 Connectors and 1 stray static source and deleted all three,
confirmed by re-querying (`/api/connectors` filtered on "HEL955" → `[]`, `/api/data-sources` → `[]`), not
by exit status. Worktree left byte-identical (`git status --porcelain` empty).

### Verdict: CONFIRM

All four round-1 CRs are genuinely resolved, and the two that mattered (CR1, plus AC3's guard) I proved
by my own mutation runs rather than by reading a claim. **Ready to deliver as a PR.**

### Non-blocking notes
- The D10 signal renders a raw user UUID for a named principal ("Completed by 9532cfcf-9882-…"). It is
  correct and it does satisfy the distinguish-anonymous-from-named requirement, but a human-readable
  email/display name would make the residual-risk signal actually actionable at a glance. Worth a
  follow-up, not a blocker.
- A pending Connector's row still offers "Test connection" and "Edit". Rotation is guarded at the repo
  level (`ConnectorRotationPending`) so nothing unsafe happens, but disabling/annotating those actions on
  a pending row would match the chip's intent.
