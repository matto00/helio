## Context

See proposal.md (Why). HEL-1331 added `historyPayloadsAvailable` to Output responses by stamping already-built
`OutputResponse`s in `OutputRoutes.withAvailability`, using an optional `(NodePayloadHistoryRepository,
PayloadHistoryConfig)` pair wired from `ApiRoutes` (config built once by `PayloadHistoryConfig.fromEnv()` in `Main`).
The frontend's `HistoryPayloadsField` holds the figures as a string constant. The app uses `<BrowserRouter>`, so
react-router's `useBlocker` is unavailable; the owner ruled for new-tab over a dirty-state prompt.

## Goals / Non-Goals

**Goals:** figures in the editor and MCP description can never disagree with what the server enforces; the upsell
link never destroys editor state; note typography matches DESIGN.md.

**Non-Goals:** no unsaved-changes tracking or prompt; no new endpoint; no router migration; item 4 (owner's-tier
upsell for a beta viewer) is unchanged; no changes to `compareOptions.ts`.

## Decisions

1. **Field shape: `historyPayloadLimits: {maxRows, maxBytes, tiers: {free, beta, owner: {maxRuns, maxAgeDays}}}`.**
   Mirrors `PayloadHistoryConfig` 1:1 (age is day-granular in `fromEnv`, so `maxAge.toDays` is lossless for any
   env-configured value). All three tiers are served, not just beta/owner, so an MCP agent can reason about free too.
   Alternative (pre-formatted strings) rejected: formatting is presentation and would bake English into the API.
2. **Stamped where availability is stamped.** `withAvailability` already runs on every response carrying
   `historyPayloadsAvailable`; it sets `historyPayloadLimits = Some(HistoryPayloadLimitsResponse.from(config))` from the
   same `config` in the `payloadAvailability` pair. One instance is built per request (or once per routes instance) and
   shared; it is instance-wide config, so no DB lookup. Bare fixtures without the pair omit both fields, as today.
   Alternative (separate endpoint) was the non-chosen owner option.
3. **`OutputResponse` gains `historyPayloadLimits: Option[HistoryPayloadLimitsResponse] = None`** (jsonFormat14), with
   nested case classes and formats in `OutputProtocol`. spray-json omits `None`. The schema
   (`additionalProperties: false`) gains the object with `readOnly: true` and `additionalProperties: false` at each level.
   A client-sent `historyPayloadLimits` inside `config` is ordinary config JSON and cannot affect the top-level field.
4. **Frontend formatting lives in a small pure helper** (e.g. `formatHistoryPayloadLimits.ts` beside the field) that
   turns the object into the help sentence: rows via `toLocaleString("en-US")`; bytes in the largest whole binary unit
   (`MiB`, `KiB`, else `bytes`); `run`/`runs`, `day`/`days`; a tier with `maxRuns <= 0 || maxAgeDays <= 0` reads
   "keeps no rows". Absent limits → help text without figures: "Stores the full rows of every run from the next run on,
   so History can show what changed. Very large runs keep only their summary; how many runs are kept depends on the
   pipeline owner's plan." The constant is deleted. `OutputEditorSheet` passes `output.historyPayloadLimits` through.
5. **New-tab link.** Keep react-router `<Link>` with `target="_blank" rel="noopener noreferrer"` (router `Link` honours
   `target` by letting the browser handle the click). Accessible cue: visually-hidden " (opens in a new tab)" text
   inside the link, using the project's existing visually-hidden utility if DESIGN.md/shared CSS has one (executor
   verifies; otherwise `aria-label="Request Beta access (opens in a new tab)"`). The new tab loads `/settings#beta-access`
   cold; `useScrollToHashSection` (HEL-1331) must scroll on initial mount — verified by e2e, not assumed.
6. **Note styling.** The note `<p>` switches from `__type-hint` (`--text-sm`) to `__field-hint` (`--text-xs`, muted),
   the same class as the help text. The link keeps `__upsell-link` (accent text, semibold, underline), which inherits
   font size.
7. **MCP.** `HISTORY_PAYLOADS_CONFIG_DOC` drops the literal numbers and tier retention, saying instead the caps and
   per-tier retention are reported by the Output's read-only `historyPayloadLimits` (free keeps none by default).
   `types.ts` adds the interface. Tool results already pass the backend JSON through; executor verifies with a test.

## Risks / Trade-offs

- [Field repeated on every list item] → a fixed ~150-byte object; acceptable, and avoids a second fetch in the editor.
- [Cold new tab may not scroll to the hash if the section renders after an async load] → e2e asserts the heading is in
  view in the new tab; if it fails, fix the hook, do not weaken the assertion.
- [Bytes not a whole unit, e.g. 1500000] → falls back to a smaller unit or raw bytes with grouping; unit-tested.
- [Main e2e currently red on hel1350/hel1351 (HEL-1373)] → driver rule: if only those fail in CI, escalate and stop.

## Migration Plan

None: additive optional response field; older frontends ignore it, newer frontend tolerates its absence. Rollback is a
revert.
