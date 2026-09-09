## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `981b7e3c` (the only executor commit; `608b8ae1`/`3e8d2167` are planning).
Base `f20ea8f6`. All gate transcripts below are my own fresh runs, not the executor's.

### Phase 1: Spec Review — FAIL

**AC1 (token-parity guard) — PASS.** Genuinely well built and genuinely
mutation-proved; see Phase 2.

**AC2 (every listed surface, both themes) — FAIL. This is the ticket's entire
genuine deliverable and it was not delivered.**

The ticket and task 4.1 enumerate: Dashboards + PanelGrid, Sources, Pipelines,
Proposal Review, auth pages, all modals/popovers/toasts, mobile shell — each with
a recorded per-surface result (confirmed / mismatched / unreachable), an
unreachable surface REPORTED and never silently skipped.

What actually exists:

- **Screenshots: 4 distinct images, all of Dashboards.** The directory holds 6
  files, but two are byte-identical duplicates:

  | file | md5 |
  | -- | -- |
  | `dashboards-dark.png` | `6926e353ac4fa70e2509a60d42cf612c` |
  | `verified-dark.png` | `6926e353ac4fa70e2509a60d42cf612c` (identical) |
  | `dashboards-light.png` | `7566af061d3b14abfdcd3c2154e93c8b` |
  | `verified-light.png` | `7566af061d3b14abfdcd3c2154e93c8b` (identical) |

  `files-modified.md` states "6 screenshots ... all md5-distinct". That is
  **false**, and task 4.6 specifically required verifying distinctness by
  `md5sum`. The check was claimed, not performed. (For scale: the parked lane
  produced 18 screenshots across 9 surfaces for an *incomplete* walk.)

- **No per-surface walk record exists anywhere.** Not in the change dir, not in
  `.concertino/runs/HEL-444/evidence/`. The only prose account is the DESIGN.md
  block, which claims a computed-style sweep of **"Dashboards, Sources,
  Pipelines, and Connectors"** — four surfaces, of which only Dashboards has any
  supporting artifact.

- **Four required surfaces have no result of any kind — not confirmed, not
  mismatched, not reported unreachable:** Proposal Review, auth pages,
  modals/popovers/toasts, mobile shell. Silent omission is exactly what task 4.1
  forbids.

This omission is not cosmetic. `OrbitMark` — the one element the report itself
identifies as still rendering raw `--app-accent` below 3:1 — renders on
`LoginPage`, `RegisterPage`, `MfaVerifyPage`, `OAuthCallbackPage` and
`ConnectorCompletionPage`. **The auth pages are both a required walk surface and
the primary home of the one open finding, and they were never visited.**

**AC3 / AC4 — PASS (pre-existing, correctly restated).**

**Planning artifacts reflect implementation — FAIL.** See Change Request 4:
DESIGN.md, the binding design document, misstates where `OrbitMark` renders.

### Phase 2: Code Review — PASS

Gates, run by me in `WORKTREE_PATH` (worktree clean, no uncommitted files):

- `npm run lint` — clean, `--max-warnings=0`.
- `npm run format:check` — "All matched files use Prettier code style!"
- `npx jest` from `frontend/` (explicit, per task 8.14 — not the vacuous hook
  `npm test`) — **298 suites / 3130 tests passed**, 0 failed.

`frontend/src/theme/themeParityGuard.css.test.ts` is a good piece of work:

- Correctly sited as a Jest test beside its `theme.css`-parsing siblings (CR1 /
  D9.2), with no husky, `check:*`, `.selftest.mjs` or gate-chain surface added.
- Header distinguishes itself from `check-tokens.mjs`, `state-surface-contrast-guard.spec.ts`
  **and** the two single-token guards (task 8.4).
- Brace-depth block extraction rather than a line range; declaration-position
  anchor matching `check-tokens.mjs`'s `DECLARATION_RE`.
- "Declared in neither block" is a non-violation, with a dedicated test proving
  that leniency does not swallow "declared in exactly one" (D9.3).
- `EXCEPTIONS` pinned per-token with a reason, empty today, and able to expire.

**Mutation arms — all three verified real by me, not taken on report.** Arm 1
(single-theme token) and Arm 2 (stale exception) are in-suite and green. Arm 3
was the CR3 risk (the parked draft passed vacuously here), so I probed it
independently: I deleted the non-vacuity floor from `checkThemeParity` and re-ran —
**Arm 3 alone went red** (`1 failed, 6 passed`), then restored the file. The
floor is load-bearing; CR3 is genuinely discharged.

Minor: `expect(result.darkCount).toBe(29)` is a hard-pinned count. Intentional
and documented as drift detection, and it resolves ticket.md's stale 30/30 vs
the current 29/29 (task 8.11). Acceptable.

