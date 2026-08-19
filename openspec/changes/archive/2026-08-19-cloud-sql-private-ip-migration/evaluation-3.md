## Evaluation Report — Cycle 3 (evaluation-3.md)

### Scope note

Commit `e08390e3`, stacked on `111512e4` + `67f1269d`. This cycle addresses
two change requests from skeptic-final-2:

1. `infra/deploy-backend.sh`'s `--max-instances=3` (stale) → `--max-instances=2`
   (matching the live, intentionally-set production value from
   `.github/workflows/cd-backend.yml` commit `51f110c0`, which caps instance
   count specifically to avoid re-exhausting the privileged DB pool's
   connection budget at 3+ concurrent instances).
2. `infra/README.md` and the spec delta still documented the now-removed
   `helio-google-client-id` secret as a requirement (false since cycle 2's
   fix). Corrected both.

Both were independently re-verified against live GCP state, per the
orchestrator's explicit instruction (not by re-reading the executor's
report). In the course of that independent review I also cross-checked the
change's cumulative diff against the **canonical, unmodified** base spec
(`openspec/specs/production-deployment-docs/spec.md`, distinct from this
change's own spec delta) and found a real, mechanically-verifiable
regression that no prior round (including my own evaluation-1/2) caught —
see Change Request 1 below.

### Independent live-GCP re-verification (cycle 3's two stated fixes)

- **`--max-instances=2` matches live reality, confirmed three independent
  ways, fresh:**
  - `gcloud run services describe helio-backend --region=us-west1
    --project=helio-493120 --format="value(spec.template.metadata.annotations.'autoscaling.knative.dev/maxScale')"`
    → `2`.
  - `gcloud run revisions describe helio-backend-00054-fzq
    --region=us-west1 --project=helio-493120 --format="value(metadata.annotations)"`
    → confirms the currently-live, 100%-traffic revision itself carries
    `autoscaling.knative.dev/maxScale=2` (the effective per-revision cap;
    the service-resource-level `run.googleapis.com/maxScale: '20'`
    annotation is separate, vestigial metadata that does not govern the
    live revision's actual scaling — confirmed by cross-checking the
    revision-level annotation directly rather than trusting the
    service-level one).
  - `git log -1 --format="%B" 51f110c0` → confirmed this commit genuinely
    exists on `main` (not a fabricated citation) with the exact message
    "Pin production CLAUDE_MODEL to Haiku 4.5 and cap Cloud Run to 2
    instances," whose body states the privileged DB pool (5
    connections/instance) exhausted `db-g1-small`'s connection budget at
    3+ concurrent instances — matching `deploy-backend.sh`'s new comment
    block verbatim in substance.
- **`helio-google-client-id` secret re-confirmed non-existent, fresh:**
  `gcloud secrets describe helio-google-client-id --project=helio-493120`
  → `NOT_FOUND`. `gcloud secrets list --project=helio-493120` → exactly 3
  secrets project-wide, none named `helio-google-client-id`.
- **Spec delta's 3 scenarios re-confirmed satisfied by the corrected
  README**, read in full:
  - Scenario 1 ("Operator reads deploy prerequisites") — unaffected by this
    cycle, still satisfied (README §3 unchanged).
  - Scenario 2 ("Operator reads Secret Manager prerequisites") — README §2
    now lists exactly `helio-db-password`, `helio-google-client-secret`,
    matching the spec delta's corrected prose bullet exactly, and matching
    the two secrets that genuinely exist and are genuinely required
    (`helio-google-client-id` correctly dropped from both).
  - Scenario 3 ("private networking prerequisites") — unaffected by this
    cycle, still satisfied (README §1 unchanged).
  - The added "Note:" (README:76-79) and the corrected "Run the deploy"
    step 2 sentence (README:117) accurately describe `GOOGLE_CLIENT_ID`'s
    actual current mechanism (`--set-env-vars`, not `--set-secrets`) —
    verified against the actual script content, not just internal
    consistency.
- **`ANTHROPIC_API_KEY`/`helio-anthropic-api-key` gap independently
  confirmed pre-existing, not scope creep to leave unaddressed:**
  `git show main:infra/README.md | grep -i anthropic` → no match. The
  **canonical base spec** (`openspec/specs/production-deployment-docs/spec.md`,
  read in full) also never lists `helio-anthropic-api-key` in the "README
  documents Cloud Run deployment" requirement's secrets bullet — this gap
  predates HEL-749 entirely (it's absent from both the README and the
  requirement text it must satisfy, before this ticket touched either).
  The executor's decision to flag-but-not-fix this is correct: fixing it
  would be undocumented scope creep beyond both this ticket's AC and its
  own spec delta.

### Phase 1: Spec Review — FAIL

Cycle 3's two explicit fixes are both correct and fully verified (see
above). However, a broader spec-compliance check surfaced a real,
mechanically-verifiable regression still present in the cumulative diff at
`HEAD` that must be fixed before this ships:

