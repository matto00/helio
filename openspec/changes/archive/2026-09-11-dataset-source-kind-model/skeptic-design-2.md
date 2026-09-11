## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Worktree base:** HEAD is `730b42d8` (HEL-1074 merged). The change dir is untracked, which is expected at the design gate.
- **Round-1 CR1 and CR2 (backend entry points), re-verified with `grep -rn 'DataSourceKind\.Static\|"static"\|StaticSource' backend/src/main/scala`:**
  - Every citation in Decision 2 and task 3.3 matches the live tree:
    - `PipelineService.scala:759` and `:1588`
    - `PipelineProposalProtocol.scala:198`
    - `PipelineProposalService.scala:195`, `:330`, `:374`, `:384` and `:557`
    - `PatchSetApplyResolvers.scala:425` and `:428`
    - `AssistantProposalToolSchemas.scala:118`
  - `parseKind` has exactly two callers: `ConnectorCompletionService:51` and `ConnectorEntityService:75`.
  - The repository path is now correct (`infrastructure/persistence/sources/`).
  - The `canonicalize` design is sound, and task 3.5's grep backstop is there.
  - RESOLVED.
- **CR3 (alias round-trip tests on the non-data-sources write paths):** covered by Decision 5 and task 4.3, including a backward-compatibility test for proposals and patch sets already stored with `"static"`. RESOLVED.
- **CR4 (the Manual tab):** Decision 4 and task 5.3 now require the switch. The cited lines match: `AddSourceModal.tsx:41`, `:324` and `:379`, and `SourceTypeToggle.tsx:20` and `:43`. The e2e acceptance signal is named. RESOLVED.
- **CR5 (the frontend and MCP consumer inventory):** checked against `grep -rn "['\"]static['\"]" frontend/src helio-mcp/src` on non-test files. Every hit is covered by task 5.1–5.4:
  - `dataSource.ts:10`, `:86`, `:143` and `:166`
  - `labelForKind.ts:16`
  - `SourceListTable.tsx:48`
  - `SourceDetailPanel.tsx:30` and `:138`
  - `dataSourceService.ts:113`
  - both proposal review pages
  - `helio-mcp` `types.ts`, `helioApi.ts`, `pipelinesHandlers.ts`, and both zod enums

  RESOLVED.
- **CR6 (spec deltas):** `frontend-data-sources-page` and `pipeline-proposal-analyze-api` deltas were added, and they are consistent with the design. RESOLVED.
- **Newly found — contract specs this change contradicts but has no delta for.** I ran `grep -rn static openspec/specs/*/spec.md` across every spec, not just the four that already have deltas. Two binding requirements enumerate the inline-root `type` set as exactly `csv`/`rest_api`/`sql`/`static`, and this change deliberately widens that set to include `dataset`:
  - `openspec/specs/pipeline-proposal-contract/spec.md:148-149`, "Roots are existing references or inline specs", says `type` is "one of `csv`, `rest_api`, `sql`, `static`". This spec describes `schemas/pipelines/pipeline-proposal.schema.json`, which task 5.5 is changing to add `"dataset"`. The schema would change without its contract spec.
  - `openspec/specs/pipeline-proposal-apply/spec.md:55`, "Structural pre-validation creates nothing on a bad proposal", SHALL reject "an inline `type` outside `csv`/`rest_api`/`sql`/`static`". After this change `PipelineProposalService.scala:557` accepts `dataset`, which literally violates this requirement. Task 4.3's "pipeline-proposal validate/apply accepts `dataset`" test would be asserting behavior the spec forbids.

  This is the "missing contract update" class, and it is the same kind of defect as round-1 CR6. Only the specific capabilities differ.
- **Newly found — the protocol response site is not named, and its visibility plan contradicts itself.** The code has two sites in `api/protocols`:
  - `DataSourceProtocol.scala:89` (`def type: String = DataSourceKind.Static` on the static response) is the exact line that makes every read return `"static"` today. It is the core of AC2's "resolves to dataset".
  - `DataSourceProtocol.scala:502` (`case Some(JsString(DataSourceKind.Static))` in the response reader) also compares against the constant.

  The plan's statements about the constant disagree:
  - Decision 2 says `DataSourceKind.Static` becomes `private[model]`, and that no production code may compare against it.
  - Task 3.4 only says "confirm/adjust" `DataSourceProtocol` and never names either line.
  - Task 1.2 says "keep/remove `Static` per what call sites still need".
  - Task 3.1 says "Decide `DataSourceKind.Static`'s fate".

  Decision 2 has already decided, but tasks 1.2 and 3.1 re-open the question. Task 3.4 does not name the line that implements the AC.
- **Other checks:** the proposal still lists `PipelineRowJson` (the round-1 report showed it has no match) and omits `PatchSetPreviewProjection.scala:228` and `:238` (type-rename sites). Both are only inaccuracies in the proposal's Impact list. The compiler and task 3.5 catch them, so this is non-blocking.
- **Stale spec, not this ticket's to fix:** `data-source-persistence/spec.md:101` and `:116` were already stale after HEL-1074. Left alone.
- **Ticket AC coverage:**
  - AC1 is covered by tasks 6.1 and 3.4.
  - AC2 is covered by tasks 1.3, 3.1, 3.4 and 6.1, plus the `static-data-connector` delta.
  - AC3 is covered by task 4.1 and the drift-check delta.
- **Ticket context:** Decision 1 answers the explicit rename-vs-sibling question in ticket context, with justification.

### Verdict: REFUTE

### Change Requests

1. **Add a `pipeline-proposal-contract` spec delta.** MODIFY the "Roots are existing references or inline specs" requirement (`openspec/specs/pipeline-proposal-contract/spec.md:148-149`) so the inline `type` is one of `csv`, `rest_api`, `sql`, `dataset`, `static`, with `static` as the write-side alias. This pairs with task 5.5's schema enum change. Also check `create-pipeline-request.schema.json`'s owning spec, if one enumerates the inline type, and cover it the same way.
2. **Add a `pipeline-proposal-apply` spec delta.** MODIFY the "Structural pre-validation creates nothing on a bad proposal" requirement (`openspec/specs/pipeline-proposal-apply/spec.md:55`) so its rejection set is "an inline `type` outside `csv`/`rest_api`/`sql`/`dataset`/`static`". Otherwise task 4.3's acceptance test contradicts a binding spec.
3. **Name the response-serialization site and make the `Static` constant plan consistent.**
   - Task 3.4 must name `DataSourceProtocol.scala:89` (the response `type` becomes `DataSourceKind.Dataset`) and `:502` (the reader canonicalizes, or matches `Dataset`).
   - Make tasks 1.2 and 3.1 carry Decision 2's settled answer (`Static` is `private[model]`, alias-only) instead of "keep/remove" and "decide".
   - Alternatively, revise Decision 2 if the executor is meant to decide. Either way, the three artifacts must agree.

### Non-blocking notes

- Proposal Impact list: drop `PipelineRowJson`, and add `services/patchsets/PatchSetPreviewProjection.scala` (type-rename, `:228` and `:238`) and the correct `infrastructure/persistence/...` repository path.
- `openspec/specs/pipeline-proposal-review-ui/spec.md:33` and `assistant-conversation-loop/spec.md:193` mention `static` in prose. Consider whether `dataset` should be named too. This is advisory only.
