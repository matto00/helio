## Evaluation Report — Cycle 3 (evaluation-3.md)

Commit reviewed: `44ac1908` (cycle 2 `40f41f3f`, cycle 1 `437d628f`). All gate results and all
mutations below are from my own fresh runs.

**Bottom line: PASS.** The headline defect is genuinely fixed and I confirmed it end-to-end in the
browser, signed out, on a dashboard with no public-viewer grant — the check that failed in both prior
cycles. Every blocking change request from evaluation-2.md is closed, each one verified by a mutation
I ran myself rather than from the executor's report. One non-blocking a11y finding remains (CR-E's
desktop entry point), carried below as a suggestion, not a blocker.

### Gate chain (re-run independently, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm run check:schemas` | PASS |
| `npm run check:openspec` | PASS |
| `npm run check:scala-quality` | PASS ("clean", 158 pre-existing soft warnings) |
| `npm run check:no-credential-leak` | PASS (0 violations) |
| `npm test` | PASS (260 suites / 2672 tests; mcp 24/238) |
| `cd backend && sbt test` | PASS (3935 tests, 0 failed) |

Stale-binary check (the trap I hit last cycle): `start-servers.sh` again reported the backend as
"already healthy … reusing". I killed the JVM on 8929 and restarted; the new process (pid 1655836,
started 11:05:22) is `44ac1908`'s build, and every browser observation below is against it.

---

### 1. CR-A — a share token now returns real data. VERIFIED END-TO-END.

**Live, signed out, anonymous, on dashboard `7f5c7bf9…` which has 4 panels and — confirmed by direct
query — zero rows in `resource_permissions` (no public-viewer grant of any kind):**

- The minted link renders the four real panels: `Untitled Panel / output` ×3 and `anchor / divider`.
  Not the empty state, not `NotFoundPage`.
- `/rows` works too: `GET /api/dashboards/…/panels/<id>/rows?token=…` with `credentials: 'omit'` →
  `200`, `total: 3`, first row `{"amount":10,"name":"Alpha"}`.
- **No public-viewer grant was minted as a side effect** — `resource_permissions` for that dashboard
  is still `count = 0` after all of the above. The prohibited shortcut was not taken.

**The defaulted boolean does not open a hole.** I enumerated every call site in the tree:

- `accessAlreadyGranted = true` is passed from exactly **two** places, both in
  `PublicDashboardRoutes`: line 161 (`/panels`), lexically inside the
  `aclDirective.authorizeResourceWithSharing(…) { _ => … }` block, and line 82 inside `resolveRows`.
- `resolveRows` has exactly **one** caller (line 127), itself inside the same directive block. There
  is no path to either call site that skips the directive — it is lexical scope, not a runtime flag,
  so reaching a data-returning path with `accessAlreadyGranted = true` without having passed the
  token/grant/ownership check is not expressible.
- Every other production caller — `AutoLayoutService`, `RefinementGrounding`,
  `PatchSetPreviewImpact`, `WorkspaceContextService` — uses the default `false` and is unchanged.
  Confirmed empirically: under the CR-A mutation below, `PublicDashboardRoutesSpec`'s pre-existing
  tests (including "return an authorization error for a non-shared dashboard") all still passed, so
  the default preserves existing behaviour exactly.
- `LiteralColumn(true)` short-circuits the predicate but the query is still scoped by
  `.filter(_.dashboardId === dashboardId.value)`, so there is no cross-dashboard widening.

**Mutation (mine):** reverting both `accessAlreadyGranted = true` call sites reddened exactly the two
new tests — "return the dashboard's actual panels for a valid token, on a dashboard with NO
public-viewer grant" and "return the panel's actual rows for a valid token, …". They are real
evidence, not restatements.

Also re-verified the full acceptance loop live: mint → anonymous read returns panels → revoke from
the UI → anonymous read immediately returns the standard `404 {"message":"Dashboard not found"}`.

### 2. Denial indistinguishability — NOT weakened. VERIFIED.

