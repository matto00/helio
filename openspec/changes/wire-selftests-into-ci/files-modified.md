- `scripts/check-no-credential-in-agent-surface.selftest.mjs` — added the HEL-996 test-only
  `HEL996_FORCE_SKIP_SELFTEST` forced-skip hook (add-only, doubles as the recursion guard);
  rewired the terminal `skippedCases.length > 0` branch to key off the accumulated list instead
  of `isRoot` and to hard-fail (`process.exit(1)`) when `process.env.CI` is set, dropping the
  hardcoded "running as euid 0" wording; added two new self-test cases (forced skip + `CI` set
  -> non-zero exit naming the skip and the fatal-message token; forced skip + `CI` cleared ->
  exit 0, still names the skip) placed at the end of the `try` block after every other case's
  cleanup.
- `.github/workflows/ci.yml` — added `- run: npm run check:openspec:selftest` to the `frontend`
  job alongside the existing self-test steps, with an explanatory HEL-996 comment in the
  established HEL-913/HEL-846 house style.
