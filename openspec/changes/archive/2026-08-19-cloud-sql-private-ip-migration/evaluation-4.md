## Evaluation Report — Cycle 4 (evaluation-4.md)

### Scope note

Commit `68ad21f9`, stacked on `111512e4` + `67f1269d` + `e08390e3`. This
cycle fixes evaluation-3's blocking CR1: `GOOGLE_CLIENT_ID` is now sourced
from `infra/.env.deploy` via `${GOOGLE_CLIENT_ID}`, matching the existing
`GOOGLE_REDIRECT_URI`/`CORS_ALLOWED_ORIGINS` pattern exactly, and added to
`.env.deploy.example`, README's variable table, and this change's own spec
delta.

The orchestrator also asked me to exercise explicit judgment on a specific
claim: that the scenario text I cited in evaluation-3
(`grep -E 'GOOGLE_CLIENT_ID=' infra/deploy-backend.sh` SHALL be empty) is
mechanically unsatisfiable as literally worded for *any* script that passes
`GOOGLE_CLIENT_ID` as a named `--set-env-vars` entry at all — hardcoded or
not — because the `KEY=` assignment syntax itself always contains that
substring.

### Judgment call: does cycle 4's fix satisfy the requirement's real intent?

**I independently re-ran the disputed claim myself, and went further — I
traced the requirement back to the archived change that originally created
it, not just its current text in the canonical spec.**

- `grep -E 'GOOGLE_CLIENT_ID=' infra/deploy-backend.sh` (current, cycle-4
  script) → **non-empty**, matches the `--set-env-vars` line
  (`GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}`).
- `grep -E 'GOOGLE_REDIRECT_URI=' infra/deploy-backend.sh` → **also
  non-empty**, matches the same line (`GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI}`).
  This pattern has *always* matched, since before HEL-749 even started
  (confirmed: `git show main:infra/deploy-backend.sh | grep 'GOOGLE_REDIRECT_URI='`
  also matches) — `GOOGLE_REDIRECT_URI` has never been hardcoded, has
  always been `.env.deploy`-sourced, and has never once been flagged as a
  violation of this requirement across four skeptic-design rounds, two
  skeptic-final rounds, or my own three prior evaluations. The claim is
  independently confirmed: the literal grep pattern (with no anchor
  distinguishing a literal value from a `${...}` reference) matches on the
  `KEY=` substring alone, regardless of what follows it.
