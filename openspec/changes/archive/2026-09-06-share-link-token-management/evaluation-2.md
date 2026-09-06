## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `40f41f3f` (cycle 1 was `437d628f`). All gate results are from my own fresh runs.

**Bottom line:** eight of nine cycle-1 change requests are genuinely fixed, several of them well. But
verifying CR1 end-to-end in the browser — as this cycle's brief required — surfaced a defect that
makes the feature non-functional: **a valid share token authorizes the request but returns zero
panels.** The share link now lands on a real page instead of a 404, and that page is empty for
exactly the audience the link exists for. I missed this in cycle 1 (I saw `items: []` from the API
and wrongly attributed it to an empty dashboard); that is my error, and it is the primary reason this
cycle is a FAIL rather than a PASS.

### Gate chain (re-run independently, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm run check:schemas` | PASS |
| `npm run check:openspec` | PASS |
| `npm run check:scala-quality` | PASS ("clean", 157 pre-existing soft warnings) |
| `npm run check:no-credential-leak` | PASS (0 violations) |
| `npm test` | PASS (259 suites / 2671 tests; mcp 24/238) |
| `cd backend && sbt test` | PASS (3931 tests, 0 failed — +1 vs cycle 1, the new CR7 test) |

Note on method: `start-servers.sh` reported "backend already healthy … reusing", which would have
re-verified cycle 1's backend binary against cycle 2's frontend. I stopped the stale JVM on 8929 and
restarted so every browser observation below is against `40f41f3f`'s actual backend, with V102
applied.

---

### BLOCKING DEFECT — a valid share token grants authorization but no data

`PublicDashboardRoutes` authorizes via `AclDirective` and then **discards the resolved
`ResourceAccess`**, passing the raw `userOpt` to
`PanelRepository.findAllByDashboardId(dashboardId, callerOpt, page)`. That repository performs its
**own independent access check** (`PanelRepository.scala:46-84`) whose predicate is
`ownerPred || granteePred || publicPred` — owner, explicit grantee, or public-viewer grant. **A share
token is not one of those three.** For an anonymous token-bearing caller all three are literally
`false`, so every panel is filtered out.

Verified live, against the dashboard `7f5c7bf9-…c0d`, which has **4 panels** in the database
(`select count(*) from panels where dashboard_id=…` → `4`):

- Anonymous (signed out), valid token, via the API:
  `GET /api/dashboards/7f5c7bf9…/panels?token=<valid>` → `200 {"items":[],"limit":200,"offset":0,"total":0}`
- Anonymous, valid token, via the new viewer page: renders **"Nothing to show yet — This dashboard
  doesn't have any panels."**
- **Signed in as the owner**, same URL, same token: renders all four panels
  (`"Untitled Panel Output … anchor Divider"`).

That last pair is the proof: the panels appear only because the session cookie makes `userOpt =
Some(owner)` and satisfies `ownerPred`. The token contributes nothing to data retrieval. A share link
therefore works only for someone who is already authenticated and already has access — precisely the
people who do not need it. Unless the dashboard *also* carries a public-viewer grant, in which case
the token is redundant.

The `/rows` route has the identical defect by the same route: `resolveRows`
(`PublicDashboardRoutes.scala:76-97`) starts from the same `findAllByDashboardId(…, userOpt, …)`, so
a token holder gets zero panels and therefore `404 "Panel not found"` for every rows request.

This is not new in cycle 2 — it was present in `437d628f` and I did not catch it. It is blocking now
because it defeats the ticket's first acceptance criterion ("Valid tokens authorize public read
through the sharing path") and CR1's explicit requirement that the link "actually renders the
dashboard read-only".

---

### Verification of the seven items in the cycle-2 brief

