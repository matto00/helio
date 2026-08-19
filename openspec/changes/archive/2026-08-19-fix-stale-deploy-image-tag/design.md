## Context

`infra/deploy-backend.sh` is a manual `gcloud run deploy` wrapper: it sources
`infra/.env.deploy` for a few environment-specific values, hardcodes a batch of
stable production env vars/secrets, and forwards any extra CLI args via `"$@"`
(added in HEL-749 Decision 4c). It hardcodes
`--image=us-west1-docker.pkg.dev/helio-493120/helio-backend/helio-backend:v3`,
a tag frozen at some earlier point and never updated. The real deploy pipeline
(`.github/workflows/cd-backend.yml`, on push to `release/**`) builds and pushes
a fresh `${BRANCH}-${SHA}` tagged image on every deploy and never touches
`:v3`. HEL-749's cutover confirmed the hardcoded tag was already stale
relative to the live revision, and worked around it with an explicit
`--image=` override (gcloud's calliope parser is last-flag-wins, confirmed via
argv-dumping stub during HEL-749's final gate — see
`openspec/changes/archive/2026-08-19-cloud-sql-private-ip-migration/skeptic-final-3.md`).
Left as-is, any future plain invocation of this script silently downgrades
production.

## Goals / Non-Goals

**Goals:**
- Make it impossible for a routine `deploy-backend.sh` invocation to silently
  deploy a stale/wrong image.
- Keep the script's existing `"$@"` passthrough as the single mechanism for
  supplying the image, rather than adding a second, parallel flag-parsing path.
- Document the script's actual role (manual/bootstrap path, not the routine CD
  path) so the required `--image=` flag isn't a surprise.

**Non-Goals:**
- Teaching `deploy-backend.sh` to build/push images itself, mirroring
  `cd-backend.yml`. The script has no build step today; adding one duplicates
  the CD pipeline and is a materially larger change than fixing the stale-tag
  bug. (Ticket's option (a), rejected — see proposal Non-goals.)
- Touching the `--set-env-vars`/`--set-secrets` full-replace footgun flagged
  during HEL-749's evaluation, or any other env var in this script — out of
  scope, tracked separately.

## Decisions

**D1 — Remove the hardcoded `--image=` flag; require it via `"$@"`, fail fast
if absent.** Rather than computing a "current" tag automatically (which would
either require a build step this script doesn't have, or guess at a tag that
may not exist for the invoking commit/branch — see Goals/Non-Goals), the
script scans `"$@"` for a `--image=` argument before invoking `gcloud run
deploy` and exits non-zero with actionable guidance if none is present. This
converts the silent-downgrade footgun into a fail-fast error, matches how
HEL-749's cutover already used the script in practice, and needs no new
flag-parsing mechanism — `"$@"` is still forwarded verbatim to `gcloud run
deploy` exactly as before, just now with the image guaranteed to be present in
it before that call is reached. Alternative considered: default to querying
the currently-live revision's image via `gcloud run services describe` and use
that as an implicit default. Rejected — that would make the script deploy
"the same image again" by default, silently masking the far more common
mistake of forgetting to pass an intended *new* image, which is precisely the
failure mode this ticket exists to close.

**D2 — Guard detection: substring match on `--image=` across all of `"$@"`,
not full flag parsing.** `grep -q -- '--image='` over the joined arguments is
sufficient: `gcloud run deploy` itself already validates the flag's value, and
this script does no other flag introspection today. A stricter parser (e.g.
requiring `--image=` as its own whole argument, rejecting `--image` with a
separate value) is unnecessary complexity for a single guard check, since
`gcloud`'s own error messages already cover malformed invocations once past
this guard.

**D3 — Documentation records the script's bootstrap/manual role explicitly.**
`infra/README.md`'s "Run the deploy" section is updated to state that this
script requires an explicit `--image=` flag, is not the automated deploy path
(`cd-backend.yml` is), and to give both ways to find the correct tag: the
currently-live tag (`gcloud run services describe ... --format='value(...)'`)
and a CI-built tag for a specific commit (the matching `cd-backend.yml` run's
"Build and push image" step, tag convention `<branch>-<8-char-sha>`).

## Risks / Trade-offs

- [Risk] Existing operator muscle-memory (`bash infra/deploy-backend.sh` with
  no flags) now fails where it previously "worked" (by deploying `:v3`).
  → Mitigation: this is the intended fix — the old "success" was actually a
  silent downgrade. The new failure is loud, immediate, and carries the fix
  (the two `gcloud`/CI lookup commands) directly in its own error output, not
  only in README.md.
- [Risk] The guard is a substring check, so a malformed argument that merely
  *contains* the literal text `--image=` (e.g. inside an unrelated
  `--set-env-vars` value) would false-positive past the guard.
  → Mitigation: accepted per D2 — no such value exists in this script's
  current fixed flags, and a genuinely malformed `--image=` still fails at
  `gcloud run deploy` itself, just one step later than the guard.

## Migration Plan

No runtime migration — this only changes a local operator script's CLI
contract. No deploy is required to "roll this out"; the next person to run
`deploy-backend.sh` simply needs to pass `--image=`. Rollback is a plain
`git revert` of this change if the guard turns out to be unwanted.

## Planner Notes

Self-approved: implementing the ticket's suggested option (b) (guard + docs)
over option (a) (compute/build a fresh tag) — the ticket explicitly offered
both as acceptable, and (b) is the smaller, lower-risk change that directly
closes the silent-downgrade footgun without duplicating `cd-backend.yml`'s
build+push responsibility. Not escalated: this is exactly the kind of
self-approvable technical choice within a materially-below-threshold ticket
(single script + one README section), not a new external dependency,
architectural change, or breaking API change.