- **I went one step further than re-running the grep**: I located the
  original archived change that introduced this exact requirement
  (`openspec/changes/archive/2026-06-13-remove-hardcoded-deploy-identifiers`)
  and read its own `tasks.md` verification steps (1.6, 4.3), which specify
  the pattern the author actually intended to enforce:
  **`grep -E 'GOOGLE_CLIENT_ID=[0-9]'`** — with a trailing `[0-9]`, matching
  only a literal value that starts with a digit (real Google OAuth Client
  IDs always start with a numeric project number, e.g.
  `522265251224-...`), which a `${...}` variable reference can never match
  (`$` is not `[0-9]`). The canonical spec's scenario text
  (`openspec/specs/production-deployment-docs/spec.md`, and the archived
  change's own `specs/production-deployment-docs/spec.md`, identical) drops
  the `[0-9]` qualifier from the scenario's *headline* grep command, but the
  scenario's own parenthetical is explicit about intent regardless: *"no
  literal value SHALL be present."* The `[0-9]`-qualified pattern is the
  more precise, directly-executable form of that same stated intent, and it
  was the author's own actual verification step for this exact requirement
  from day one — this isn't a new interpretation I'm inventing to excuse a
  fix, it's recovering the original, more precise acceptance test that the
  scenario's shorthand headline text failed to fully transcribe.
- Ran that more precise pattern myself against the current (cycle-4) script:
  `grep -E 'GOOGLE_CLIENT_ID=[0-9]' infra/deploy-backend.sh` → **empty**
  (exit 1, no match) — **passes**. No literal, digit-leading OAuth Client ID
  value appears anywhere in the script; the only occurrence of
  `GOOGLE_CLIENT_ID=` is the variable-reference form.
- **Conclusion: cycle 4's fix genuinely satisfies the requirement's real,
  traceable intent.** The scenario's headline grep text (without `[0-9]`)
  is imprecise — it would "fail" against the codebase's own
  already-established, never-disputed `GOOGLE_REDIRECT_URI`/
  `CORS_ALLOWED_ORIGINS` pattern, which cannot be what the requirement's
  author meant given their own tasks.md used the tighter pattern for the
  same check. I am not mechanically failing this cycle on the literal,
  overbroad scenario text — the substance of the requirement (no
  *hardcoded, literal* OAuth Client ID value in the script) is now
  correctly satisfied, and was not before cycle 4.
- **This is a genuine spec-text defect, independent of HEL-749**, worth
  fixing on its own terms (see Non-blocking Suggestions) — but not a reason
  to block this ticket, whose own diff now correctly removes the actual
  hardcoded literal the requirement cares about.

### Independent re-verification: env-var superset still holds

Re-derived from scratch, fresh, exactly as in cycles 2/3 (not by re-reading
`files-modified.md`'s transcription):

- `gcloud run services describe helio-backend --region=us-west1
  --project=helio-493120 --format=json`, parsed programmatically → 13 live
  keys, unchanged from every prior cycle's pull.
- Independently parsed the cycle-4 script's `--set-env-vars`/`--set-secrets`
  lines into the same key-set form and diffed: `comm -23 live-keys
  script-keys` → **empty** (zero drops). `comm -13` → `LOG_FORMAT`,
  `HELIO_BETA_DAILY_MESSAGE_LIMIT` only (unchanged, pre-existing additions,
  not new). The key set is structurally unaffected by cycle 4 — only
  `GOOGLE_CLIENT_ID`'s *value construction* changed (literal → `${...}`
  reference), not its presence as a key.
- **Simulated the fixed script with `.env.deploy.example`'s own values**
  (copied `.env.deploy.example` verbatim to a scratch `.env.deploy`, as a
  real operator following the README would) with an argv-dumping `gcloud`
  stub: the resulting `--set-env-vars` string carries
  `GOOGLE_CLIENT_ID=522265251224-eannmal9699u40d7d6f0gqpd733gm5hk.apps.googleusercontent.com`
  — correctly sourced through variable expansion, byte-for-byte identical
  to the live value, confirming the `.env.deploy.example` placeholder (the
  real prod value, deliberately used as the example since it's a public
  identifier, not a secret) round-trips correctly through the script.

### Other checks

- `bash -n infra/deploy-backend.sh` — syntax OK.
- `npx prettier --check infra/README.md` — passes.
- `git check-ignore -q infra/.env.deploy` — exit 0, still correctly
  gitignored (unaffected by `.env.deploy.example` gaining a new
  documented variable).
- Spec delta's three scenarios re-read in full against the corrected
  content: Scenario 1 ("Operator reads deploy prerequisites") now correctly
  requires `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`
  — README's variable table (§3) lists exactly these three. Scenarios 2 and
  3 unaffected, still satisfied (unchanged this cycle).
- Scope check: `git diff main...HEAD --name-only` (excluding `openspec/`)
  shows exactly `infra/.env.deploy.example`, `infra/README.md`,
  `infra/deploy-backend.sh` — the three files this fix legitimately touches,
  nothing else. `git diff main...HEAD -- backend/` still empty — backend
  genuinely untouched across all four cycles.

### Phase 1: Spec Review — PASS

- Cycle 3's blocking CR1 is now correctly resolved: `GOOGLE_CLIENT_ID` is
  sourced from `.env.deploy`, not hardcoded, satisfying the base spec
  requirement's actual intent (confirmed via the archived change's own
  original, more precise verification pattern — see judgment-call section
  above), not just its imprecise headline scenario text.
