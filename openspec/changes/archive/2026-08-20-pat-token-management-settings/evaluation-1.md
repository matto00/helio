## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- Both ticket ACs addressed explicitly and verified live (see Phase 3): create a named PAT and see it
  exactly once at creation (raw value + copy action, gone after "Done"); list + revoke own PATs via
  `ConfirmInline`.
- No AC reinterpreted. Non-goals (no expiration/scoping UI, no backend changes) match proposal.md/design.md
  and were honored — `CreateApiTokenRequest`/`apiTokenService.createApiToken` never send
  `expiresInDays`/`scopedPipelineIds`.
- All `tasks.md` items (1.1–4.4) marked `[x]` and match the diff: types (`apiToken.ts`), service
  (`apiTokenService.ts` + test), state (`settingsSlice.ts` `apiTokens` sub-tree + thunks + `dismissCreatedApiToken`
  reducer + test), UI (`ApiTokensSection.tsx`/`.css` + test), wiring (`SettingsPage.tsx` + test).
- No scope creep: `git diff origin/main...HEAD` (local `main` ref is stale — missing two already-merged
  commits, `origin/main` is the correct base; confirmed both are ancestors of `origin/main` via
  `git merge-base --is-ancestor`) touches exactly the 11 frontend files `files-modified.md` lists — no
  backend changes, consistent with the ticket's frontend-only scope.
- No regressions: `AgentMemoryList.test.tsx`'s only change is adding the new `apiTokens` sub-tree to its
  hand-rolled `SettingsState` preloadedState (required by the larger state shape; the component itself
  never reads/dispatches into it). Live check confirmed every other Settings section (Appearance,
  Preferences, Agent memory, Security, Beta access) renders and behaves unchanged.
- API contracts: none affected — `/api/tokens` is pre-existing and unmodified; frontend
  `ApiTokenResponse`/`CreateApiTokenRequest`/`CreateApiTokenResponse` types were checked field-for-field
  against `backend/src/main/scala/com/helio/api/protocols/ApiTokenProtocol.scala` and match (the
  UI-omitted `scopedPipelineIds` is a documented, intentional non-goal, not a drift).
- Planning artifacts reflect final implementation: design.md's "Shown-once reveal" (atomic
  `createdToken` set + `items` append in one reducer, separate `dismissCreatedApiToken` that only clears
  `createdToken`), "Blank-name guard" (disabled submit, no thunk dispatch), and "Revoke" (per-row
  `ConfirmInline`, client-side list removal) decisions all match the shipped code exactly.

### Phase 2: Code Review — FAIL
Issues:

1. **[mechanical] DESIGN.md spacing-token violation** —
   `frontend/src/features/settings/ui/ApiTokensSection.css:150`:
   ```css
   .api-tokens-list-table__td {
     padding: 8px 10px;
   ```
   DESIGN.md ("Spacing", line 120–121): "**[mechanical]** All margin/padding/gap use a `--space-*` token
   (small optical tweaks ≤ 4px may be literal)." `8px`/`10px` both exceed the ≤4px literal allowance and
   have no exact matching token pair (`--space-2`=8px, `--space-3`=12px). This is new code in this diff
   (a new file), not a pre-existing line the ticket merely touched — it must use tokens even though it
   mirrors an already-noncompliant line in `AgentMemoryList.css:70` (a different file, not modified by
   this change, and not license to introduce a new instance of the same violation).

Everything else in Phase 2 checked out:
- Gates re-run fresh by me in `WORKTREE_PATH` (no `CLEAN_WORKTREE` requested this cycle): `npm run lint`
  (clean, zero-warnings), `npm run format:check` (clean), `npm test` (220 suites / 2376 tests, all green),
  `npm --prefix frontend run build` (succeeds, only the pre-existing >500kB chunk-size advisory, unrelated
  to this change).
