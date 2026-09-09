## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the worktree, the running app, or a
command I ran myself. The executor/evaluator reports were read only as claims to refute.

The diff is **additive-only and contains zero runtime code**: one Jest guard
(`frontend/src/theme/themeParityGuard.css.test.ts`, 293 lines), a 117-line `DESIGN.md`
section, and change artifacts. No `.tsx`/`.css`/backend file is touched. That bounds the
blast radius: this change cannot itself introduce a UI/UX gap. The risk here is entirely
**whether the audit's claims are true**, which is where I spent my effort.

### One retraction, up front (my own measurement was wrong first)

My first check reported the AC2 evidence directories **missing** — the worktree's
`.concertino/runs/HEL-444/evidence/` holds only 18 flat PNGs dated Sep 8, with no
`walk-2026-09-09-cycle2/` or `cycle3/`. I re-ran before concluding, as required. The
evidence lives in the **durable persisted location** in the main checkout
(`/home/matt/Development/helio/.concertino/runs/HEL-444/evidence/`), because `.concertino/`
is gitignored (`.gitignore:87`) and the worktree copy is a stale parked-cycle remnant.
`DESIGN.md`'s citations are repo-root-relative and **resolve correctly once merged**.
Claim retracted; not a finding.

### What I verified (with evidence)

