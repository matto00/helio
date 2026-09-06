- `scripts/check-no-credential-in-agent-surface.selftest.mjs` — added the HEL-996 test-only
  `HEL996_FORCE_SKIP_SELFTEST` forced-skip hook (add-only, doubles as the recursion guard);
  rewired the terminal `skippedCases.length > 0` branch to key off the accumulated list instead
  of `isRoot` and to hard-fail (`process.exit(1)`) when `process.env.CI` is set, dropping the
  hardcoded "running as euid 0" wording; added two new self-test cases (forced skip + `CI` set
  -> non-zero exit naming the skip and the fatal-message token; forced skip + `CI` cleared ->
  exit 0, still names the skip) placed at the end of the `try` block after every other case's
  cleanup.
- `scripts/check-openspec-version.mjs` — added a `--print-expected` flag (delivery-time
  amendment, design.md Decision 6) that prints the `EXPECTED` constant to stdout only, one line,
  no banner, and exits 0; default no-argument behaviour is untouched. Single-sources the version
  `.github/workflows/ci.yml`'s install step installs.
- `.github/workflows/ci.yml` — added an "Install openspec CLI" step (failable
  `V="$(... --print-expected)"` assignment, non-empty check, then `npm i -g
  "@fission-ai/openspec@$V"`), followed by `npm run check:openspec-version` as the runtime
  assertion, then wired both `npm run check:openspec` (the gate) and `npm run
  check:openspec:selftest` into the `frontend` job, with a comment recording why these were
  pre-commit-only (the CLI's absence from the runner, not an oversight) and pointing at
  `check-openspec-version.mjs`'s header for the deferred devDependency fix.