**Change Request 1 (blocking) — `GOOGLE_CLIENT_ID`'s hardcoded literal value
in `infra/deploy-backend.sh` (introduced cycle 2, still present after cycle
3) violates the canonical, unmodified base-spec requirement "deploy-backend.sh
contains no hardcoded environment-specific identifiers."**

- `openspec/specs/production-deployment-docs/spec.md` (the canonical spec
  this change's own delta does **not** touch or modify for this specific
  requirement — confirmed by reading this change's spec delta in full;
  it contains exactly one `## MODIFIED Requirements` section, for "README
  documents Cloud Run deployment," and says nothing about this separate,
  adjacent requirement) states, verbatim:

  > `infra/deploy-backend.sh` SHALL NOT contain any hardcoded
  > environment-specific identifier values (OAuth Client IDs, redirect
  > URIs, CORS origins, or other values that vary per deployment target).
  >
  > #### Scenario: Grep confirms no hardcoded OAuth Client ID
  > - **WHEN** `grep -E 'GOOGLE_CLIENT_ID=' infra/deploy-backend.sh` is
  >   executed
  > - **THEN** the output SHALL be empty (the variable name may appear as
  >   a Secret Manager mapping key but no literal value SHALL be present)

  This requirement (and its exact scenario) originates from an
  already-archived, unrelated prior change
  (`openspec/changes/archive/2026-06-13-remove-hardcoded-deploy-identifiers`)
  and was already binding on `main` well before HEL-749 started. It is
  still fully in force: this change's delta never declares it `MODIFIED`,
  so OpenSpec's semantics mean it carries through unchanged.
- I ran the literal scenario command myself, fresh, against the current
  file: `grep -E 'GOOGLE_CLIENT_ID=' infra/deploy-backend.sh` →
  **non-empty** —
  `--set-env-vars="...GOOGLE_CLIENT_ID=522265251224-eannmal9699u40d7d6f0gqpd733gm5hk.apps.googleusercontent.com...`.
  The scenario's required outcome (empty output) fails outright, on the
  exact acceptance test the requirement itself prescribes.
- This isn't a stylistic nit: cycle 2's fix (moving `GOOGLE_CLIENT_ID` from
  a `--set-secrets` reference to a `--set-env-vars` literal, because the
  `helio-google-client-id` secret doesn't exist) was the right call on the
  narrow "does the script work" question, but it reintroduced exactly the
  class of hardcoding HEL-231 was filed to eliminate — the requirement's
  own parenthetical explicitly names "OAuth Client IDs" as the paradigm
  example of what must not be hardcoded, precisely because `deploy-backend.sh`
  is meant to be portable across deployment targets without editing the
  script itself (the same reasoning that already correctly keeps
  `GOOGLE_REDIRECT_URI`/`CORS_ALLOWED_ORIGINS` sourced from `.env.deploy`
  rather than hardcoded, right next to this line).
- No prior round caught this: skeptic-design 1-4, skeptic-final-1,
  skeptic-final-2, and my own evaluation-1/evaluation-2 all reviewed
  `infra/README.md`'s and the spec delta's "README documents Cloud Run
  deployment" requirement (the one this change actually modifies) but
  never cross-referenced the adjacent, unmodified "no hardcoded
  identifiers" requirement in the same canonical spec file against the
  cycle-2 `GOOGLE_CLIENT_ID` literal — this evaluation is the first pass to
  check the *other* requirement in that spec file against the cumulative
  diff.
- **Required fix (one of):**
  1. Source `GOOGLE_CLIENT_ID` from `infra/.env.deploy` (add it to
     `infra/.env.deploy.example`, add its `GOOGLE_REDIRECT_URI`-style
     documentation row to `infra/README.md`'s prerequisites table) instead
     of hardcoding it as a script literal — this satisfies both the base
     spec's existing requirement and cycle 2's original discovery (the
     value still doesn't go through a nonexistent Secret Manager secret,
     it just moves to the already-established environment-specific-config
     channel this script already uses for exactly this class of value).
  2. If the team has a considered reason `GOOGLE_CLIENT_ID` should be a
     blessed exception to HEL-231's rule (e.g., because this script only
     ever targets one project and the value is agreed to be effectively
     fixed), that decision belongs in this change's **own spec delta** as
     an explicit `MODIFIED Requirements` entry narrowing "deploy-backend.sh
     contains no hardcoded environment-specific identifiers" — with
     reasoning — not a silent hardcode that leaves the canonical spec's
     existing scenario permanently failing after this change archives.

Everything else in Phase 1 holds: all ticket ACs relevant to this cycle's
scope remain correctly addressed; no other scope creep; tasks.md checkboxes
accurate; planning artifacts reflect implemented behavior for the two
explicitly-requested fixes.

**Non-blocking observation (not the blocking CR, flagged for completeness):**
`HELIO_UPLOADS_BACKEND`, `HELIO_UPLOADS_BUCKET`, and `CLAUDE_MODEL` (also
hardcoded literals, added in cycle 2) are not covered by this specific
requirement's only formal scenario (which tests `GOOGLE_CLIENT_ID=`
exclusively) and aren't in the requirement's named example categories
(OAuth Client IDs / redirect URIs / CORS origins) — I'm not treating these
as a blocking violation of the same requirement, but flagging that
`HELIO_UPLOADS_BUCKET` in particular (a project-specific GCS bucket name)
is arguably in the same spirit and worth a conscious look if CR1 is
revisited.

