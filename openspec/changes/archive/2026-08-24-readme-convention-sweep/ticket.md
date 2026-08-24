# HEL-637: Complete the package README convention across the repo

## Description

Runs last. This is the mechanism that carries the memo forward to future agents and humans: **every meaningful directory states what belongs in it and what does not.**

The earlier children each write READMEs for the directories they create. This ticket is the completeness sweep over the finished tree — not the primary source of those READMEs.

### Why READMEs, and why they must be verified

The repo already has a half-built version of this convention: `README.md` files in `backend/.../api/`, `app/`, and (historically) `security/`. **CORRECTED (2026-08-24, re-enumerated 2026-08-23 against 7cfb1e84):** the ticket's original inventory ("only three READMEs exist across the whole backend") is stale — HEL-633's repackage created ~50 new package dirs; the backend now has 76 package dirs, 67 with READMEs, 6 real gaps (`email`, `spark`, `ai`, `domain/panels`, `domain/shapes`, `domain/steps`). The motivating example — `security/README.md` describing a package with no code — is GONE: `com/helio/security` was removed by the epic and took its stale README with it. A sweep for READMEs referencing `com/helio/security`, `com.helio.security`, or `testutil` returns nothing.

**What survives the drift, and is the actual point of the ticket:** the convention, and one rule in particular:

**Every README must be verified against its directory's actual contents at the moment it is written or edited. List the directory, read the file names, then write the text. Never write a README describing what a directory is intended to hold.**

There is deliberately NO lint script backing this (considered and declined). Accuracy rests entirely on writing discipline.

### Format

Keep them short — four lines beats forty. Match the terse register of the existing `api/README.md`.

```markdown
# <Directory Name>

<One sentence: what this directory is for.>

**Belongs here:** <the kind of thing, not an exhaustive file list — lists rot>
**Does not belong here:** <the nearest neighbouring concern, and where it lives instead>
```

The "does not belong here" line does the real work. It is what stops the next file from landing in the wrong place, and it is what an agent scanning the tree actually needs.

## Scope (re-enumerated against the live tree, 7cfb1e84)

* Fill the 6 real backend package gaps: `email`, `spark`, `ai`, `domain/panels`, `domain/shapes`, `domain/steps` (excludes pure namespace dirs `scala/`, `com/`, `com/helio` — not real packages, out of scope).
* `frontend/src/features/*/` — one README per feature dir (14 dirs) explaining the `services`/`state`/`types`/`ui` slice convention. The existing `frontend/src/features/README.md` is an index, not a per-feature README — leave it, add the 14 per-feature ones.
* `frontend/src/shared/`, `hooks/`, `utils/`, `services/` — clarify what distinguishes each from its feature-local equivalent, resolved from how the code actually uses them (not from the names).
* Top-level: `scripts/`, `schemas/`, `e2e/`, `docs/` (one line each is enough). `infra/` already has one — no action.
* NEW SCOPE the ticket predates: HEL-636 (merged 7cfb1e84) created 14 domain subdirectories under `schemas/`. Decide deliberately whether each gets its own README or one `schemas/README.md` explains the grouping, and say why.
* Fix or delete any README that no longer matches its directory (verified: none currently reference removed paths, so no fix/delete action is expected here — confirm during execution).

## Constraints

* Documentation only. No code, no moves.
* Do not describe a directory the epic has not actually produced.

## Verification

* Enumerate every directory in scope and confirm each has a README — state the count in the PR.
* Spot-check: for five randomly chosen READMEs, list the directory and confirm every claim holds. Pick them randomly, not the five you are most confident in.
* Confirm no README references `com/helio/security`, `testutil`, or any other path the epic removed.
* This ticket's failure mode is confident, plausible, unverified prose — no automated gate in the repo can catch it. The skeptic will specifically sample READMEs and check claims against `ls` output.
