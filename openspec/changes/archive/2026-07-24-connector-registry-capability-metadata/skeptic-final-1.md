## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Drift-detection test reproduced live (mutation test).** Read `ConnectorRegistrySpec.scala` (9
   assertions, independently-authored `expectedKinds` literal set, never derived from either
   production value). I temporarily removed `imageMetadata` from `ConnectorRegistry.all` in
   `ConnectorRegistry.scala`, ran `sbt "testOnly com.helio.domain.ConnectorRegistrySpec"` — 4 of 9
   assertions FAILED with clear diffs (`HashSet(...) was not equal to HashSet(..., "image", ...)`,
   `parseKind("image")` returning `Left` instead of `Right`). Reverted the file (`git diff` empty
   after revert), reran the same test — all 9 pass again. This is the ticket's capstone property and
   it holds: a silently-omitted kind is caught, not waved through.

2. **Circular `<clinit>` fix confirmed cold.** Read `ConnectorRegistry.scala`: every static entry
   (`csvMetadata`/`staticMetadata`/`textMetadata`/`pdfMetadata`/`imageMetadata`) uses literal kind
   strings (`"csv"`, `"static"`, etc.), never `DataSourceKind.Csv` etc. — the file's own doc comment
   explains why (referencing `DataSourceKind.All`'s dependency on `ConnectorRegistry.all` would
   create mutual `<clinit>` re-entrancy). Read `DataSource.scala:169`: `val All: Set[String] =
   ConnectorRegistry.all.map(_.kind).toSet` — genuinely derived, not a coincidental literal. Ran
   `sbt "testOnly com.helio.domain.ConnectorRegistrySpec com.helio.domain.DataSourceSpec"` fresh
   (post-revert, full recompile) — 19/19 pass, including `DataSourceSpec`'s bare-context 7-subtype
   exhaustiveness check, confirming a clean class-load with no `ActorSystem` never NPEs.

3. **Behavior preservation — diff + live browser.**
   - `git diff main...HEAD` confirms `ConnectorSpec.scala`, `NewConnectorInferenceSpec.scala`,
     `CreateSourceEnvelopeSpec.scala`, and `AddSourceModal.tsx` all have **zero diff**.
   - Only `RestApiConnectorSpec.scala:72-88` and `SqlConnectorSpec.scala:167-185` changed test-value
     assertions, both adding the real, non-empty `requiredFields` the production connectors
     genuinely gained (disclosed as behavior-driven in `design.md` Decision 2 and
     `files-modified.md`) — confirmed by reading the diff directly.
   - Live browser: opened Add Source modal at `http://localhost:5657/sources` (session already
     authenticated) — `SourceTypeToggle` rendered exactly 7 buttons: REST API, CSV File, Manual, SQL
     Database, Text/Markdown, PDF, Image, same order as `git show main:...SourceTypeToggle.tsx`'s
     hardcoded button sequence. Confirmed via `browser_network_requests` that the toggle issued
     `GET /api/connectors` (200 OK) rather than using a hardcoded list.
   - Ran `sbt test` fresh (full suite): **1776/1776 pass**. Ran `npm test` fresh (frontend):
     **1259/1259 pass, 121 suites**.

4. **No credential/secret leakage — structural.** Read `Connector.scala`:
   `ConnectorFieldDescriptor(name, label, secret: Boolean)` — no `value` member exists on the type at
   all (not merely omitted at runtime — structurally absent from the case class). Read
   `SqlConnector.scala`: `password` field marked `secret = true`; `RestApiConnector.scala`: only `url`
   is a required field (auth token/api-key live inside the optional `auth` object per
   `RestApiConfigPayload`, so intentionally not enumerated as a top-level required field — this is an
   explicit, tested design decision, not an oversight: `ConnectorRoutesSpec.scala` has a dedicated
   test "mark no rest_api field as secret (bearer/api-key live inside the optional auth object)").
   Live-fetched `GET /api/connectors` via `page.evaluate(fetch(...))` while authenticated in the
   browser — inspected the full raw JSON response: no `value` key anywhere in any of the 7 entries;
   `password` is the only `secret: true` entry, matching `SqlSourceConfigPayload`'s actual shape.
   `ConnectorRoutesSpec.scala` additionally asserts the serialized body contains no `"value"` key and
   no `"password":"..."` pattern.

