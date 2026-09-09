## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit `1bfbd33f` against cycle 1's `evaluation-1.md`. All gate transcripts
and all UI findings below are my own fresh runs against the running app on
`:5876` (verified serving this worktree: `/proc/<pid>/cwd` →
`.../light-dark-parity-audit/HEL-444/frontend`), not the executor's report.

### Phase 1: Spec Review — FAIL

**AC1 (token-parity guard) — PASS, unchanged.** Not re-litigated per instruction;
confirmed still green (`npx jest themeParityGuard` → 7/7).

**AC3 / AC4 — PASS (pre-existing, correctly restated).**

**AC2 — FAIL.** The walk is now genuinely much broader and much of it is real
work. But the two rows that convert a *gap* into a *clean unreachable* are both
false, and I refuted both in the running app.

#### Finding 1 (blocking) — the create-dashboard surface is reachable; the stated reason is false

DESIGN.md and `walk-transcript.txt` both claim:

> "the create-dashboard modal could not be opened because this dev-account's
> Dashboards list is non-empty (no 'New dashboard' CTA present)"

On the running app, logged in as the dev account with a **non-empty** list of ~45
dashboards, a create affordance is present and works:

- `DashboardList.tsx:210` renders `aria-label={isCreateMode ? "Cancel dashboard
  create" : "Add dashboard"}` — an always-present `+` button in the sidebar's
  DASHBOARDS header. I clicked it; it entered create mode, focused an input with
  `aria-label="Dashboard name"`, and revealed a `Create dashboard` button and an
  `Import from file` button. It is visible in my own screenshot of the walked
  Dashboards surface.
- The command palette independently exposes a `New dashboard` action
  (`useCreateDashboardAction.tsx:51`), present in the DOM on every surface I
  visited, including Settings.

What is true is narrower and does not support the conclusion: the *literal string*
"New dashboard" as a **hero empty-state CTA** (`DashboardList.tsx:321`) is absent
when the list is non-empty, and the create UI is an **inline form, not a modal**.
The probe appears to have searched for that one string, missed `Add dashboard`,
and then attached a causal explanation ("because the list is non-empty") to the
miss. That explanation is not merely imprecise — it converts a surface that was
walked past into a row claiming it could not be reached, which cycle 1 explicitly
called out as worse than an honest gap.

#### Finding 2 (blocking) — modals, popovers and toasts are all reachable; the stated reason does not even apply

DESIGN.md: *"toasts/popovers were not separately exercised for the same reason."*
The Dashboards list's emptiness has no bearing on either. All three AC2 surface
kinds were reachable in one or two clicks, on surfaces the walk **already
confirmed**:

- **Popover** — `Customize dashboard appearance` (already in the walked Dashboards
  chrome) opens the DASHBOARD APPEARANCE popover with the 9-preset swatch grid and
  two colour pickers. One click.