### Phase 2: Code Review — PASS (mechanically; see Phase 1 for the spec-level blocker)

- Fresh gates re-run in `WORKTREE_PATH`:
  - `cd backend && sbt test` — **3281 tests, 0 failed, 0 canceled. All
    tests passed. [success] Total time: 172s.** (Confirmed `backend/`
    genuinely untouched across all three cycles: `git diff main...HEAD --
    backend/` is empty.)
  - `bash -n infra/deploy-backend.sh` — syntax OK.
  - `npx prettier --check infra/README.md` — passes.
- The new `--max-instances` comment (`deploy-backend.sh:18-25`) correctly
  cites `51f110c0` and the specific capacity mechanism (privileged pool
  size × instance count vs. `db-g1-small`'s connection budget), matching
  CONTRIBUTING.md's readability expectations — reasoning documented, not
  just the mechanical change.
- README's corrected secrets table/prose and the spec delta's corrected
  bullet list are both internally consistent and DRY (no duplicated,
  now-conflicting statements about `GOOGLE_CLIENT_ID`'s delivery mechanism
  left anywhere in either file).
- No scope creep beyond the two stated fixes plus the (correctly justified,
  out-of-scope) `ANTHROPIC_API_KEY` documentation gap left untouched.

### Phase 3: UI Review — N/A

Unchanged from cycles 1-2: no files matching any Phase 3 trigger were
touched.

### Overall: FAIL

### Change Requests

1. (Blocking, see Phase 1 for full detail) `infra/deploy-backend.sh`'s
   `GOOGLE_CLIENT_ID=522265251224-eannmal9699u40d7d6f0gqpd733gm5hk.apps.googleusercontent.com`
   literal (introduced in cycle 2, `67f1269d`, still present at `e08390e3`)
   violates the canonical, unmodified base-spec requirement "deploy-backend.sh
   contains no hardcoded environment-specific identifiers"
   (`openspec/specs/production-deployment-docs/spec.md`) — confirmed by
   running the requirement's own prescribed scenario command
   (`grep -E 'GOOGLE_CLIENT_ID=' infra/deploy-backend.sh`), which the spec
   requires to output nothing and currently does not. Fix by sourcing
   `GOOGLE_CLIENT_ID` from `infra/.env.deploy` (matching
   `GOOGLE_REDIRECT_URI`/`CORS_ALLOWED_ORIGINS`'s existing pattern in the
   same script) rather than hardcoding it, or explicitly amend this
   change's own spec delta to carve out a documented exception if the team
   decides hardcoding is intentionally acceptable here.

### Non-blocking Suggestions

- `HELIO_UPLOADS_BUCKET`'s hardcoded literal is arguably in the same spirit
  as CR1 (a project-specific identifier) even though it isn't covered by
  the requirement's only formal scenario — worth a conscious look if CR1 is
  revisited, not blocking on its own.
- Carrying forward still-open, already-flagged, non-blocking items from
  prior rounds: `design.md`/`.openspec.yaml`'s one-day-ahead date label;
  task 6.3's DB-touching verification endpoint could be tightened to
  specifically exercise the privileged/BYPASSRLS pool; the
  `--set-env-vars`/`--set-secrets` full-replace footgun (evaluation-2,
  skeptic-final-2) is worth a standalone follow-up ticket; the stale
  `--image=...:v3` tag is a distinct, pre-existing decision the orchestrator
  should consciously confirm/override before task 6.1's actual deploy.
- The `ANTHROPIC_API_KEY`/`helio-anthropic-api-key` gap in
  `infra/README.md`'s Secret Manager section — confirmed genuinely
  pre-existing (predates HEL-749 in both the README and the canonical
  spec's requirement text) — is correctly out of this ticket's scope, but
  would be a reasonable inclusion in whatever follow-up ticket eventually
  does a general secrets-documentation audit.

### Critical Path (final-cycle note)

This is cycle 3. If `EXECUTION_CYCLES` (workflow-state.md) is `3`, this is
the final cycle and Overall = FAIL, so per this evaluator's brief: the
single most important item to resolve is Change Request 1 above — it is a
narrowly-scoped, mechanically-verifiable fix (move one literal to
`.env.deploy`, or write one line into this change's spec delta) that does
not require another live-GCP round-trip or any further design
deliberation. Recommend the executor apply option 1 (source
`GOOGLE_CLIENT_ID` from `.env.deploy`) in a fourth cycle, since it is the
lower-risk path that requires no new spec decision and directly restores
compliance with an already-established, incident-motivated (HEL-231)
constraint. If cycle budget is exhausted, this is safe for direct human
correction — it is a single-line script edit plus a two-line README/example
addition, not a design question.
