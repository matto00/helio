- `backend/project/DevEnv.scala` — new sbt-free object: parseDotEnv, fixed testEnv, runEnv (never-forward + shell precedence), testEnvMismatch (key names only)
- `backend/build.sbt` — Test/envVars = DevEnv.testEnv; Compile/run/envVars uncached DevEnv.runEnv; loadDotEnv removed; D4b wiring guard in testGrouping; envVarKeys task; DevEnv.scala added to Test sources
- `backend/src/test/scala/DevEnvSpec.scala` — key-name/SHA-256-only spec of the env semantics
- `backend/src/test/resources/devenv/fixture.env` — dummy-value fixture
- `backend/.env.example` — header comment on who reads .env
- `MISTAKES.md` — Tooling entry: never print .env / env maps

Evidence (key names only):
- RED spec (today's semantics): "test env leaks keys: ANTHROPIC_API_KEY, DATABASE_URL, DB_PASSWORD, GCLOUD_DB_PASSWORD, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, HELIO_OWNER_EMAILS"; 6 of 7 failed; connector hash equals .env hash.
- RED wiring guard (before rewire, real backend/.env): unexpected keys ANTHROPIC_API_KEY, DATABASE_URL, GCLOUD_DB_PASSWORD, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, HELIO_OWNER_EMAILS; differing: connector key + id.
- GREEN: DevEnvSpec 7/7; guard passes after rewire.
- MUTATION RED: Test/envVars temporarily += parsed .env -> guard failed naming the same keys; reverted.
- envVarKeys twice in one session: test = the two connector keys; run = 8 keys, GCLOUD_DB_PASSWORD absent.
- testFull: 6507 succeeded, 0 failed, 4 canceled, exit 0.