- **Modal** — Settings (confirmed in the walk) → `Enable two-factor
  authentication` opens the real `MfaEnrollModal` dialog ("Set up two-factor
  authentication", QR, secret field, `Confirm and enable`). One click, on an
  already-walked surface, fully reversible.
- **Toast** — inside that modal, the copy-secret button fired a live toast; I
  captured it in the DOM as `role="status" aria-live="polite"` → *"Key copied to
  clipboard."*, and screenshotted it rendering bottom-right.
  `MfaSecuritySection.tsx:68-77`, `ApiTokensSection.tsx:58-60` and the whole
  `features/connectors/ui/*` set (`ConnectorsPage.tsx:128-152`,
  `CreateConnectorModal`, `EditConnectorModal`, `RotateCredentialModal`) push
  toasts from ordinary, mostly **non-mutating** actions — clipboard copies and
  `Test connection`.

Separately: the Connectors page — the densest cluster of modals and toasts in the
app, and a surface the *parked* lane already screenshotted in both themes — does
not appear in cycle 2's walk at all, in any row, confirmed or unreachable.

So of the four "reported unreachable" rows, two are genuinely unreachable
(`MfaVerifyPage`, `OAuthCallbackPage` — I accept these), one is defensible
(`/proposals/review` with no proposal in state), and the fourth row bundles three
required, reachable surface kinds behind a reason that does not apply to them.

#### CR-by-CR status

| CR | Status | Evidence |
| -- | -- | -- |
| CR1 walk completed / per-surface table | **PARTIAL** | 22-row confirmed/unreachable table exists with reasons; location in DESIGN.md rather than the change dir is fine on substance. Fails on Findings 1–2 and the missing Connectors row. |
| CR2 distinct screenshots + real md5sum | **PASS** | See below. |
| CR3 false md5-distinct claim corrected | **PASS** | `files-modified.md` now states 20 files, 18/20 distinct, and names the 2 pairs. |
| CR4 OrbitMark location fixed, symbol-anchored | **PASS** | DESIGN.md's list (LoginPage/RegisterPage/MfaVerifyPage/OAuthCallbackPage/CommandBar/ConnectorCompletionPage) matches `grep -rl OrbitMark` exactly — 6 sites, no extras, no omissions. |
| CR5 OrbitMark re-measured at fresh default | **PASS** | Verified independently, see below. |
| CR6 conclusion re-scoped | **PARTIAL** | The sentence now enumerates its surfaces instead of claiming blanket satisfaction — the right shape. But the boundary it draws is drawn using Findings 1–2's false unreachable rows, so the scope statement is itself inaccurate. |
| tasks.md ticked against the tree | **FAIL** | Third occurrence, see below. |

**CR2 verified.** `md5sums.txt` is real: I recomputed `md5sum *.png` over all 20
files and every hash matches the committed transcript exactly. 18 distinct values;
the only collisions are `auth-mfa-redirect-{light,dark}` ≡
`auth-oauth-callback-{light,dark}`. I opened the images: both are unmistakably the
`/login` page, matching the transcript's "redirected to
`http://localhost:5876/login`". The self-evidencing claim **holds** — it is not a
cover story. (Minor curiosity, not a finding: those files are *not* byte-identical
to `auth-login-*.png` of the same theme despite showing the same page. If anything
that argues these are genuine independent captures rather than copies.)

**CR5 verified independently.** I recomputed WCAG ratios from the hexes:
`#ea580c` on `#fdfcfa` = **3.47**, `#f97316` on `#1a1816` = **6.32**, `#eab308` on
`#fdfcfa` = **1.87** — all three match to the stated precision, and the
transcript's recorded `{stroke, bg}` pairs on `/login` are exactly those colours.
I also re-measured the live `CommandBar` OrbitMark under this account's persisted
Yellow accent by computed style and got **1.87**. The Yellow figure is retained
honestly and is not buried; the WCAG 1.4.11 logotype exception remains correct.

**tasks.md — FAIL (third time).** Task 4.1 (`[x]`) requires "all
modals/popovers/toasts"; Findings 1–2 show that was not done and was reachable.
Task 4.2 (`[x]`) requires, "for each surface walked, enumerate the elements
ACTUALLY rendering `--app-accent`" — `walk-transcript.txt` records a bare
`rendered` for 13 of the 16 confirmed rows, with an accent measurement on
`auth-login` only. Neither box is supported by the tree.

### Phase 2: Code Review — PASS

No source changed in cycle 2 (`DESIGN.md` + `files-modified.md` only); the cycle-1
code review of `themeParityGuard.css.test.ts` stands. Gates, my own fresh runs in
`WORKTREE_PATH` (clean but for my own untracked `evaluation-1.md`):

- `npm run lint` — clean at `--max-warnings=0`.
- `npm run format:check` — "All matched files use Prettier code style!"
- `npx jest` from `frontend/` (explicit, not the vacuous hook `npm test` —
  HEL-846/768/880) — **298 suites / 3130 tests passed**, 0 failed.
- `npx jest themeParityGuard` — 7/7, AC1 guard still green.
- `npm --prefix frontend run build` — succeeded through PWA `generateSW`.

### Phase 3: UI Review — FAIL

Objective checks against the running app, both themes:

- Happy path, loading/empty/error states, entry points — no blank screens, no
  unhandled exceptions across Dashboards, Settings, the appearance popover, the
  MFA modal and `/login`.
- **Console — clean.** Zero errors and zero warnings across every flow I drove on
  `:5876`. (The console buffer also holds historical entries from *other* ports —
  `:6298`, `:6480` — from unrelated sessions; those are not attributable to this
  worktree and I discount them.)
- Interactive elements had accessible names throughout; `Add dashboard` autofocused
  its input, the toast was correctly announced as `role="status"
  aria-live="polite"`.

**Cohesion (both themes, running app).** I looked for incoherence rather than
token compliance, and did not find a blocking one:

- Dark Settings/Dashboards and light Settings render the same visual dialect —
  same card/elevation treatment, same spacing and type scale, accent applied
  consistently to selected swatch, slider, active-nav indicator and primary
  buttons.
- The MFA modal, the appearance popover and the toast — the three surfaces the
  walk skipped — all sit correctly inside the design language in dark; nothing
  looked like a foreign dialect.
- **One thing I nearly filed and then refuted by measuring**, recorded so it is not
  re-found: with the appearance popover open, `Create dashboard` looks olive/muted
  while `Save dashboard style` looks vivid yellow, which reads as two different
  treatments of one semantic role. Computed style says both are
  `rgb(234,179,8)` on `rgb(24,21,17)` — identical. The difference is the popover's
  backdrop scrim dimming the sidebar. Not a defect. (The same scrim also dims the
  toast, which renders *outside* the modal — cosmetic, out of scope here.)

Phase 3 fails only because the required surfaces in Findings 1–2 were not walked,
not because of what I saw on the surfaces that were.

### Overall: FAIL

The distance travelled this cycle is real: CR2/CR3/CR4/CR5 are properly discharged,
the md5 transcript survives independent recomputation, and the contrast figures
survive independent re-derivation. What blocks is that the two rows the walk uses
to close out AC2's remaining surfaces are both false in the running app.

### Change Requests

1. **Walk the create-dashboard surface and correct the record.** Click the
   `Add dashboard` button (`frontend/src/features/dashboards/ui/DashboardList.tsx:210`,
   `aria-label="Add dashboard"`) on the Dashboards sidebar in both themes, capture
   the create-mode form (name input + `Create dashboard` + `Import from file`),
   and record it as **confirmed**. Delete the sentence "the create-dashboard modal
   could not be opened because this dev-account's Dashboards list is non-empty (no
   'New dashboard' CTA present)" from DESIGN.md and from
   `walk-transcript.txt`. If you want to keep the observation, the only true form
   of it is: *the hero empty-state `New dashboard` CTA
   (`DashboardList.tsx:321`) is not shown when the list is non-empty; the create
   affordance is the always-present `Add dashboard` button, and it opens an inline
   form rather than a modal.*