**1. Viewer route — routing FIXED, end-to-end outcome BROKEN.** `PublicDashboardViewerPage` is
mounted at `/dashboards/:dashboardId/panels` outside `ProtectedRoute` (`AppRoutes.tsx:85`) and
`buildShareUrl` points at it. Verified **signed out**: the URL resolves to the viewer, not
`NotFoundPage`, with no redirect to `/login`. But it renders the empty state — see the blocking
defect above. **No route collision:** no protected route uses a `/dashboards/*` path (the protected
tree is `/`, `/sources`, `/pipelines`, `/connectors`, `/chat`, `/settings`, `/proposals/*`,
`/patch-sets/*`), and an authenticated user hitting the path renders the read-only viewer sensibly
rather than breaking or hijacking the authenticated dashboard surface.

**2. No UI-layer oracle — VERIFIED.** `PublicDashboardViewerPage.tsx` has exactly one non-loading,
non-success state; the `.catch()` deliberately ignores status and body. Verified live, signed out, by
comparing rendered text across four cases (bogus token, wrong-resource token — a real token from a
different dashboard, nonexistent dashboard id, and no token at all). All four produced the byte-
identical string *"This link isn't available It may have been revoked, expired, or never existed. Ask
the person who shared it for a new link."* Console output was uniform too: only the browser's own
`404 Not Found` resource lines, no app-level message that varies by case. The pre-fetch state does not
leak either — every token-bearing case shows the same `PageSuspenseFallback` before resolving. (The
no-token case skips the request and reaches "denied" without a loading frame; that is not an oracle,
since a visitor already knows whether their own URL carries a token.)

**3. Routing test — DOES NOT catch a mis-pointed `buildShareUrl`.** I mutated `buildShareUrl` to
`/bogus-nonexistent/${dashboardId}/nope?token=…` and re-ran both suites:
`PublicDashboardViewerPage.routing.test.tsx` **stayed green**; `DashboardShareDialog.test.tsx` went
red. The routing test re-types the path as a local literal (`mintedShareUrlPath`) rather than calling
the function, so it verifies "this literal path resolves to the viewer" and nothing about
`buildShareUrl`. This is *better* than cycle 1 — the pair is transitively sound, since the dialog test
pins `buildShareUrl`'s output to a hand-written literal and the routing test pins that literal to a
real route, so any change to `buildShareUrl` reddens something. But the linkage is implicit and
undocumented, it evaporates silently if the dialog test's assertion is ever relaxed to a regex or to
calling `buildShareUrl`, and the routing test's own docstring overclaims ("Renders the real `App` at
the exact path `buildShareUrl` composes") in a way that would falsely reassure the next reader. See
CR-C.

**4. V102 — correct and sufficient, but nothing can distinguish it from absent.** V101 is untouched by
cycle 2; V102 is a separate file. Both applied cleanly (`flyway_schema_history` shows `101` and `102`,
`success = t`). `GRANT SELECT` is exactly what `findActiveByHash` needs. **Asked directly: no, the
suite cannot tell V102 present from absent.** `ShareTokenRlsSpec`'s own fixture issues
`GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged`
before any assertion, so it can never observe a missing grant. And on the live database V38's
`ALTER DEFAULT PRIVILEGES` had *already* granted `helio_privileged` SELECT/INSERT/UPDATE/DELETE on
`share_tokens` from V101 alone (`information_schema.role_table_grants`), so V102 changed nothing
observable here either. It remains defensible, harmless, correctly-reasoned belt-and-braces matching
V100's documented convention — but it should be understood as convention-compliance, not as a fix for
a demonstrated gap. No change requested.

**5. Revoke scoping — implemented, but UNTESTED.** `ShareTokenRepository.revoke` now filters
`row.id === … && row.userId === …` in the query, and `ShareTokenRlsSpec` was kept, not replaced. But I
mutated the `user_id` term back out and re-ran `ShareTokenRlsSpec`, `ShareTokenOwnershipSpec` and
`ShareTokenServiceSpec`: **20 succeeded, 0 failed — nothing went red.** The RLS spec runs under a
genuinely non-bypassing role, so RLS alone still blocks the cross-owner revoke and the query-level
guard is never the thing under test. That is exactly the situation CR6 existed to escape: the guard
is correct today and a future refactor could delete it in silence. See CR-D.

