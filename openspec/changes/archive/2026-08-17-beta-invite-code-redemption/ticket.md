# HEL-704: Beta invite-code request + redemption flow

## Description

### Scope

* Settings: a "Request Beta access" action for a `free`-tier user that sends an email to the product owner with the requester's account info — no self-serve approval, this is intentionally a manual human-in-the-loop step (matches the epic's chosen duplicate-account defense: manual gating, not automated detection).
* Settings: a code-entry field where a user redeems an invite code they received back from the owner, which upgrades their account's `tier` to `beta`.
* Code issuance stays manual for this pass (the owner generates/sends a code by whatever means — a small internal script or direct DB/admin action is sufficient; no self-serve admin UI required here).
* Codes should be single-use and tied to (or at least intended for) the specific requester, not a shareable universal code.

## Acceptance Criteria

- [ ] A `free`-tier user can request Beta access from Settings, and the owner receives an email with enough info to identify and respond to the requester.
- [ ] A user can redeem a valid code from Settings and their tier updates to `beta` immediately (reflected in their own chat access without needing to re-login).
- [ ] An already-used or invalid code is rejected with a clear error, not silently accepted.

## Delivery Context (from dispatching session)

- Parent epic: HEL-701 "Account security + user tiers". Sibling HEL-703 (user tier model) is **merged to main** — `users.tier` column and `free`/`beta`/`owner` model already exist (see `backend/src/main/scala/com/helio/services/UserTierConfig.scala` and `ChatAccessService.scala`). This ticket builds on that; it does not create the tier concept.
- **Migration number: take V90.** Main currently maxes at V88 (HEL-703). Do NOT take V89 — sibling HEL-702 (TOTP MFA) is in flight on its own branch and has claimed V89 there; that file is not visible in a fresh checkout of main. If genuinely uncertain, escalate rather than guess.
- **File-overlap hazard with HEL-702 (in flight):** `backend/src/main/scala/com/helio/infrastructure/UserRepository.scala`. HEL-702 adds MFA table/columns there; this ticket likely adds a tier-update method (redemption sets tier='beta') and possibly a new InviteCode repository. Keep changes minimal in that file; do not restructure it.
- Starting points: `UserTierConfig.scala`, `ChatAccessService.scala`, `UserRepository.scala`, `backend/src/main/scala/com/helio/api/routes/AuthRoutes.scala` (+ a Settings route file if one exists — check), frontend Settings page (under `frontend/src/features/` or `frontend/src/pages/` — check both).
- Email sending: check whether the codebase already has an email mechanism (e.g. password reset) before introducing a new dependency.
- Dev DB: isolate this worktree onto its own fresh local Postgres database (e.g. `helio_hel704`, `.env`-only, gitignored) rather than the shared one — ongoing contention today; HEL-702 and HEL-703 both did this.
- Ports (authoritative, from setup-worktree.sh): DEV_PORT=6136, BACKEND_PORT=9043.