**Mutation (mine):** giving the invalid-token exit a distinct message
(`ErrorResponse("MUTANT: invalid share token")`) still reddens
`ShareTokenPublicAccessSpec`'s byte-identical assertion. The test continues to discriminate after the
CR-A change.

**Live, signed out:** bogus token, wrong-resource token (a real token from a different dashboard), a
nonexistent dashboard id, and no token at all all returned `404|{"message":"Dashboard not found"}` —
`new Set(...).size === 1`. Console output was uniform, and the `/api/auth/me` 401 that used to fire on
this route is now gone (the non-blocking suggestion was implemented).

### 3. CR-C — the routing test now catches a mis-pointed `buildShareUrl`. VERIFIED.

`buildShareUrl` is exported and `mintedSharePath` calls it, stripping `window.location.origin`.
**Mutation (mine):** pointing `buildShareUrl` at `/bogus-nonexistent/${dashboardId}/nope` reddened
`PublicDashboardViewerPage.routing.test.tsx` itself — **3 failed, 1 passed**, matching the executor's
report. The one survivor is the "no token at all" case, which deliberately uses a hardcoded path and
is not derived from `buildShareUrl`; that is correct. This is the third shape of this test and the
first that actually holds.

### 4. CR-D — the query-level `user_id` filter is now isolated from RLS. VERIFIED.

`ShareTokenRepositoryRevokeSpec` is a legitimate use of `new DbContext(db, db)`: the property under
test is the query filter, and a BYPASSRLS pool on both sides is precisely the environment that
isolates it. It is not vacuous — it carries a positive control ("still returns true for the token's
real owner, on the same BYPASSRLS pool") and asserts row state (`revokedAt shouldBe None` /
`shouldBe defined`), not just the boolean.

**Mutation (mine):** removing the `row.userId === …` term produced exactly the split you asked me to
confirm — `ShareTokenRepositoryRevokeSpec` **FAILED**, `ShareTokenRlsSpec` **passed all five**. The
two specs genuinely test different layers, and the guard that reddened nothing in cycle 2 now has
teeth. `ShareTokenRlsSpec` is untouched by this cycle and still uses two genuinely distinct roles
(`helio_app_test` NOSUPERUSER vs `helio_privileged`).

### 5. CR-E — mechanism works; one entry point still lands on `<body>`. NON-BLOCKING.

I verified live at both widths, as asked:

- **430px (mobile nav sheet): WORKS.** After closing the dialog, `document.activeElement` is the
  `Share HEL909-EVAL4-clobber` button. The `ShareDialogHost` stay-mounted change and Modal's own
  capture fallback are both correct.
- **1440px (desktop `ActionsMenu`): STILL `<body>`.** Not fixed.

Probe-confirmed root cause, not a guess: the `restoreFocusSelector`
`button[aria-label="HEL909-EVAL4-clobber actions"]` **does** match an element, and that element is
`display: inline-flex; visibility: visible; opacity: 1` — but its bounding rect is **0×0**, because
the sidebar row's actions trigger is collapsed until hover. `HTMLElement.focus()` on a zero-sized
element is a no-op, so focus stays on `<body>`. I confirmed the obvious alternative works: focusing
`button[aria-label="HEL909-EVAL4-clobber"]` (the dashboard row button itself, 215×32) succeeds.

**No regression to other modals:** the dashboard appearance modal still returns focus to
`Customize dashboard appearance` on Escape, exactly as in cycle 2.

Worth recording for whoever picks this up: `ShareDialogFocusRestore.test.tsx` **passes** while the
real browser fails, because jsdom has no layout and will happily focus a 0×0 element. The executor
labelled that limitation honestly in the file header ("cannot substitute for that live check") rather
than hiding it, which is the right call — but it does mean the follow-up must be verified in a real
browser, since this test will stay green either way.

I am **not** blocking on this. It is an accessibility polish defect on one of two entry points, the
mechanism is proven working on the other, the fix is one line, and the brief is explicit that a FAIL
here escalates rather than loops.

