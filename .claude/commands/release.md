---
description: Cut a release — create or fast-forward a release branch, tag it, and publish a GitHub Release with a generated changelog.
---

Cut a release for version `$ARGUMENTS` (a `major.minor`, e.g. `0.8`).

Run `scripts/release/cut-release.sh $ARGUMENTS` and show the user its full
output — the mode, target commit, and generated changelog — before it acts.

The script prompts for confirmation itself. Do not answer the prompt on the
user's behalf: pushing the tag triggers a production deploy.

If the changelog looks wrong, abort and investigate rather than editing notes
after the fact — a published Release's notes and its tag should agree.

## Never tag by hand

Do NOT run `git tag` / `git push origin <tag>` directly to cut a release, not
even for a hotfix, a diagnostic build, or "just one quick one" during an
incident. Pushing a tag deploys, so a hand-rolled tag _looks_ like it worked
while silently skipping the two bookkeeping steps the script performs:

1. fast-forwarding `release/vM.m` to the released commit, and
2. publishing the GitHub Release.

That is not hypothetical. Eight of the twelve `v0.7.*` tags have no GitHub
Release, and `release/v0.7` sat 17 commits behind its own newest tag —
production was running code the release branch had never heard of. Four of
those came from hand-tagging diagnostic builds during the v0.7.8–v0.7.11 RLS
deploy incident, when the tag felt like the unit of work and the bookkeeping
did not.

If a release needs hand-written prose — an incident fix, a diagnostic build, a
milestone — that is not a reason to bypass the script. Pass it in:

```bash
RELEASE_HEADLINE="v0.8.1 — loud startup failures

Backend startup exceptions now halt(1) with a stack trace instead of
exiting 0 silently." ./scripts/release/cut-release.sh 0.8
```

The headline is prepended above the generated changelog, so narrative and
commit list ship together in one tag and one Release.

## Check the bookkeeping

`scripts/release/audit-releases.sh [major.minor]` verifies that every `vM.m.p`
tag has a matching GitHub Release and that every `release/vM.m` branch sits at
its newest tag. It is read-only and exits non-zero on drift, so it is safe to
run any time and suitable as a gate.

Run it before cutting, and again afterwards to confirm the cut landed
completely. It deliberately ignores non-release tags (beta, rc, test, dated
ones) — those are not releases and must not be reported as missing one.

A successful deploy is not evidence that a release was cut correctly. The
audit is.
