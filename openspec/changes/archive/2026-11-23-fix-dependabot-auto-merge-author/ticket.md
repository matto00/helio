# HEL-1825: dependabot-auto-merge.yml never merges: author check expects dependabot[bot] but gh reports app/dependabot

## Description

`.github/workflows/dependabot-auto-merge.yml` aborts on every run, so Dependabot PRs sit open until someone merges them by hand. HEL-1820 found five such PRs (#1221-1225). The workflow's author check expects `dependabot[bot]`, but `gh` reports the author as `app/dependabot`. See run 44990891169.

## Do

* Read the workflow end to end: what it checks, what it merges, and with what merge command and flags.
* Fix the author check using the identity GitHub actually provides (for example `github.actor` or the PR's `user.login` in the event payload, rather than `gh`'s display form).
* Re-check the merge policy against the repo's rules before re-enabling anything:
  * helio requires a green `ci-complete` before merge;
  * its own agents never use `gh pr merge --auto` (MISTAKES.md, memory);
  * releases deploy on tags only.
  If the workflow uses `--auto`, or merges without waiting for required checks, ask the owner whether it should merge at all, or only label and approve.

## Acceptance criteria

- [ ] On a test Dependabot PR (or with a dry-run event), the author check passes, and the workflow does exactly what the owner approved.
- [ ] The PR states the merge policy the workflow now applies.

## Driver constraints (binding)

- No live Dependabot PR may be created or merged by the lane. Prove with a dry run: actionlint plus a script-level test of the extracted resolve logic against recorded payloads (`act` is not installed). If a real trigger is needed, say so in the PR.
- CI config only; no migration. No live model call.
