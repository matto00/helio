## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Ticket problem statement is accurate.** Read `infra/deploy-backend.sh` directly:
   it does hardcode `--image=us-west1-docker.pkg.dev/helio-493120/helio-backend/helio-backend:v3`
   near the top of the `gcloud run deploy` invocation, with `"$@"` forwarded
   verbatim at the very end (HEL-749 Decision 4c). Matches ticket.md/design.md's
   description exactly.

2. **cd-backend.yml tagging claim is accurate.** Read
   `.github/workflows/cd-backend.yml`: it builds
   `us-west1-docker.pkg.dev/helio-493120/helio-backend/helio-backend:${BRANCH}-${SHA}`
   (branch with `/` → `-`, 8-char sha) on every push to `release/**`, and never
   references `:v3`. Confirms the proposal/design's central claim (the two tagging
   schemes have diverged) rather than taking it on faith.

3. **Base spec state matches what the design/spec-delta assume.** Read
   `openspec/specs/production-deployment-docs/spec.md`: the existing "README
   documents Cloud Run deployment" requirement currently has exactly the three
   bullets (`.env.deploy` prerequisite, Secret Manager secrets, VPC/Private-IP
   prerequisite) that the delta's MODIFIED block reproduces verbatim before
   appending the new `--image=` bullet — correct openspec convention (a MODIFIED
   block must show the complete new state, not just the diff), and I confirmed
   no drift/hallucination in the reproduced text. The existing separate
   requirement "deploy-backend.sh contains no hardcoded environment-specific
   identifiers" is untouched and doesn't overlap/contradict the new ADDED
   requirement (that one is scoped to OAuth/CORS/redirect identifiers; the new
   one is specifically about the image tag).

4. **infra/README.md's current "Run the deploy" section will become
   misleading without task 2.1.** Read `infra/README.md`: it currently instructs
   `bash infra/deploy-backend.sh` with zero flags — exactly the invocation the
   new guard will reject. Tasks.md 2.1 and the spec delta's new scenario both
   correctly target updating this section with the `--image=` requirement and
   both tag-discovery methods, so the docs won't ship stale relative to the
   code change.

5. **Spec/tasks acceptance-check consistency.** The delta's `grep -E --
   '--image=us-west1-docker' infra/deploy-backend.sh` scenario matches tasks.md
   1.4 verbatim; `bash -n` is already covered by the base spec's pre-existing
   "Script is syntactically valid" requirement (unchanged), so no duplicate/gap
   there.

6. **openspec validate --strict passes** for this change (ran it myself,
   `Change 'fix-stale-deploy-image-tag' is valid`).

7. **No placeholders/hand-waving.** No `TODO`/`TBD` anywhere in proposal.md,
   design.md, tasks.md, or the spec delta. Design.md's D1/D2/D3 each name a
   concrete decision plus the alternative considered and why it was rejected
   (e.g. D1 explicitly rejects "default to the currently-live image" as masking
   the exact failure mode the ticket exists to close). Non-goals explicitly and
   correctly exclude the two adjacent footguns from scope (build-a-fresh-tag,
   and the separate `--set-env-vars`/`--set-secrets` full-replace issue flagged
   during HEL-749).

8. **No scope drift.** Impact section: "No application code, schema, or API
   changes" — correct, this is an infra-script + doc change; no code beyond
   `infra/deploy-backend.sh` and `infra/README.md` is touched per tasks.md.

9. **Git state confirms this is genuinely pre-execution.** `git status --short`
   in the worktree shows only the untracked `openspec/changes/fix-stale-deploy-image-tag/`
   directory — no code changes yet, consistent with a design-gate review.

### Non-blocking notes

- Task 1.5 ("manually exercise the guard... stub or dry-run `gcloud`") doesn't
  prescribe the exact stubbing mechanism. That's a reasonable level of detail
  to leave to the executor for a single-script change; not ambiguous enough to
  block on.
- D2's accepted risk (substring match on `--image=` could false-positive on an
  unrelated flag value that happens to contain the literal text) is correctly
  identified and reasonably dismissed — no such value exists in this script's
  current fixed flags, and a genuinely malformed `--image=` still fails at
  `gcloud run deploy` one step later. Worth re-confirming at the final gate
  that no fixed flag value in the script (e.g. inside `--set-env-vars`) was
  changed to contain that substring, but nothing in this design suggests that
  will happen.

### Verdict: CONFIRM

The design accurately reflects the current state of `infra/deploy-backend.sh`,
`cd-backend.yml`, and the existing spec/README (independently verified, not
just asserted). The chosen approach (fail-fast guard + docs, ticket's option b)
is justified with a real alternative-considered/rejected rationale, tasks map
cleanly onto the spec delta and the ticket's suggested fix, non-goals correctly
fence out adjacent scope, and `openspec validate --strict` passes. Sound enough
to implement as written.