### 6. CR-B, CR-F, non-blocking items, and prior-cycle regressions.

- **CR-B — DONE.** The two new `ShareTokenPublicAccessSpec` tests hit the real database through the
  real route (not a mocked service) and assert non-zero item/row counts; my mutation proved they
  redden. Plus the live browser confirmation above.
- **CR-F — DONE.** The garbled `"... no --"` self-correction is gone; the scaladoc now states the
  filter once, correctly.
- **Non-blocking items — both done.** `.dashboard-share-dialog__token-created` now shares the
  `--text-xs` / `--app-text-muted` rule with `__token-expiry`; the public viewer route now skips the
  `rehydrateAuth` call (verified live — no 401 in the console on that route), via a single shared
  `PUBLIC_DASHBOARD_VIEWER_PATH` regex used by both call sites.
- **No regressions.** `AclDirective`, `ShareTokenService`, `ShareTokenValidator` and `ShareTokenRlsSpec`
  are untouched this cycle. Token fallback ordering on both denial arms, CSPRNG + SHA-256-only
  storage, per-method pool assignment, and the non-vacuous RLS harness all still hold, and CR2/3/4/7/8
  from cycle 1 remain in place — re-confirmed live: `Created …` timestamps render, the revoked row
  survives showing `Revoked` / `—`, the mobile entry point works at 430px, and all 3935 backend tests
  pass.

### 7. V102 honesty — CONFIRMED.

`files-modified.md` states plainly that V102 is convention-compliance, that nothing in the test suite
or the live database can distinguish it from absent (V38's default privileges already covered
`share_tokens`), and that no test was written pretending otherwise. I checked: there is no such test.
The claim in the committed artefacts matches what I independently found in cycle 2.

---

### Phase 1: Spec Review — **PASS**

Ticket AC now met end-to-end: mint with optional expiry, revoke, revoked/expired links stop
authorizing immediately; valid tokens authorize public read *and* return the data; invalid ones are
denied indistinguishably in status and body; owner-only management; schemas and specs updated; backend
ScalaTest and frontend Jest coverage present and mutation-verified; CSPRNG generation.

### Phase 2: Code Review — **PASS**

The CR-A fix is the right shape — it threads the directive's existing authorization decision through
rather than widening the repository's predicate or minting a grant, the parameter is defaulted so no
existing caller changes, and the doc comment explicitly warns against deriving it from `callerOpt` or
hardcoding it. Test evidence is now genuine at every point I probed.

### Phase 3: UI Review — **PASS**

Happy path works for the anonymous audience. Denial states are uniform, loading and empty states are
present, the mobile entry point works, 430px renders without overflow, interactive controls have
accessible names and 44px targets, and there are no console errors in any flow. The one accessibility
gap (desktop focus restore) is recorded as a suggestion.

### Overall: **PASS**

### Change Requests

None blocking.

### Non-blocking Suggestions

- **Desktop share-dialog focus restore (CR-E follow-up).** In `DashboardList.tsx`, point
  `restoreFocusSelector` at the always-laid-out dashboard row button
  (`button[aria-label="${dashboard.name}"]`) instead of the hover-collapsed `… actions` trigger,
  **or** have `shareDialogContext.close()` fall back to the next focusable ancestor when
  `element.getBoundingClientRect()` is zero-sized. Verify in a real browser at 1440 —
  `ShareDialogFocusRestore.test.tsx` passes today despite the live failure and will not catch a
  regression here.
- The mobile path relies on Modal's `document.activeElement` capture while the desktop path needs an
  explicit selector. If a third entry point is ever added, consider making `restoreFocusSelector`
  mandatory so the choice is deliberate rather than implicit.
- `PublicDashboardViewerPage` still renders a titles-and-types list rather than real panel content.
  That is its documented deliberate floor with HEL-593 owning the embed surface, and it is no longer
  masking a defect now that the data path works — but it is worth a line in the HEL-593 ticket that
  the viewer page exists and is where richer rendering should land.