2. **Walk modals, popovers and toasts — they are reachable and are an explicit AC2
   surface.** Minimum, both themes, all non-destructive:
   - popover: `Customize dashboard appearance` on Dashboards;
   - modal: Settings → `Enable two-factor authentication` (`MfaEnrollModal`),
     closed with Escape without confirming;
   - toast: the copy-secret button inside that modal, or
     `ApiTokensSection.tsx:58`'s copy — fires
     `role="status" aria-live="polite"` "Key copied to clipboard."

   Remove "toasts/popovers were not separately exercised for the same reason" —
   the reason given does not apply to any of them.

3. **Add a Connectors row to the walk.** It is the app's densest modal/toast
   surface (`ConnectorsPage.tsx:128-152` plus four modals) and the parked lane
   already captured it in both themes. It is currently absent from cycle 2's table
   in every category — the exact silent omission task 4.1 forbids. `Test
   connection` is non-mutating and produces both success and error toasts.

4. **Re-scope the DESIGN.md conclusion once more (CR6 follow-through).** The
   enumerated-surface shape is right; the contents are not, because they rest on
   CR1/CR2's false unreachable rows. Once those surfaces are walked, move them from
   "reported unreachable" to the SATISFIED list. Keep `MfaVerifyPage` and
   `OAuthCallbackPage` as unreachable — those two are correct, well-reasoned, and
   self-evidenced by the md5 identity.

5. **Untick `tasks.md` 4.1 and 4.2 until the tree supports them.** 4.1 cannot be
   `[x]` while modals/popovers/toasts are unwalked; 4.2 cannot be `[x]` while 13 of
   16 confirmed rows record only `rendered` with no per-surface enumeration of
   elements actually painting `--app-accent`. Either do the per-surface
   enumeration 4.2 asks for, or amend the task to what was actually done and say so.

### Non-blocking Suggestions

- `walk-transcript.txt`'s `[unreachable] auth-oauth-callback` row is well written —
  it distinguishes "route rendered" from "route's real state exercised". Apply that
  same two-part phrasing to every unreachable row; it is precisely the distinction
  Findings 1–2 blurred.
- Consider capturing the `md5sum` transcript with relative paths (`cd` then
  `md5sum *.png`) rather than absolute ones, so a reader can re-verify with a
  single copy-paste from any checkout.
