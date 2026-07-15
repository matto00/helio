## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Scope fidelity.** `ticket.md` restricts this change to W1, W2, W6, §3.2, §4.2 of
  `notes/mobile-pwa-handoff.md`. Confirmed `proposal.md`/`design.md`/`tasks.md` never touch
  `PanelGrid`, `BottomNav`, `App.tsx`/`App.css`, or any renderer (`grep` for those terms across the
  three artifacts returns only the explicit "out of scope" line in `design.md:35`). No scope drift
  into HEL-301/HEL-302 territory.
- **Ground truth cited accurately.**
  - `frontend/src/theme/theme.css:86,133` — `--app-bg: #121110` (dark) / `#f4f2ed` (light), matching
    `design.md`'s Decisions 5/6 exactly.
  - `frontend/src/features/auth/ui/LoginPage.tsx:88` — confirmed
    `window.location.href = ${API_BASE_URL}/api/auth/google`, matching the §3.2 citation.
  - `frontend/src/main.tsx:15` — `setupAuthInterceptor` wired first, matching the ordering constraint
    in Decision 1.
  - `DESIGN.md:151-152` — canonical breakpoints "1440 / 1100 / 768 ... [mechanical]", matching the
    ratification target in Decision 7.
  - `frontend/src/features/panels/ui/PanelDetailModal.css:575` — confirmed `@media (max-width: 480px)`
    exists exactly as described.
  - `grep -rnE "@media...max-width|min-width...px" frontend/src --include=*.css | grep -v
    1440|1100|768` returns **only** that one 480px hit — the claim "no other undocumented breakpoint
    values remain" is verifiably true, so task 3.2's grep-to-confirm step is achievable as scoped.
  - `frontend/src/features/auth/ui/auth.css:6,210` — confirmed `min-height: 100vh` exists in the auth
    pages, grounding Decision 9's audit.
  - `frontend/index.html` — confirmed the Google Fonts trio links exist as described (Fraunces /
    Schibsted Grotesk / JetBrains Mono), and no PWA meta/manifest exists yet.
  - `frontend/vite.config.ts` — confirmed no existing PWA plugin, straightforward addition point.
  - `frontend/src/features/panels/ui/panelGridConfig.ts` — confirmed RGL's `xs` breakpoint is `0`, not
    a named px value, so extending `DESIGN.md`'s canonical set to include 430px does not require
    touching `panelGridConfig.ts` in this change (correctly out of scope; RGL breakpoints are HEL-301
    territory).
  - `.github/workflows/cd-frontend.yml` — confirmed the Firebase Hosting deploy pipeline is a plain
    `npm ci && npm run build && firebase deploy`, supporting the "ships unchanged" migration claim and
    the "PNGs committed, not built in CI" decision.
  - `frontend/public/orbit-mark.svg` — confirmed the mark uses a fixed `#f97316`, not a CSS
    variable/accent token, so it is already not accent-reactive; generated manifest icons inherit the
    same existing (non-)behavior, no new gap introduced.
- **No placeholders/hand-waving.** `grep -rniE "TODO|TBD|figure out later|placeholder"` across the
  change directory returns nothing.
- **No internal contradictions.** `proposal.md` → `design.md` → `tasks.md` → the three spec deltas
  form a consistent chain; each of Decisions 1-9 in `design.md` maps to a concrete task in `tasks.md`
  (1.1-1.4, 2.1-2.3, 3.1-3.2, 4.1-4.2, 5.1-5.3, 6.1-6.2).
- **Correct handling of the device-verification constraint.** `ticket.md`'s explicit instruction
  ("terminal state is 'ready for device testing', not 'done'") is honored: `tasks.md` §6 ends in a LAN
  preview + written device test plan, not a completion claim. The OAuth fallback (Decision 8 / task
  4.2) is correctly staged as an *inert* prepared remediation rather than pre-applied, consistent with
  "the device test answers §3.2."
- **Contract/schema impact.** Confirmed no `schemas/` or `backend/` paths appear anywhere in the
  Impact section or tasks; matches the ticket's out-of-scope list.

### Verdict: CONFIRM

### Non-blocking notes

1. `tasks.md` §5 (verification gates) has no explicit step for the agent-verifiable half of the AC
   "Desktop and iPad ≥768px visually and behaviourally unchanged" (`ticket.md:56`). This doesn't
   require a physical device — a desktop-width browser check would do — and per the ticket's own
   framing ("Code-level criteria... CAN be verified without a device and should be") it belongs in the
   plan. Not blocking implementation (the final-gate skeptic will check this as part of its normal
   light/dark + breakpoint visual pass), but worth adding as an explicit task line so the executor
   doesn't skip it.
2. `design.md` Decision 4 doesn't specify a background/fill treatment for the apple-touch-icon
   generated from `orbit-mark.svg`, which has a transparent background. iOS fills transparent
   apple-touch-icon PNGs with black by default, which could undercut the "reads on light home screens"
   requirement. This is explicitly framed as a device-test item already (`design.md:62`,
   `ticket.md:15`), so it will surface during device testing either way — flagging only so the
   executor considers an explicit background/padding choice (e.g. `--app-bg`) rather than leaving it
   to the tool's default.
