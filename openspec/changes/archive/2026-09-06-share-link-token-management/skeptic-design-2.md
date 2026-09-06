## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Cold re-derivation from the artifacts and the tree; the round-1 report was read as a list of
claims to re-test, not as fact. Each of the 8 round-1 change requests re-checked:

1. **Token not confined to the anonymous branch — GENUINELY FIXED.** I re-read
   `backend/src/main/scala/com/helio/api/http/AclDirective.scala` in full.
   `authorizeResourceWithSharing` has exactly two denial sub-arms under
   `Success(Some(ownerId))`: `Some(user)` → `findGrant` → `Success(None)` →
   `403 Forbidden`, and `None` → `hasPublicViewerGrant` → `Success(false)` →
   `404 notFoundMessage`. D5 now specifies the token as a fallback consulted on **both**
   of those arms, completing "the denial that arm would have produced anyway" when the
   token is invalid. Traced against the real control flow: the `Owner`, `Role.Editor`,
   `Role.Viewer` and public-grant `true` arms are untouched, so no level is downgraded;
   both denial arms are reachable by the token check; and no third `complete(...)` shape
   is introduced (task 3.5 pins this by inspection). The `ownerResolver` `Success(None)`
   arm deliberately does not consult the token, which is correct — a token is bound to an
   existing dashboard and that arm's 404 is byte-identical anyway. `acl-enforcement/spec.md`
   states the same rule normatively ("SHALL NOT be confined to the unauthenticated path",
   "SHALL NOT downgrade") with covering scenarios, and task 6.4 covers it in tests. Real fix,
   not a rewording.

2. **Shareable-URL origin — resolved by removal.** `share-link-management-api/spec.md` now
   states the response "SHALL NOT include a fully-qualified share URL"; task 4.1 says the create
   response carries the secret but no URL; task 5.4 composes from `window.location.origin`;
   D8 states the reason (no backend public-origin config; `Host` is wrong in prod). Consistent
   across all four surfaces. The UI spec's "SHALL present the resulting URL" is not a conflict —
   that surface is the composer.

3. **Nonexistent-OpenAPI wording — fixed.** The requirement is now "declared in the project's
   contract surfaces" and says explicitly "This project has no OpenAPI document". No implementer
   is pointed at a file that does not exist.

4. **Timing scope — narrowed honestly, not gutted.** `share-link-tokens/spec.md` scopes the
   requirement to status and body, but retains a real structural sub-requirement — validation
   SHALL NOT add a query/branch/round-trip on any one failure path relative to the others — with
   a covering scenario ("No failure path costs more than another"). That is exactly the axis the
   ticket AC names (expired vs revoked vs nonexistent are indistinguishable). The axis dropped is
   a *different* comparison (absent dashboard vs existing private dashboard), which the design's
   Risks section now names, quantifies (1 query vs 3), explains why equalising is worse, and
   records as an accepted residual with a pointer to HEL-837. The ticket's stated security property
   is still covered; only the pre-existing resource-existence channel is disclaimed, and it is
   disclaimed in the open.

5. **Per-method pool assignment — present and specific.** D6 assigns `insert`/`findByDashboard`/
   `revoke` to `withUserContext(userId)` and only `findActiveByHash` to `withSystemContext`, and
   states plainly that RLS is defence-in-depth on owner paths and not the boundary anonymously.
   Task 1.4 restates it with a mechanical check (no raw `db.run`; exactly one `withSystemContext`).
   The RLS spec is therefore no longer ceremony.

6. **Fourth mutation on the chatty axis — genuine.** Task 6.8 keeps the three permissive mutations
   and now requires recording the NAMED test each reddens. Task 6.9 adds the opposite-direction
   mutation (give the revoked arm a distinct message or a 403) and requires that **6.3 specifically**
   turns red. I checked the targeting: 6.3's assertion is that six responses are byte-identical in
   status and body; making the revoked arm differ in message or status breaks exactly that equality.
   The mutation lands on the axis 6.3 measures, and 6.9 states the failure-to-redden consequence
   ("evidence-shaped non-evidence and must be strengthened until it fires").

7. **6.3 comparison set — now six.** Expired, revoked, nonexistent, wrong-resource, no-token-at-all
   on the same private dashboard, and an absent dashboard id — compared to each other rather than to
   a literal. This gives the acl-enforcement scenario "Denial does not distinguish a real dashboard
   from an absent one" a covering task, which it lacked.

8. **`token` named explicitly.** `public-dashboards/spec.md` now says "supplied as the URL query
   parameter named `token`" and states that the parameter name is part of the published contract
   because a downstream embed consumes it. Pinned.

**Nothing newly broken (one nit).** `npx openspec validate share-link-token-management --type change`
→ `Change 'share-link-token-management' is valid`. I grepped design.md/proposal.md/specs for task
cross-references: exactly one is stale (see note below); no other dangling reference, no spec/task
divergence found. Task renumbering (old 6.7 → 6.8, new 6.9 inserted, RLS 6.6 → 6.7, gate chain 6.12)
is internally consistent within tasks.md.

**Acceptance-criteria coverage re-traced, none lost:** mint/expiry/revoke with immediate effect →
tasks 2.4, 2.6, 3.2, 6.1 + `share-link-management-api` revoke requirement; valid tokens authorize
public read, invalid ones denied with no oracle → 3.4, 3.6, 6.2, 6.3, 6.4 + acl-enforcement and
share-link-tokens requirements; owner-only → 2.4, 6.5 + the owner-only requirement's four scenarios;
schema/contract → 4.1, 4.2 (OpenAPI leg correctly re-grounded, per the validated premise correction
in ticket.md); ScalaTest create/validate/expire/revoke → 6.1–6.7; Jest UI → 6.10, 6.11; CSPRNG →
2.2 + 6.6 (including the grep that distinguishes a CSPRNG from a general-purpose PRNG, which
statistical uniqueness cannot).

### Verdict: CONFIRM

All eight round-1 change requests are substantively addressed, not reworded. The one functional
defect from round 1 (a valid share link 403-ing for a logged-in non-grantee) is fixed in the place
that matters — the design decision, the normative spec, and a covering task — and the fix reasons
correctly against the actual `AclDirective` control flow.

### Non-blocking notes

- **Stale cross-reference introduced by the renumbering:** design.md line 80 (D6) says "the two-pool
  spec in task 6.6", but the RLS spec is now task **6.7** (6.6 is the entropy/generation spec). Fix
  the pointer when touching design.md. Not blocking: task 6.7 is unmistakably the RLS spec and task
  1.4 independently carries the pool assignment.
- design.md's Planner Notes attribute "grant-before-token ordering" to "(D6/D5)"; that ordering now
  lives in D5 alone (D6 is pool assignment). Cosmetic.
- Task 2.5's verification method for the single-query property is "by inspection that there is exactly
  one `false` exit shape" — that checks the exit shape, not the query count. The query-count claim is
  what `share-link-tokens`' "No failure path costs more than another" scenario rests on. Consider
  extending 2.5's verification to state the single-lookup structure explicitly.
