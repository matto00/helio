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