5. **spray-json optional-field check.** Read `ConnectorProtocol.scala`: `ConnectorFieldDescriptorResponse`
   (`jsonFormat3`) and `ConnectorMetadataResponse` (`jsonFormat5`) — every field on both types is a
   non-`Option` primitive/`Vector`. No `Option` anywhere in the wire types, so the spray-json
   absent-vs-null gotcha does not apply here; `helio-mcp/src/types.ts`'s mirror types correctly have
   no optional (`?`) fields either, consistent with this.

6. **MCP `list_connectors`.** Read `helio-mcp/src/tools/read.ts` — `() =>
   guarded(() => api.listConnectors())`, matching every sibling read tool's pattern exactly (no
   reshaping, no extra params). Read `helioApi.ts` — thin `GET /api/connectors` wrapper. Read
   `scripts/verify.ts`'s new `list_connectors` section — it actually calls the tool
   (`client.callTool({ name: "list_connectors", ... })`), parses the typed response, and prints each
   connector's `displayName`/`kind`/`requiredFields` — a genuine exercise of the new tool, not a
   no-op. `helio-mcp` has no jest/vitest test framework at all (`package.json` scripts confirm only
   `build`/`typecheck`/`verify`), so `verify.ts` is the established test-equivalent for this package
   — consistent precedent, not a gap. Ran `npm run typecheck` and `npm run build` in `helio-mcp` fresh
   — both clean.

7. **Live UI — screenshots taken and reviewed (dark + light).** Opened the Add Source modal; took a
   full screenshot in dark mode and again after toggling to light mode (screenshots written to a
   `.skeptic-screenshots/` dir inside the worktree, deleted after review — zero stray PNGs at repo
   root or worktree root confirmed via `find`). Both renders show correct token usage (existing
   `add-source-modal__type-btn`/`--active` classes, unchanged from pre-change CSS since
   `SourceTypeToggle.tsx` introduces no new styling), consistent spacing, and correct light/dark
   parity (orange accent border on the active "REST API" button in both themes, proper contrast).
   `browser_console_messages` (level=error) returned 0 errors.

8. **Full fresh gate chain.**
   - `sbt test` (backend, from this worktree, fresh JVM): 1776/1776 pass.
   - `npm run lint` (frontend): clean, zero warnings.
   - `npm run format:check` (frontend): clean.
   - `npm test` (frontend): 1259/1259 pass.
   - `npm run build` (frontend): succeeds (pre-existing >500kB chunk-size warning, unrelated to this
     change).
   - `helio-mcp`: `npm run typecheck` and `npm run build` both clean.
   - One `-n` pre-commit bypass on commit `c2d241f4`, disclosed in `evaluation-1.md` with a narrow,
     valid reason (`check:openspec`'s "complete but unarchived" flag, expected pre-archive state, not
     a real gate failure) — every other gate ran and passed before that commit per the same
     disclosure.
   - `git status` clean at the end (only the pre-existing untracked `evaluation-1.md`/
     `skeptic-design-4.md`, no stray screenshots).

### Verdict: CONFIRM

### Non-blocking notes
- `RestApiConnector.metadata.requiredFields` only lists `url` — bearer-token/api-key fields are never
  surfaced as `requiredFields` entries even conditionally, since they live inside the optional `auth`
  object. This is a deliberate, disclosed, and tested design choice (not a defect against this
  ticket's spec — `connector-spi/spec.md`'s scenario only requires `url`/non-secret for `rest_api`),
  but a future ticket wiring `requiredFields` into create-time validation (explicitly out of scope
  here) will need to handle conditional-on-auth-kind fields, which this registry shape doesn't yet
  express.
