## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 6e4963c6d290c7e7cdb746eed26679703ece926f (base 11f448fa, resolved live)

### What I verified (with evidence)
- **No `<if>` in the appender path.** I read logback.xml at HEAD. Both appenders are declared unconditionally. `<define name="LOG_APPENDER" class="com.helio.logging.LogFormatPropertyDefiner"/>` comes before `<root><appender-ref ref="${LOG_APPENDER}"/>`. There is no `<if>`, `<condition>` or Janino anywhere.
- **Definer handles an unset variable.** `sys.env.get("LOG_FORMAT").map(_.trim).filter(_.equalsIgnoreCase("json"))` turns a missing variable into None, which gives "plain". It cannot throw, and it only ever returns "json" or "plain".
- **Real Docker runs.** I built the real Dockerfile (image `hel1128-skeptic2`) and ran it against a throwaway postgres:16:
  - `LOG_FORMAT=JSON`: 195 lines, 165 with `"severity"`. The Flyway "Database:" and "Schema history" lines and "Helio backend listening on" all appear as JSON.
  - `LOG_FORMAT=garbage`: 86 lines, 0 JSON. Plain-text Flyway "Successfully validated 106 migrations" and "listening on" lines appear.
  - Unset: same as garbage, plain text with Flyway and startup lines.
  - No "could not be found" or "No appenders" in any run.
- **sbt test (my own run):** 4246 succeeded, 0 failed, 277 suites.
- **`openspec validate fix-prod-log-cloud-logging --type change`:** "is valid".
- **C1 (no migrations):** the diff contains no migration files.
- **C2 (no deploy action):** the only infra change is adding `LOG_FORMAT=json` to the cd-backend.yml flags. That is a source edit that matches the live service value, not a deploy.
- **Archive dry run (scratch copy of openspec/, not the worktree):** `openspec archive fix-prod-log-cloud-logging --yes` gave `structured-json-logging MODIFIED failed for header "### Requirement: Appender selection uses no conditional-processing construct" - not found` and `Aborted.` Reproduced from ground truth.

### Verdict: REFUTE

The code fix is correct and proven at runtime. The spec delta written for round 1's CR3 is defective, and it will break the delivery archive step.

### Change Requests
1. `openspec/changes/fix-prod-log-cloud-logging/specs/structured-json-logging/spec.md`: the requirement "Appender selection uses no conditional-processing construct" is under `## MODIFIED Requirements`, but no requirement by that name exists in `openspec/specs/structured-json-logging/spec.md`. `openspec archive` aborts. Move it under `## ADDED Requirements`, keep the REMOVED section, and confirm with a real `openspec archive` dry run in a scratch copy. `validate` does not catch this.
2. Same file, scenario "Unrecognized value falls back to plain text, not silence": the WHEN clause lists `JSON` and `Json` as values that fall back to plain. That contradicts the "Case-insensitive JSON selection" scenario and the code. Remove those examples. For instance: "a value that is not `json` under case-insensitive comparison, e.g. `garbage` or `text`".
3. Optional, same delta: the base "Log output format is selectable via LOG_FORMAT env var" requirement still says "a value other than `json`" without stating case-insensitivity. Consider a MODIFIED entry for it, using its exact existing header, that says so.

### Non-blocking notes
- `docs/verify-backend-logging.sh` covers `json` and `garbage` but not uppercase `JSON`. My manual run covered it; adding a case would be cheap.
