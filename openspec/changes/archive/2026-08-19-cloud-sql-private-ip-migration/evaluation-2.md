## Evaluation Report — Cycle 2 (evaluation-2.md)

### Scope note

Commit `67f1269d`, stacked on cycle 1's `111512e4`. This cycle addresses two
change requests discovered live during the actual `task 6.1` `--no-traffic`
cutover-deploy attempt (not part of the original design scope, but blocking a
safe deploy):

1. `infra/deploy-backend.sh`'s `--set-env-vars` was missing
   `HELIO_UPLOADS_BACKEND`, `HELIO_UPLOADS_BUCKET`, `CLAUDE_MODEL` — all live
   on the production service today and would have been silently dropped on
   the script's full env-var replace. Added as literal values.
2. `--set-secrets` referenced `helio-google-client-id`, a Secret Manager
   secret that does not exist. Moved `GOOGLE_CLIENT_ID` to `--set-env-vars`
   as a literal, matching how it's actually configured live.

Per the orchestrator's explicit instruction, both fixes were independently
re-verified against live GCP state myself (not by re-reading the executor's
report), and standard gates were re-run fresh.

### Independent live-GCP re-verification

- **Full live env-var superset check.** Pulled `gcloud run services describe
  helio-backend --region=us-west1 --project=helio-493120 --format=json`
  myself and extracted the live revision's `spec.template.spec.containers[0].env`
  programmatically (13 keys: `DATABASE_URL`, `DB_USER`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`, `HELIO_UPLOADS_BACKEND`,
  `HELIO_UPLOADS_BUCKET`, `COOKIE_SECURE`, `DB_PASSWORD`,
  `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`,
  `HELIO_OWNER_EMAILS`). Independently parsed the fixed script's
  `--set-env-vars`/`--set-secrets` lines (not by re-reading the executor's
  `comm -23` output) into the same key-set form and diffed both sorted lists
  myself: `comm -23 live-env-keys.txt script-all-keys.txt` → **empty** (zero
  live keys missing from the script — strict superset confirmed). The only
  two keys present in the script but not live (`LOG_FORMAT`,
  `HELIO_BETA_DAILY_MESSAGE_LIMIT`) are cycle-1 additions, unchanged by this
  cycle's diff, and are intentional new capability, not a drop.
- **Secret non-existence.** Ran `gcloud secrets describe helio-google-client-id
  --project=helio-493120` myself → `ERROR: NOT_FOUND: Secret
  [projects/522265251224/secrets/helio-google-client-id] not found`. Cross-checked
  with `gcloud secrets list --project=helio-493120`, which returns exactly
  three secrets project-wide (`helio-anthropic-api-key`, `helio-db-password`,
  `helio-google-client-secret`) — `helio-google-client-id` is absent from the
  project entirely, not merely misnamed. This matches the fixed script's
  `--set-secrets` list exactly (now three entries, all of which exist).
- **`GOOGLE_CLIENT_ID` literal value match.** Extracted the live value from
  the same `describe` JSON
  (`522265251224-eannmal9699u40d7d6f0gqpd733gm5hk.apps.googleusercontent.com`)
  and the script's literal (`infra/deploy-backend.sh:53`) — byte-for-byte
  identical. Also cross-checked `HELIO_UPLOADS_BACKEND` (`gcs`),
  `HELIO_UPLOADS_BUCKET` (`helio-uploads-prod`), and `CLAUDE_MODEL`
  (`claude-haiku-4-5-20251001`) the same way — all four literal values the
  script now hardcodes match the live service exactly.
- **`"$@"` passthrough still correct post-edit.** Re-ran my own independent
  stub-`gcloud` simulation (copied the current script + a stub `.env.deploy`,
  replaced `gcloud` on `PATH` with an argv-dumping shim): no-args invocation
  produces 18 args ending in `--project=helio-493120`; `--no-traffic`
  invocation produces the same 18 args plus `--no-traffic` as arg 19,
  appended last. Matches the round-4 skeptic's and skeptic-final-1's
  independent simulations.
- `bash -n infra/deploy-backend.sh` — syntax OK.
- Scope check: `git diff main...HEAD --name-only -- ':!openspec'` still shows
  exactly `infra/README.md` and `infra/deploy-backend.sh` across both cycles
  combined — no new files touched by cycle 2 beyond `deploy-backend.sh` (plus
  `tasks.md`/`workflow-state.md` bookkeeping under the change dir).
  `backend/src/main/resources/application.conf` and `backend/build.sbt` diffs
  against `main` are still empty — genuinely untouched.

### Phase 1: Spec Review — PASS

- Both cycle-2 fixes are legitimate, narrowly-scoped corrections to defects
  in cycle-1's implementation of task 5.2/5.3 (the `--set-env-vars`/
  `--set-secrets` construction), discovered during task 6.1 execution — not
  scope creep. They don't reinterpret any ticket AC; they make the existing
  AC-3 implementation ("update `DATABASE_URL`/connection config... update
  `infra/deploy-backend.sh`") actually correct against live production
  state, which is what AC-3 always required.
- `tasks.md` sections 1-4 checkboxes were also updated to `[x]` in this
  commit, reflecting live infrastructure state completed by the orchestrator
  out-of-band — addresses skeptic-final-1's non-blocking checkbox-hygiene
  note. Accurate: independently re-confirmed via `gcloud sql instances
  describe helio-db` (private IP present, `RUNNABLE`) and `gcloud compute
  networks vpc-access connectors describe helio-vpc-connector` (`READY`) in
  the prior cycle's skeptic-final-1 report, consistent with this evaluator's
  own cycle-1 review context.
- No AC silently reinterpreted; no unrelated changes outside `infra/deploy-backend.sh`
  (+ the tasks.md/workflow-state.md bookkeeping).
- `infra/README.md` was not touched this cycle — correctly unaffected, since
  neither fix changes anything the README documents (both are
  Cloud-Run-env-var mechanics, not networking prerequisites).

### Phase 2: Code Review — PASS

- Fresh gates re-run in `WORKTREE_PATH`:
  - `cd backend && sbt test` — **3281 tests, 0 failed, 0 canceled. All
    tests passed. [success] Total time: 191s.**
  - `bash -n infra/deploy-backend.sh` — syntax OK.
  - `npx prettier --check infra/README.md` — passes (unchanged this cycle).
- The new comment block (`deploy-backend.sh:18-27`) correctly explains *why*
  these four values are hardcoded literals rather than sourced from
  `.env.deploy` (stable, non-environment-specific production config, same
  pattern as the pre-existing `COOKIE_SECURE`/`LOG_FORMAT` precedent) and
  *why* `GOOGLE_CLIENT_ID` moved from `--set-secrets` to `--set-env-vars`
  (the referenced secret doesn't exist; the live service already runs it as
  a plain env var). Matches CONTRIBUTING.md's readability expectations —
  reasoning is documented, not just the mechanical change.
- No security regression: `GOOGLE_CLIENT_ID` is a public OAuth client
  identifier (not a secret by nature — Google's OAuth model treats client
  IDs as non-confidential), consistent with it already being deployed live
  as a plain env var rather than via Secret Manager. `DB_PASSWORD`,
  `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY` remain on `--set-secrets`,
  unaffected.
- DRY/no dead code: no leftover reference to the nonexistent
  `helio-google-client-id` secret anywhere in the file after the edit
  (confirmed via `grep -n "helio-google-client-id" infra/deploy-backend.sh`
  — appears only in the explanatory comment, not in the actual
  `--set-secrets` flag).
- No scope creep beyond the two stated fixes plus the tasks.md checkbox
  correction.

### Phase 3: UI Review — N/A

Unchanged from cycle 1: no files matching any Phase 3 trigger were touched.

### Overall: PASS

### Non-blocking Suggestions

- Carrying forward skeptic-final-1's still-open notes (not re-litigated
  here, not blocking): the `--image=...:v3` tag's current digest doesn't
  match the currently-running production revision's digest — worth a
  conscious check before task 6.1's actual deploy, but this line is
  unchanged by HEL-749 and not a defect this change introduced; the
  `design.md`/`.openspec.yaml` one-day-ahead date label; task 6.3's
  DB-touching verification endpoint could be tightened to specifically
  exercise the privileged/BYPASSRLS pool.
- This cycle's discovery (a full-replace `--set-env-vars`/`--set-secrets`
  invocation silently drops any live var it doesn't enumerate) is a
  structural footgun in `deploy-backend.sh` beyond this specific ticket —
  worth a standalone follow-up ticket considering either a `gcloud run
  services describe`-based pre-deploy diff check, or documenting the
  footgun explicitly in `infra/README.md`'s "Run the deploy" section, so the
  next unrelated env-var addition to the live service doesn't silently
  regress on the next deploy. Not blocking this ticket.