- No other CONTRIBUTING.md/DESIGN.md mechanical violations found: no hardcoded hex/rgba, no numeric
  `font-weight` literals, no literal `font-size`, all border-radius/control-height values tokenized, the
  `color-mix(...)` derivations are off intent tokens (`--app-warning`/`--app-error`), not the accent (the
  rule DESIGN.md's mechanical accent-derivation ban actually targets). The Copy button is a labeled
  icon+text control, not icon-only, so `IconButton` is not required for it.
- DRY / modular / readable: reuses `ConfirmInline`, `TextField`, `FormField`, `EmptyState`, `InlineError`
  throughout; no hand-rolled equivalents; `apiTokenService.ts` kept separate from `settingsService.ts` with
  a documented, precedented reason (matches `authService.ts`/MFA).
- Type safety: no `any`, no untyped escape hatches; types mirror the backend protocol field-for-field.
- Error handling: `extractErrorMessage` + `rejectWithValue` at every thunk boundary; per-row `revokeError`
  keyed by id so one row's failure doesn't clobber another's.
- Tests meaningful: service-boundary `Option`-omission normalization, slice reducer/thunk state
  transitions (including the atomic create-reveal-plus-list-append), and component-level create/reveal/
  dismiss/revoke-confirm/revoke-cancel/blank-guard flows are all exercised — these would catch a real
  regression in any of those paths.
- No dead code (no unused imports/TODO/FIXME in the new files); no over-engineering — a single new
  component/service/types module scoped exactly to this feature, no premature abstraction.

Non-blocking (see below): `settingsSlice.ts` was already at 518 lines (over CONTRIBUTING.md's ~400-line
"propose a split" threshold) before this change and is now 663; CONTRIBUTING.md explicitly marks this
class of warning "informational only," so it is not a Change Request, but it's worth a proactive split
proposal given it keeps growing with each new Settings sub-feature.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` (`PASS servers`). Tested
live against the running app at `http://localhost:6159`:

- **Happy path end-to-end**: navigated to Settings, entered a token name, clicked "Create token" — the
  shown-once reveal panel appeared with the raw token value in a readonly mono field, a working
  "Copy" button (confirmed via `navigator.clipboard.writeText` call + a "Token copied to clipboard."
  toast), and the new token also appeared in the list underneath immediately (as design.md specifies —
  not gated behind "Done"). Clicked "Done" — the reveal panel closed, the row's metadata (name/created/
  "Never used") remained in the list, and the raw value was gone.
- **Revoke flow**: clicked "Revoke" on the just-created row — inline `Confirm`/`Cancel` appeared (no
  browser-native `confirm()`); clicked "Confirm" — a `DELETE /api/tokens/:id` fired (`204 No Content`)
  and the row was removed from the list.
- **List + empty state**: the section correctly lists real existing tokens (name/created/last-used, or
  "Never used" for a never-used token, e.g. the pre-existing `skeptic-verify` row) on load; empty-state
  and blank-name-guard behavior verified via the component's own test suite (live account had pre-existing
  tokens, so the empty-state UI itself wasn't independently re-exercised live, but is covered by
  `ApiTokensSection.test.tsx`).
- **Network requests**: `GET /api/tokens` → 200, `POST /api/tokens` → 201, `DELETE /api/tokens/:id` → 204
  — all clean, no failures.
- **Console**: zero console errors on the Settings page across the full create → copy → dismiss → revoke
  flow (`browser_console_messages` scoped to the current page, not `all`, returned 0 errors; the `all`-scope
  errors seen were pre-existing cross-session noise from an unrelated parallel worktree's dev server on a
  different port, not from this session/page).
- **Accessible names / keyboard**: every interactive element resolved by accessible role+name in Playwright
  (`Token name` textbox via `FormField`'s `htmlFor`, `Create token`, `Copy`, `Done`, per-row
  `Revoke <name>` / `Confirm revoke <name>` / `Cancel`) — no unlabeled controls.
- **Breakpoints**: rendered without layout breakage or horizontal overflow at 1440, 1100, 768, and 390px
  (mobile) — confirmed `document.documentElement.scrollWidth === clientWidth` at 390px. The raw `<table>`
  wraps rather than truncating on narrow widths; this is a plain-table-on-mobile density call, not a
  breakage — left to the skeptic's judgment if it warrants a card-list treatment instead.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/settings/ui/ApiTokensSection.css:150` — replace the literal
   `padding: 8px 10px;` on `.api-tokens-list-table__td` with token-based spacing, e.g.
   `padding: var(--space-2) var(--space-3);` (8px/12px — the closest token pair; `--space-3` widens the
   horizontal padding by 2px from today's 10px, which is an acceptable, DESIGN.md-compliant rounding).
   This is new code introduced by this diff; DESIGN.md's mechanical spacing-token rule is binding
   regardless of the pre-existing, unrelated `AgentMemoryList.css:70` line this was modeled on.

### Non-blocking Suggestions
- `frontend/src/features/settings/state/settingsSlice.ts` is now 663 lines (was already 518, over
  CONTRIBUTING.md's ~400-line "propose a split" soft threshold, before this ticket added the `apiTokens`
  sub-tree). CONTRIBUTING.md marks file-size warnings informational-only, so this isn't a Change Request,
  but a follow-up ticket splitting this slice (e.g. by sub-feature, following its own existing sibling
  sub-tree boundaries) would keep pace with Settings' continued growth.