- `.env.deploy.example`, README's variable table, "Run the deploy" step 1's
  prose, and this change's own spec delta are all internally consistent and
  mutually correct — no leftover reference anywhere to `GOOGLE_CLIENT_ID`
  being a hardcoded literal or a `--set-secrets` entry.
- No scope creep: `ANTHROPIC_API_KEY`'s pre-existing README documentation
  gap remains correctly untouched (still out of scope, as established and
  independently verified in evaluation-3).
- All ticket ACs relevant to this cycle's scope remain correctly addressed;
  planning artifacts reflect implemented behavior.

### Phase 2: Code Review — PASS

- Fresh gates re-run in `WORKTREE_PATH`:
  - `cd backend && sbt test` — **3281 tests, 0 failed, 0 canceled. All
    tests passed. [success] Total time: 192s.**
  - `bash -n infra/deploy-backend.sh` — syntax OK.
  - `npx prettier --check infra/README.md` — passes.
- The new comment block (`deploy-backend.sh:34-40`) correctly explains why
  `GOOGLE_CLIENT_ID` moved from a cycle-2 literal to a cycle-4
  `.env.deploy`-sourced reference, citing the specific spec requirement by
  name — consistent with CONTRIBUTING.md's expectation that non-obvious
  decisions are documented, not just made.
- DRY: no duplicated/conflicting statements left about `GOOGLE_CLIENT_ID`'s
  delivery mechanism across `deploy-backend.sh`, `README.md`,
  `.env.deploy.example`, or the spec delta.
- `.env.deploy.example` committing the real production OAuth Client ID as
  its placeholder value is not a credential exposure: OAuth Client IDs are
  public-by-design identifiers (confirmed both by the requirement's own
  parenthetical and by the fact this same value is already visible in the
  live Cloud Run service's env-var listing to anyone with project read
  access) — consistent with why it was never on `--set-secrets` even before
  this ticket started.

### Phase 3: UI Review — N/A

Unchanged from prior cycles: no files matching any Phase 3 trigger were
touched.

### Overall: PASS

### Non-blocking Suggestions

- The canonical spec's scenario text itself
  (`openspec/specs/production-deployment-docs/spec.md`'s "Grep confirms no
  hardcoded OAuth Client ID" scenario) is imprecisely worded — its headline
  `grep -E 'GOOGLE_CLIENT_ID='` command doesn't match its own parenthetical
  intent or its originating change's actual verification pattern
  (`grep -E 'GOOGLE_CLIENT_ID=[0-9]'`, from the archived
  `2026-06-13-remove-hardcoded-deploy-identifiers` change). Worth a small,
  independent spec-hygiene fix (add the `[0-9]` qualifier, or otherwise
  make the scenario's literal text match its own stated intent) so a future
  reader doesn't hit the same "is this actually satisfiable" confusion —
  not blocking this ticket, and not this ticket's own spec delta to touch
  (this requirement isn't part of what HEL-749's delta modifies).
- Carrying forward still-open, already-flagged, non-blocking items from
  prior cycles: `design.md`/`.openspec.yaml`'s one-day-ahead date label;
  task 6.3's DB-touching verification endpoint could specifically exercise
  the privileged/BYPASSRLS pool; the `--set-env-vars`/`--set-secrets`
  full-replace footgun is worth a standalone follow-up ticket; the stale
  `--image=...:v3` tag needs a conscious check/override before task 6.1's
  actual deploy; `HELIO_UPLOADS_BUCKET`'s hardcoded literal is arguably in
  the same spirit as the now-fixed `GOOGLE_CLIENT_ID` issue but isn't
  covered by any formal scenario; the `ANTHROPIC_API_KEY` README gap is a
  reasonable inclusion in a future secrets-documentation-audit ticket.
