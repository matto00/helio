## Context

`NodePayloadWiringSpec` ("store a payload on a real opted-in run ...") seeds a dashboard with a PUBLIC viewer grant
(`resource_permissions` row, `grantee_id NULL`) plus a share token, then asserts `401` for `""` and `?token=` on
`/api/dashboards/:d/panels/:p/history/:pointId/rows`.

Public `/history` (`PublicDashboardRoutes`, HEL-1273) is gated by `AclDirective.authorizeResourceWithSharing(...,
token)`. That directive consults the share token ONLY when grant-based resolution denies (its own doc, HEL-590 D5).
On a dashboard with a public viewer grant, an anonymous request to `/history` is already authorized, so asserting
"token gets 200 on /history" on the existing seed would pass with a completely broken token. A naive positive control
is vacuous.

`ShareTokenValidatorImpl.authorizes` hashes the presented token with `TokenHashing.sha256Hex` and looks it up via
`ShareTokenRepository.findActiveByHash`; it then requires the row's dashboard to match and `isActive(now)`.

## Goals / Non-Goals

**Goals:** a `200` on public `/history` that can only be explained by the share token being valid; the existing `401`
coverage preserved; the spec's hashing delegated to the production helper.

**Non-Goals:** production code changes; refactoring the rest of the spec; other specs' hand-rolled digests.

## Decisions

1. **Hash with `TokenHashing.sha256Hex(shareToken)`.** Remove the `MessageDigest` import if it becomes unused.
   Alternative (keep hand-rolled digest) rejected: the ticket asks for the shared helper, and a test that re-derives
   the production algorithm independently can drift silently.
2. **Two-phase seed in the same test, token-only first.**
   - Phase A (no public grant): seed dashboard + panel + share token, NO `resource_permissions` row.
     - Baseline: anonymous `GET .../panels/:p/history` is NOT `200` (assert the actual denial status the directive
       produces for anonymous-no-public-grant, read from the code/first run, not guessed).
     - Positive control: `GET .../panels/:p/history?token=<share>` is `200` and its body carries the history points
       (e.g. non-empty `points`, or the `current` value) — not just a status.
     - The existing negative: `""` and `?token=<share>` on `/history/:pointId/rows` are `401` with no `"rows"`/`"label"`.
   - Phase B: insert the public viewer grant (as today) and re-assert the payload path is `401` for `""` and
     `?token=` — preserving HEL-1276's original "even a public dashboard does not expose payloads" coverage.
   Alternative (just add `?token=` to /history on the public dashboard) rejected as vacuous, see Context.
   Alternative (drop the public-grant case) rejected: it narrows HEL-1276's existing coverage.
3. **Requests go through the full `api` tree** built from `dbContext` alone (same `api` value), never the public
   sub-tree, so the control exercises the same wiring as the negative assertions.
4. **Mutation evidence.** Temporarily change the stored hash (e.g. `TokenHashing.sha256Hex(shareToken + "-broken")`),
   run the spec, record the positive-control failure (red, with the observed status), revert, run again (green).
   Both transcripts are recorded in the evaluator-visible evidence; the mutation is never committed.

## Risks / Trade-offs

- [The positive control fails on unmodified product code] → that is a product bug (token not honored on /history
  through the full tree); escalate per ticket, do not alter the assertion to pass.
- [Anonymous baseline status differs from expectation (404 vs 401)] → assert whatever the directive actually returns
  for anonymous-no-public-grant, but assert it is NOT 200; the point is that the token is the only path.
- [Shared dev-DB residue] → spec uses the EmbeddedPostgres harness (`HelioRouteTest`); no shared DB.

## Planner Notes

- Self-approved: two-phase seed rather than two dashboards (one panel/output already wired to the opted-in output).
- Self-approved: test-only, `skip_specs: true`.