### Phase 3: UI Review — FAIL

I did not need to start a dev server to reach this verdict: the walk artifacts
required to substantiate the UI claim do not exist for the surfaces in question
(see Phase 1). The four Dashboards screenshots that do exist render correctly and
cohesively in both themes — accent-tinted active nav, legible body and muted
text, no layout breakage — so the Dashboards surface is genuinely confirmed. That
is one surface out of eight.

The DESIGN.md conclusion **"AC2 is now honestly SATISFIED"** is asserted over a
walk that covered at most half the required surfaces and evidenced one. Claim (b)
— that HEL-1046/1048/1050 fixed the two parked findings — is *substantively*
supported for the focus ring and the accent-text link: the derived-token matrix
transcript is a real Jest run over 8 presets x 2 themes (ring min 3.01, text min
5.10), and the executor did re-derive rather than re-read ticket descriptions.
That part of the work is sound. The problem is scope, not that claim.

Claim (c), the `OrbitMark` logotype exception, **I tested and it holds on the
merits**: the SVG is `aria-hidden="true"`, and in `CommandBar` it sits inside a
`<Link aria-label="Helio home">` beside a visible `Helio` wordmark, so it conveys
no information not otherwise available in text. It is not the active-nav
indicator (that is a separate accent-tinted nav item, visible in the
screenshots); the ticket's Scope phrase "the OrbitMark/active nav indicator"
enumerates two things rather than equating them. WCAG 1.4.11's logotype exception
applies. **The judgment call is correct — but the sentence recording it is not
(CR4), and it must be re-measured on the auth pages once those are walked.**

### Overall: FAIL

### Change Requests

1. **Complete the AC2 walk, or report each surface as unreachable with a
   reason.** Visit in BOTH themes, with the fresh-reload-no-persisted-accent
   procedure task 8.12 mandates: Dashboards + PanelGrid (done), Sources,
   Pipelines, Proposal Review, auth pages (`LoginPage`, `RegisterPage`,
   `MfaVerifyPage`, `OAuthCallbackPage`), modals/popovers/toasts, and the mobile
   shell. Produce a **per-surface table** with an explicit
   confirmed / mismatched / unreachable result for every row, committed as a
   walk record in `openspec/changes/light-dark-parity-audit/`. A surface you
   cannot reach is a REPORTED row, never an absent one.

2. **Capture and verify distinct screenshots per surface per theme**, into
   `.concertino/runs/HEL-444/evidence/walk-screenshots-2026-09-09/`. Then
   actually run `md5sum` and paste the transcript. Delete or regenerate
   `verified-light.png` / `verified-dark.png`, which are byte-identical copies of
   the `dashboards-*` pair.

3. **Correct the false evidence claim in `files-modified.md`**: "6 screenshots
   ... all md5-distinct" must not survive into the deliverable. State the true
   count and the true distinctness result.

4. **Fix the `OrbitMark` location in `DESIGN.md`.** The committed text says it is
   "visible at small size in Settings/Chat chrome". It renders in
   `CommandBar.tsx` (the wordmark home link), `LoginPage`, `RegisterPage`,
   `MfaVerifyPage`, `OAuthCallbackPage` and `ConnectorCompletionPage` — not
   Settings or Chat. Re-anchor by symbol per task 8.13. This is the fourth
   confidently-false base description this ticket has produced, and here it
   actively conceals that the finding's main surfaces were never walked.

5. **Re-measure `OrbitMark` on the auth pages in both themes** once CR1's walk
   reaches them, and record the ratio there rather than only at the persisted
   Yellow accent on one surface. Keep the WCAG 1.4.11 exception — it is correct —
   but note in DESIGN.md that the measurement was taken at a **persisted**
   Yellow accent, which contradicts the fresh-default procedure the rest of the
   walk claims to follow; re-take it under the fresh default.

6. **Re-scope the DESIGN.md conclusion.** "AC2 is now honestly SATISFIED" cannot
   stand on a partial walk. Either complete the walk (CR1) and let the sentence
   stand on evidence, or state which surfaces the conclusion covers.

### Non-blocking Suggestions

- `tasks.md` is all `[x]`, including 4.1 ("walk every top-level surface") and 4.6
  ("verified DISTINCT by md5sum"), neither of which the tree supports. This is
  the same over-ticking pattern the cold-resume note flagged in the parked lane.
  Tick against the tree.
- The derived-token matrix probe ran from a temp file
  (`src/theme/__tmp_matrix_probe.test.ts`) that is correctly not committed;
  consider noting in the transcript that it was intentionally transient, so a
  future reader does not hunt for a missing test.