**6. Re-verification of CR2/3/4/7/8/9:**

- **CR2 — FIXED.** Each row renders `Created 9/6/2026, 1:47:46 AM`. Verified live.
- **CR3 — FIXED.** `revokeShareTokenThunk.fulfilled` now maps rather than filters; verified live that
  the revoked row survives in place showing the `Revoked` `StatusChip` with `—` for expiry, the empty
  state is not shown, and the row persists across a dialog close/reopen (audit trail intact). The
  slice and dialog tests were updated to assert the new behaviour.
- **CR4 — FIXED, well.** `ShareDialogProvider` + `ShareDialogHost` move the dialog to `AppShell` level,
  out of `.app-sidebar`. Verified live at 430px: opened from a new per-dashboard "Share" button in the
  mobile nav sheet (accessible name `Share HEL909-EVAL4-clobber`, 44px tall), dialog renders 350×454
  with `documentElement.scrollWidth <= innerWidth` (no horizontal overflow).
- **CR7 — FIXED, correctly scoped.** `mapForbiddenToNotFound` is local to `ShareTokenService`;
  `AccessChecker` is untouched (not in the diff). The new spec asserts a real-but-unowned and an
  absent dashboard produce *identical bodies*, not merely the same status.
- **CR8 — FIXED.** `Option[ShareTokenValidator] = None`; `Option(...)` wrap removed; `ApiRoutes` passes
  `Some(shareTokenValidator)`; four test call sites updated.
- **CR9 — PARTIALLY FIXED; not fixed for its own subject.** `Modal.tsx`'s focus restore is real and I
  confirmed it works and has **not regressed** other modals: opening the dashboard appearance modal and
  pressing Escape returns focus to the `Customize dashboard appearance` button (cycle 1 left it on
  `<body>`). But the share dialog itself still leaves focus on `BODY` after close — verified live.
  Cause: `ShareDialogHost` does `if (target === null) return null`, so the modal **unmounts** instead
  of transitioning `open → false`, and `Modal`'s `[open]` effect never runs its restore branch. See
  CR-E.

**7. No regressions in what passed in cycle 1 — CONFIRMED.** Token fallback ordering is unchanged
except the `Option` refactor; both denial arms still consult the token and Owner/Editor still
short-circuit first (all four `ShareTokenAuthenticatedAccessSpec` cases pass). CSPRNG/SHA-256 storage
untouched. Pool assignment unchanged (`withUserContext` for owner paths, `withSystemContext` only for
`findActiveByHash`, no raw `db.run`). The RLS harness is unchanged and still non-vacuous. Live
indistinguishability at the API layer re-confirmed: valid → `200`; bogus/absent → identical
`404 {"message":"Dashboard not found"}`.

---

### Phase 1: Spec Review — **FAIL**

Ticket AC "Valid tokens authorize public read through the sharing path" is not met: authorization
succeeds, the read returns nothing. `specs/public-dashboards/spec.md` and
`specs/share-link-tokens/spec.md`'s token-grants-read requirements are correspondingly unmet.

Cycle-1 spec gaps 2, 3, 5(partially) and 6 are now closed; the `share-link-management-ui` "Focus
management" scenario remains unmet for this surface (CR-E).

### Phase 2: Code Review — **FAIL**

Gates all pass. The cycle-2 code is good work: the shell-level share-dialog context is the right
structural fix rather than a patch, the CR7 mapping is correctly scoped and honestly documented, and
the `Option` and import cleanups landed. Issues: CR-A (the authorization/data-access split), CR-C
(test linkage), CR-D (untested guard), CR-E (unmount defeats focus restore), plus a garbled
self-correction left in `ShareTokenRepository.revoke`'s scaladoc:
`"filtered only on `revoked_at IS NULL`... no -- filtered only on `id`/`user_id`, not on `revoked_at IS NULL`"`.

