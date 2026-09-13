## Standing Constraints

- [C1] No database migration expected for this ticket; escalate to the driver if one turns out to be needed.
- [C2] Never deploy, change Cloud Run env/config, or cut a release as part of this delivery — the real-deploy AC verification is explicitly deferred to the driver after the next release cut.

## 1. Backend — Reproduce locally (real Dockerfile + real DB)

- [x] 1.1 Start a disposable local Postgres (e.g. `docker run --rm -e POSTGRES_PASSWORD=... postgres:16`) and `docker build` the real prod `Dockerfile`; verify the image builds and the Postgres container accepts connections
- [x] 1.2 Run the built image against the throwaway Postgres with the full required env set (`DATABASE_URL`, `DB_USER`, `DB_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `COOKIE_SECURE=true`, `CORS_ALLOWED_ORIGINS` — matching prod's actual value shape — or explicitly confirm and note that omitting it doesn't change startup behavior) and `LOG_FORMAT=json`; capture full stdout+stderr and record whether a startup line ("CORS allowed origins", "Session cookie config", "Helio backend listening on") and a Flyway line ("Successfully applied"/"Schema is up to date") appear, and in what format
- [x] 1.3 Re-run the same image with `LOG_FORMAT` unset; capture stdout+stderr and record the same observations, so both branches of the `<if>` are exercised and compared neutrally against prod's actual 13-lines-then-silence signature (transcribed in design.md's Context section)
- [x] 1.4 Inspect the built fat jar's **content**, not just filenames (a plain `jar tf` proves nothing here — `build.sbt`'s merge strategy concatenates all `META-INF/services/*` files into one and takes "first" for `logback.xml`, so duplicates never show up as duplicate *entries*): (a) `unzip -p helio-backend.jar META-INF/services/org.slf4j.spi.SLF4JServiceProvider` and print every line — more than one line is a real conflict; (b) `unzip -p helio-backend.jar logback.xml | diff - backend/src/main/resources/logback.xml` — any difference means a dependency's config won the "first" merge instead of ours; (c) list any other `logback*.xml`/`log4j2.*` files present anywhere in the jar; (d) list any SLF4J bridge (`slf4j-log4j12`, `log4j-over-slf4j`, `jul-to-slf4j`) or no-op-logger classes present in the jar that could compete for the binding
- [x] 1.5 Re-run the image (both LOG_FORMAT branches) with `-Dslf4j.internal.verbosity=DEBUG -Dlogback.debug=true` added to the JVM invocation; capture which concrete SLF4J backend bound and which config file logback's Joran configurator reports loading, and check whether debug-level status output surfaces any WARN/ERROR beyond the two already-known `<if condition>` deprecation warnings
- [x] 1.6 Probe-confirm the specific root cause behind whichever run(s) in 1.2/1.3/1.4/1.5 reproduce the "no app/Flyway logger output" symptom, per `.concertino/laws/systematic-debugging` — do not proceed to section 2 without a cited, reproducible finding (e.g. a specific misconfigured merge strategy, a specific SLF4J binding conflict, a specific Pekko logging-adapter timing gap)

## 2. Backend — Fix

- [x] 2.1 Fix the root cause identified in 1.6 in whichever of `logback.xml`, `build.sbt` (assembly merge strategy), or `application.conf` the evidence supports
- [x] 2.2 Add `LOG_FORMAT=json` explicitly to `.github/workflows/cd-backend.yml`'s `deploy-cloudrun` `--update-env-vars` flag list as hardening (independent of 2.1 — see design.md Decisions), preserving existing inline comments and additive-merge semantics
- [x] 2.3 Re-run the docker-image reproduction from section 1 against the fixed config (real Dockerfile + real throwaway Postgres, `LOG_FORMAT=json`) and verify stdout now contains a startup line and a Flyway line as single-line JSON with `severity` and `message` fields present

## 3. Tests

- [x] 3.1 Before writing the fix, run the intended test/check against the UNFIXED code/config and record its failing output (proves it can actually fail, per the red-before-green law); after 2.1's fix, re-run it and record the passing output. If the confirmed root cause (1.6) lives in the jar/packaging layer rather than pure Scala source, the check must run the actual built jar or Docker image and assert a named app log line reaches stdout — a config-file-text assertion alone is not sufficient proof for that class of cause. Prefer a `backend` ScalaTest when the cause is expressible in-process; otherwise add a documented, repeatable script under `docs/` that does the jar/image-level check
- [x] 3.2 Run `sbt test` and confirm the full backend suite is green