**AC1 — token-parity guard.**
- `npx jest --testPathPatterns=themeParityGuard` → **7 passed**.
- Independently re-parsed `theme.css` with my own Python brace-depth parser (not the
  guard's code): dark **29** `--app-*`, light **29**, **30** total custom properties per
  block, the non-`--app-*` one being exactly `--canvas-dot`, set difference **empty both
  directions**. `DESIGN.md`'s "29 / 30 / `--canvas-dot`" sentence is accurate to the digit.
- **Mutation arms re-verified on the final tree, non-vacuously.** I transpiled the guard's
  pure logic to CJS in `/tmp` and ran two builds: original, and a mutant with the
  non-vacuity floor programmatically excised (623 bytes removed). Result: with the floor
  removed, arm 3's fixture still yields `errors.length > 0` — my first, coarse check —
  but its *actual Jest assertion* is `expect(result.errors[0]).toMatch(/zero --app-\*
  declarations/)`, and `errors[0]` becomes `"--app-bg is declared in the light theme block
  but not the dark one"`, which **does not match**. So arm 3 genuinely goes RED on
  floor-removal and genuinely discriminates. The cycle-1 evaluator's claim holds. Arms 1
  and 2 also red.
- The guard is not a duplicate of `check-tokens.mjs` (which resolves references anywhere,
  so a dark-only token passes it) — verified by reading both.

**AC2 — evidence integrity (the claim shape that failed three times).**
- `md5sum -c md5sums.txt` on `walk-2026-09-09-cycle3/` → **OK on all 20**; my own
  `uniq -c` over the hashes → **20/20 distinct**. The "20/20 md5-distinct" claim is true
  this time.
- `walk-2026-09-09-cycle2/`: **18/20 distinct**, and the only two duplicate groups are
  `auth-mfa-redirect-light ≡ auth-oauth-callback-light` and the dark pair — exactly the
  two pairs `DESIGN.md` discloses. Disclosed, not concealed.

**AC2 — the rendered-accent claim, re-derived live.** Servers reused (`assert-phase.sh`
equivalent: both `READY`). The stored preset was **Yellow** — the adversarial worst case.
- Live `<html>` inline style: `--app-accent: #eab308; --app-focus-ring-color: #a88106;
  --app-accent-text: #7c5f04`. These match `derived-token-matrix.txt`'s Yellow row exactly
  (`ring=#a88106`, `text=#7c5f04`), confirming the derivation is real and not transcribed.
- My own computed-style sweep of every visible non-zero-area element, for `color`,
  `border-*-color`, `outline-color`, `text-decoration-color`: **0 hits in light, 0 hits in
  dark**. The only raw-accent renders anywhere were 3 SVG `fill`/`stroke` nodes = the
  `OrbitMark`. `DESIGN.md`'s "zero elements rendering raw `--app-accent`" claim is scoped
  to color/border/outline and is **literally and materially true**.

**`DESIGN.md` factual assertions (this ticket produced four false self-descriptions; I
checked every one that remains).** All correct:
- `OrbitMark` consumers by grep = `LoginPage`, `RegisterPage`, `MfaVerifyPage`,
  `OAuthCallbackPage`, `CommandBar`, `ConnectorCompletionPage` — **exactly** the list
  given. The old "Settings/Chat chrome" error is genuinely corrected.
- `DashboardList.tsx:210` is the `aria-label={isCreateMode ? ... : "Add dashboard"}`
  `IconButton` toggling `isCreateMode` (an **inline** form, always present in
  `dashboard-list__header-actions`); `:321` is the separate empty-state hero CTA. Both
  citations land on the right lines in `features/dashboards/ui/DashboardList.tsx`.
- `EmptyState.css:32,73` use `var(--app-accent-text)`, not raw accent.
- Commits `736a8cbb` (HEL-1046), `153f6714` (HEL-1048), `35d8e5e9` (HEL-1050) all exist
  with the stated subjects.
- Matrix: 16 computations, thinnest ring **Cyan/light 3.01**, thinnest text **Yellow/light
  5.10** — matches the doc.

**AC4 — gates.** `npm run lint` (`eslint src --max-warnings=0`) clean; `npm test` →
**298 suites / 3130 tests passed**, 0 failures.

**Cohesion (the mandate) — running app, both themes, 1440×900, Yellow preset.**
Dashboards and Connectors captured and *looked at* in light and dark. Structural parity is
exact: identical layout, spacing rhythm, type hierarchy and weights; the accent tint on the
active nav pill and selected list row translates coherently (pale cream in light, muted
amber-brown in dark); mono `Base URL` column, muted secondary text, and button treatments
are consistent across themes and consistent between the two surfaces. Nothing illegible,
nothing off-brand, no new visual dialect. I found **no cohesion finding**.

### The `OrbitMark` WCAG 1.4.11 exception — my call, and I endorse it

I reproduced the number myself: `#eab308` on `#fdfcfa` = **1.87:1**, below 3:1. Two prior
agents endorsed excepting it; that is not why I do.

The decisive fact is one I established by inspecting the live DOM, and which **`DESIGN.md`
does not record**: the mark is not a standalone control. It sits inside
`<a class="app-command-bar__logo" aria-label="Helio home">` **beside a visible `Helio`
wordmark** (`span.app-command-bar__wordmark`, 16px/600) measuring **16.33:1** against the
same surface. The SVG is `aria-hidden="true"`. So the mark is neither the accessible name,
nor the visual affordance, nor the sole indicator of any control's boundary or state — the
wordmark carries all three, far above threshold. That is precisely the logotype case
1.4.11 excepts, and removing the mark entirely would cost no user any information.

I also confirmed the exception is **recorded narrowly**: it names the token, the file, the
component, the clause and the measured ratio, and says "not treated as a defect **for any
preset**" about *this mark* only. Nothing in the section reads as a general licence to
paint raw `--app-accent` on light surfaces — and the surrounding text explicitly reaffirms
that the raw accent × surface matrix still fails and that the derived
`--app-accent-text`/`--app-focus-ring-color` tokens are what UI must use. Adequate.

### `MfaVerifyPage` / `OAuthCallbackPage` unreachability — tested, holds

I did not take the reasoning on trust. `MfaVerifyPage.tsx:30` returns
`<Navigate to="/login" replace />` when `mfaChallenge === null`, and the challenge is
transient `authSlice` state that is never persisted (the file's own header says so). Both
routes sit under `PublicOnlyRoute`. So the redirect is **enforced in code**, not merely
asserted — the byte-identical screenshots are a consequence, not the evidence.

I pushed one step further than prior reviewers: the pages *are* reachable with effort
(enrol MFA on the dev account via the `MfaEnrollModal` the walk already opened, log out,
log back in). So "unreachable" is really "not reached." I tested whether that gap is
**material** and it is not: the only classes these two pages use that the walked
`LoginPage`/`RegisterPage` do not are `auth-link-btn`, `auth-loading` and
`auth-loading--inline`, and reading their rules in `auth.css` shows them **fully
tokenized** — `--app-text-muted`, `--app-accent-text` (theme-aware, ≥4.5:1 across all 16
preset×theme combinations per the matrix), `--space-5`, `--text-xs`, `--weight-medium`,
`--app-transition`; the two `auth-loading` rules carry **no colour at all** (pure layout,
spinner delegated to the shared `Spinner` primitive). With AC1's guard now structurally
guaranteeing no `--app-*` token is single-theme, the residual parity risk on those two
pages is nil. And the doc reports them as not-confirmed rather than folding them into the
SATISFIED verdict — which is the honest handling.

### Verdict: CONFIRM

Every claim I could falsify, I tried to falsify, and each survived independent
re-derivation — including the three specific claim shapes that failed in earlier cycles
(checksum distinctness, control reachability, and `DESIGN.md`'s description of its own
base). The scope restatements were not re-litigated per instruction; the delivered work
honours them. Gates are green, lint is clean, and the app is visually coherent in both
themes.

### Non-blocking notes

1. **`DESIGN.md` inverts the emphasis on where `OrbitMark` renders.** It says the mark
   renders "on the **auth pages** (…, plus `CommandBar`/`ConnectorCompletionPage`)" and
   measures it "on `/login`". `CommandBar` is listed, so this is not false — but the
   `CommandBar` instance is the **always-visible one in app chrome on every authenticated
   page**, which is where I actually found it (`HEADER.app-command-bar` on `/`). A future
   reader could reasonably conclude it is auth-only. Worth one line: "primarily the
   persistent app-chrome logo, plus the auth pages."
2. **Record the wordmark in the exception.** The strongest justification for the 1.4.11
   exception — the adjacent 16.33:1 `Helio` wordmark carrying the label and affordance,
   with the SVG `aria-hidden` — is absent from the paragraph. Adding it would make the
   exception self-defending against a future re-flag, which is exactly the paragraph's
   stated purpose.
3. Worth stating in the doc *why* the two cycle-2 duplicates are self-evidencing: the pairs
   are MFA↔OAuth **within** a theme (both redirect to the same `/login`), which is what
   makes byte-identity the evidence rather than a defect.
4. Housekeeping: I moved my own five scratch screenshots out of the main checkout into
   `.concertino/runs/HEL-444/evidence/skeptic-final-scratch/` (gitignored) so the clean
   `main` working tree stayed clean. Nothing was deleted.
