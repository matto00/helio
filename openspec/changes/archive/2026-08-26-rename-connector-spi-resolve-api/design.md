## Context

See proposal.md - Why. `Connector[Config]` (`backend/src/main/scala/com/helio/domain/connectors/Connector.scala`)
is the SPI trait; `ConnectorRegistry`/`ConnectorMetadata`/`ConnectorFieldDescriptor` describe connector
*kinds* and are unaffected by the trait rename. `GET /api/connectors` and MCP `list_connectors`
currently serve the registry (kind metadata), not any per-user entity — there is no `Connector` table
or entity yet.

## Goals / Non-Goals

**Goals:**
- Free the name `Connector` for the future user-facing entity (HEL-826+).
- Move the registry endpoint/tool off the name a caller would now expect to mean "my saved
  connectors."
- Zero behavior change: same method signatures, same response shapes, same registry contents.

**Non-Goals:**
- Building the new `Connector` entity itself (later epic tickets).
- Any deprecation/versioning path for `/api/connectors` — the resolved decision (see below) is to
  take the break now with no aliasing window.
- Fixing HEL-804's existing stale-FQN drift in `openspec/specs/` — the nine capabilities touched here
  (`connector-spi`, `connector-registry`, `fetch-error-envelope`, `schema-inference-facade`,
  `connection-test-endpoint`, `pipeline-run-execution`, `rest-api-connector`,
  `assistant-conversation-loop`, `connector-secret-redaction`) are exactly the set whose requirements
  name `Connector[Config]`/`SqlConnector`/`RestApiConnector`/`Connector.testConnection`/
  `Connector.scala` (file-name form)/`/api/connectors`/`list_connectors` by name, re-derived via
  `grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.testConnection\b|\bConnector\.scala\b|/api/connectors\b|\blist_connectors\b' openspec/specs/`
  (the fully widened pattern — round-3 and round-4 design-gate findings: two successively narrower
  patterns each undercounted this set by one, first omitting the `Connector.testConnection` form and
  missing `assistant-conversation-loop:167`, then omitting the `Connector.scala` file-name form and
  missing `connector-secret-redaction:109` — a requirement titled "Connector.scala documents the
  redaction contract" that would otherwise name a file this change deletes). Any *other* stale FQN
  drift (package-path references from the prior backend repackage) is HEL-804's separate scope, not
  reopened here.

## Decisions

**1. Trait name: `ConnectorDriver[Config]`.** Escalated to the human (naming is expensive to reverse
once six sibling tickets build on it); resolved 2026-08-26. Chosen over `ConnectorKind` (collides with
the existing plain-string `kind` discriminator already used throughout `ConnectorRegistry`/
`ConnectorMetadata`), `SourceDriver` (collides with the distinct `Source`/`SourceService` domain
concept — sources are built *from* a connector kind, not identical to one), and `ConnectorBehavior`
(awkward at the type-parameter call site). Implementations: `SqlConnector` -> `SqlConnectorDriver`,
`RestApiConnector` -> `RestApiConnectorDriver`.

**2. `/api/connectors` -> `/api/connector-types`; `list_connectors` -> `list_connector_types`, no
deprecation window.** Escalated and resolved alongside decision 1. The complete first-party consumer
set (backend routes/protocols/tests, `helio-mcp`, frontend) is updated atomically in this same PR —
there is no external caller with an SLA to protect, so a deprecation/alias window (option (c) from the
ticket) would add real complexity for zero benefit. Doing the move now, before any sibling ticket
builds a real `/api/connectors` entity endpoint, avoids two different `/api/connectors` response
shapes ever coexisting on the wire.

**3. `ConnectorRegistry`/`ConnectorMetadata`/`ConnectorFieldDescriptor`/`ConnectorRoutes`/
`ConnectorProtocol`/`ConnectorMetadataResponse` are NOT renamed.** These name the *kind metadata*
concept and its HTTP shell — unambiguous even once `Connector` means the entity ("registry of
connector kinds", "the connector-types route" both read fine next to "a Connector"). Renaming them
would be scope creep beyond what the ticket asks and beyond what's needed to free the `Connector`
name. (`ConnectorRoutes`/`ConnectorProtocol` keep their names even though the route path they serve
moves to `/api/connector-types` — the Scala type names and the wire path are independent; nothing
requires them to match.)

**3a. `helioApi.ts`'s `listConnectors()` client method and `connectorService.ts`'s `listConnectors`
export keep their names too**, even though the wire path/tool move. They're client-internal (never
observed by an agent or the frontend beyond this one file each), and leaving them named `listConnectors`
deliberately keeps that identifier free for a future entity-list client method once HEL-826+ lands —
consistent with decision 3's "the metadata concept keeps its name" reasoning, just at the client-code
layer instead of the wire layer.

**4. Capability spec paths (`openspec/specs/connector-spi/`, `openspec/specs/connector-registry/`) are
NOT renamed**, per the openspec instructions' "do not move or rename the capability" rule for modified
capabilities — only the requirement text inside changes to reflect the new trait/route/tool names.

**5. Prose reference sweep for `list_connectors` (caveat a from the human).** Tool discovery is
dynamic, so this is not a functional requirement, but any committed prompt/skill/doc/script in this
repo that names `list_connectors` in prose is checked and updated during Execution, to avoid a second
instance of the HEL-804 drift pattern (a rename landing in code but not in prose that references it).

**5a. Requirement-header renames use `## RENAMED Requirements`; scenario titles are never renamed
(round-2 design-gate finding).** `openspec archive`'s apply logic treats a `## MODIFIED Requirements`
block whose `### Requirement:` header doesn't match the canonical spec as a hard error, and rejects a
`MODIFIED` block that omits any scenario title the canonical requirement still has — `openspec
validate` does not catch either failure mode, only a real archive rehearsal does (see tasks.md 4.1).
Resolution: the 7 requirement headers that changed wording (1 in `fetch-error-envelope`, 3 in
`connector-spi`, 2 in `connector-registry`, 1 in `connector-secret-redaction`) each get an explicit
`## RENAMED Requirements` FROM/TO entry ahead of `## MODIFIED Requirements`, per the tool's supported
syntax. Scenario titles are never renamed anywhere across all 9 delta files — only scenario body text
(WHEN/THEN) is renamed — since `RENAMED` only applies to requirement headers, not scenarios, and
there is no other archive-safe way to change a scenario's title without a REMOVED+ADDED pair
(rejected here as needless churn for a name-only change). This makes the two capabilities that were
already scenario-title-stable (`fetch-error-envelope`, `schema-inference-facade`) the pattern for
all 9, not an exception to it. `assistant-conversation-loop`'s one requirement title is unchanged
(only its body text renames `Connector.testConnection`), so it needs no `RENAMED` entry; the same is
true for `connector-secret-redaction`'s scenario, whose title carries no old name. The 7-pair total
reflects both `assistant-conversation-loop` and `connector-secret-redaction` being added to the set
(the latter contributing one new pair, the former none).

**6. `## Purpose` paragraphs for five of the nine capabilities are edited directly, not via a
MODIFIED-requirements delta.** `## Purpose` text lives outside `## Requirements` entirely, so a
`## MODIFIED Requirements` delta cannot reach it — confirmed against the tool's own apply logic (see
tasks.md 4.1's archive rehearsal). Five capabilities' canonical `## Purpose` paragraphs name an
old identifier and need this direct edit: `connector-spi` (`Connector[Config]`/`SqlConnector`/
`RestApiConnector`), `connector-registry` (`GET /api/connectors`/`list_connectors`),
`fetch-error-envelope` (`Connector[Config]`), `schema-inference-facade` (`Connector[Config]`), and
`connection-test-endpoint` (`Connector.testConnection` — missed in an earlier pass that used the
narrower, pre-widened grep pattern; see the Non-Goals note above). `pipeline-run-execution`,
`rest-api-connector`, `assistant-conversation-loop`, and `connector-secret-redaction` have no
old-name text in their Purpose paragraphs (`connector-secret-redaction`'s Purpose names only
`SecretField`/`HasSecrets`/`SecretRedaction`/`SecretBackend`, none of which are renamed by this
change) and need no edit. All five are edited directly in the canonical `openspec/specs/` files at
archive time (task 4.3), the same "edit the canonical file directly" mechanism openspec's own tooling
docs specify for Purpose changes on an existing capability.

## Gate-Chain Implications Checklist

This change does not touch `.husky/**` or any script a pre-commit hook invokes — it is a Scala/
TypeScript rename plus route/tool-name move confined to `backend/src`, `frontend/src`,
`helio-mcp/src`, `helio-mcp/scripts/verify.ts` (a standalone verification script, not a git hook), and
`openspec/specs/**`. No gate-chain script is added, removed, or modified.
- **What does it execute?** N/A — no gate-chain script touched.
- **What environment does it inherit, and from where?** N/A.
- **Does it write anything outside its own sandbox?** N/A.
- **Does it behave differently from a linked worktree than from a main checkout?** N/A.
- **What happens on its first run?** N/A.

## Risks / Trade-offs

- [Risk] Missing a reference during the trait rename leaves a stray `Connector[Config]`/`SqlConnector`/
  `RestApiConnector`/`Connector.testConnection`/`Connector.scala` (file-name form) name that either
  fails to compile (safe — caught immediately) or, worse, compiles because it's a doc comment or
  string literal (silent drift) — this happened five times during this change's own design gate
  (rounds 1-5 each found one more reference-shape the prior pattern missed: file-count undercounts,
  five then a sixth missing openspec/specs capability, and finally two backend doc-comment files
  naming the bare `Connector.scala` filename). → Mitigation: bidirectional grep sweep during Execution
  using the FULLY WIDENED pattern
  (`Connector\[`, `SqlConnector\b`, `RestApiConnector\b`, `Connector\.testConnection\b`,
  `Connector\.scala\b`, `/api/connectors`, `list_connectors`) — this exact pattern, quoted
  identically, is what tasks.md 1.5/2.1/4.1/5.3 all use — both before and after the rename, plus full
  backend/frontend build + test suite. Given the design gate's own five-round history of finding one
  more reference shape each round, do not assume this pattern is exhaustive without re-running it
  against the FINAL diff right before commit (tasks.md 5.3 is exactly that final check).
- [Risk] A stale local `helio-mcp` `dist` 404s against the renamed route post-merge (caveat b from the
  human). → Mitigation: called out explicitly in the PR body and the Linear closing comment (not fixable
  in-repo — it's a local-build staleness issue for whoever runs `helio-mcp`).
- [Risk] Test *logic* accidentally changes while renaming test fixtures/specs (acceptance criterion
  requires names-only changes). → Mitigation: evaluator's code-review phase diffs test files
  specifically for logic changes, not just name changes.

## Migration Plan

Single PR, no phased rollout: rename lands atomically across backend, frontend, `helio-mcp`, and
`openspec/specs/` in one merge. No data migration (no schema/table changes — this is code-only). No
runtime feature flag needed since there is no external consumer outside this repo's own three
packages, all updated together.
