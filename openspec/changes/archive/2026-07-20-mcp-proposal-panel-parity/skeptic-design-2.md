## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-panel-composition-tools/spec.md`, and the round-1 `skeptic-design-1.md` (as a claim to
  re-verify, not a fact).

- **The single round-1 REFUTE item — D3's illustrative examples were structurally impossible.**
  Re-read the revised `design.md` D3 and `tasks.md` Task 1.4:
  - D3 now states: "Data panels (metric/chart/table/collection) always carry a flat `dataTypeId` —
    `validatePanel`/`DataPanelKinds` reject a data panel without one BEFORE the merge runs — so the
    derived base is never empty here; `config` only augments it... Non-data panels (text/markdown/
    image) may produce an empty/small base from `buildNonDataConfig`... The data-panel `dataTypeId`
    requirement is unchanged — this change never loosens `DataPanelKinds`."
  - Task 1.4 now reads: "Ensure the merge yields a valid `CreatePanelRequest` in both shapes: data
    panels (base always has flat `dataTypeId`, `config` augments) and non-data panels that supply only
    `config` (empty base, `config` alone forms the payload); do not loosen the `DataPanelKinds`
    dataTypeId requirement (D3)."
  - Verified this against fresh ground truth in
    `backend/src/main/scala/com/helio/services/DashboardProposalService.scala`:
    - `validatePanel` (lines ~76-77): `if (DataPanelKinds.contains(panel.type) && panel.dataTypeId.isEmpty) Left(...)` — runs during `validateStructure`, strictly before `createAll`/`buildCreateRequest`.
    - `DataPanelKinds = Set("metric", "chart", "table", "collection")` (object footer).
    - `buildCreateRequest` branches purely on `panel.dataTypeId` (`case Some(id) => buildDataConfig(...)`, `case None => buildNonDataConfig(panel)`) — since `DataPanelKinds` members are already guaranteed to have `dataTypeId` by validation, they always hit `buildDataConfig`, which always emits a non-empty `{dataTypeId, fieldMapping}` map.
    - `buildNonDataConfig` only has cases for `text`/`markdown` (`content`), `image` (`imageUrl`/`imageFit`), and `divider` (`orientation`), each returning `None` when the flat field is absent — this is the only genuinely-empty-base path, and it is now correctly attributed to non-data kinds only.
  - This exactly matches the revised D3/Task 1.4 prose. The prior contradiction (citing "collection
    created without a flat binding" and "chart with `chartOptions`" as config-only/empty-base examples)
    is gone; no new contradiction was introduced by the rewrite.

- **spec.md unaffected by the fix, and still consistent.** `spec.md`'s scenario "Collection base type
  and layout via proposal config" already required "a valid `dataTypeId`" alongside `config` — it was
  never wrong, and the design revision now agrees with it instead of contradicting it. No spec.md change
  was needed or made.

- **Re-swept the rest of `design.md`/`tasks.md`/`proposal.md` for anything the revision might have
  disturbed** — D1, D2, D4, D5, and the rest of Task 1/2/3/4/5 are textually unchanged from round 1 and
  were independently re-verified against ground truth in round 1 (config passthrough precedent in
  `helio-mcp/src/tools/write.ts`/`PanelProtocol.scala`; `PanelConfigCodec.decodeCreateConfig` tolerance;
  `PanelService.create`'s independent `rejectCompanionBinding` re-check; `PanelType.fromString`/
  `validateDividerOrientation` divider tolerance; schema's current `divider` enum member and absent
  `config` property; MCP's current `PANEL_TYPES` already including `collection`). Nothing in the diff
  between round 1 and round 2 touches those areas, and my own reads above reconfirm the file states are
  unchanged (`git status --short` shows the whole change dir as a single untracked block — no separate
  commits to diff, consistent with an in-place revision of the same working files).

- **No new placeholders, hand-waving, or scope drift** introduced by the revision — D3/Task 1.4 are now
  fully specific (names the actual empty-base kinds, states the invariant that must not be loosened) with
  no deferred decisions.

### Verdict: CONFIRM

### Non-blocking notes

- None beyond what round 1 already flagged as non-blocking (ticket's stale "proposal.ts omits
  collection" premise — no action needed, already correctly scoped out by the design).