### Phase 3: UI Review — **FAIL**

Happy path fails for the anonymous audience (empty page). Denial paths, empty/loading states, mobile
reach, 430px layout, accessible names, keyboard operation and console cleanliness are all good.

### Overall: **FAIL**

---

### Change Requests

**A. (Blocking) Make a share token actually grant read access to panel data.** `PublicDashboardRoutes`
already receives the directive's resolved `ResourceAccess` and discards it. Thread that decision into
the read instead of letting `PanelRepository` re-derive access from `userOpt` alone — e.g. give
`findAllByDashboardId` an explicit "already authorized as Viewer" input (or an
`accessAlreadyGranted: Boolean` that short-circuits the `ownerPred || granteePred || publicPred`
predicate) and pass it from both the `/panels` and `/panels/:id/rows` routes. Do **not** fix this by
minting a public-viewer grant behind the scenes — that would make every token-shared dashboard
publicly readable without a token, which is the opposite of the ticket.
Evidence required: an anonymous, token-bearing request against a dashboard with panels and **no**
public-viewer grant returns those panels, and a `/rows` request for one of them returns rows. Add a
backend spec that asserts a non-zero item count on that exact path (an assertion that would have
failed all through cycle 1), and confirm the four denial cases still return the identical 404.

**B. (Blocking, follows from A) Re-verify the viewer page renders real panels** for a signed-out
visitor, not just a non-404 route. The current `PublicDashboardViewerPage.routing.test.tsx` "renders
the fetched panels" test mocks `fetchPublicDashboardPanels`, so it cannot catch A.

**C. Make the routing test exercise `buildShareUrl` itself.** Export `buildShareUrl` from
`DashboardShareDialog.tsx`, call it in the routing test, strip `window.location.origin`, and render
the real router at the result. This is not the cycle-1 tautology — the assertion is "the router
resolves this to the viewer, not `NotFoundPage`", which is independent of the string. Then correct the
docstring, which currently claims a linkage the test does not have.

**D. Give the CR6 `user_id` query filter its own test.** Removing it reddens nothing today. Add a
repository spec that runs `revoke` against another owner's token id through a **superuser/BYPASSRLS**
pool (mirroring the dev/CI reality CR6 named) and asserts `false` — that isolates the query-level
guard from RLS. Keep `ShareTokenRlsSpec` as-is for the RLS layer.

**E. Keep the share dialog mounted so `Modal`'s focus restore can fire.** In `ShareDialogHost`, render
`<DashboardShareDialog open={target !== null} … />` with stable `dashboardId`/`dashboardName` (or
retain the last target for one render) instead of `if (target === null) return null`. Note the
invoking control is itself unmounted in the desktop `ActionsMenu` case, so also verify where focus
actually lands; restoring to the menu's trigger button would be the sensible target. Verify live that
`document.activeElement` is not `BODY` after close, at both 1440 and 430.

**F. Fix the garbled scaladoc** in `ShareTokenRepository.revoke` — delete the `"... no --"`
self-correction and state the filter once.

### Non-blocking Suggestions

- `dashboard-share-dialog__token-created` has no rule in `DashboardShareDialog.css`; it currently
  inherits. Give it the same treatment as `__token-expiry` for consistent type scale.
- The public viewer still triggers the app's `/api/auth/me` bootstrap, producing a `401` for every
  anonymous visitor. Harmless and not an oracle (it is identical in all cases), but skipping the auth
  probe on this route would be tidier and one fewer request on a public page.
- `PublicDashboardViewerPage` renders panel titles and types only. That is a defensible "floor" per
  its own docstring and HEL-593 owns the real embed surface — worth confirming with the ticket owner
  that a titles-only list is the intended cycle-2 scope once CR-A makes it non-empty.
