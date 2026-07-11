## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 6 ticket ACs addressed explicitly: new field-type category (`FieldTypeCategory`),
  two content variants (`StringBodyType`/`BinaryRefType`) with wire strings `string-body`/
  `binary-ref`, no API-contract changes needed (design.md explains why — `asString` already
  crosses the wire as a plain string, verified true by reading `model.scala`), Flyway
  migration (`V46__binary_refs.sql`), backward compatibility (all 1039 backend + 784
  frontend tests pass, including pre-existing suites), and an extensible value shape
  (`{storageKey, mimeType, filename, sizeBytes}`) for downstream connector/pipeline-op
  tickets.
- No AC silently reinterpreted — the "extensibility" AC is satisfied by the documented
  value-shape + `binary_refs` contract rather than by wiring an actual consumer, which
  design.md explicitly scopes as future work (HEL-214/216/219-221).
- All 12 task items (1.1–4.6) verified done and matching the implementation — walked each
  task item against the diff and test files; no partial or skipped items.
- No scope creep: `git diff --name-only` against the single commit shows only the 9 files
  listed in `files-modified.md` (2 backend source, 1 migration, 3 backend test, 2 frontend,
  plus the openspec artifacts) — no `InferredFieldsTable.tsx`, no `CastStep`/
  `ExpressionEvaluator` changes, no new REST route, confirmed absent from the diff.
- No regressions: full `sbt test` (1039/1039) and `npm test` (784/784, including the new
  `TypeDetailPanel.test.tsx`) pass.
- API contracts: correctly untouched — no `schemas/`/`JsonProtocols.scala` change needed
  since `BinaryRef` has no REST route and `DataField.dataType` was already an unconstrained
  `String` on the wire; `check:schemas` passes (schema/protocol parity check).
- Planning artifacts (design.md, tasks.md, files-modified.md) accurately reflect the final
  implementation — no drift found between documented decisions and the code read.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **`BinaryRefRepository.overwriteForDataType` genuinely mirrors `DataTypeRowRepository.overwriteRows`**:
  read both side by side (`backend/src/main/scala/com/helio/infrastructure/BinaryRefRepository.scala:25-36`
  vs `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala:24-31`) —
  both build a `DELETE ... WHERE data_type_id = $id` action, prepend it to a `Vector`/`Seq`
  of per-row `INSERT` actions, and run `DBIO.seq(allActions: _*).transactionally` via
  `ctx.withSystemContext`. Confirmed by test: `BinaryRefRepositorySpec` "second
  overwriteForDataType call replaces all existing rows (not appends)" and "zero-ref
  overwriteForDataType clears the snapshot" pass, proving the semantics, not just the name.
- **`binary_refs` migration**: read `V46__binary_refs.sql` directly — `row_index INT NOT
  NULL` column present, `UNIQUE (data_type_id, row_index, field_name)` present, plus
  `idx_binary_refs_data_type_id`. `BinaryRefsMigrationSpec` independently re-verified all
  three (columns, index, unique index) against a fresh EmbeddedPostgres instance — reran it
  myself, passing.
- **`DataFieldType.fromString`/`asString`/`category` round-trip**: read the match
  expressions directly in `model.scala:224-261` — all 7 variants (5 structured +
  `StringBodyType` + `BinaryRefType`) are exhaustively covered in `asString`, `fromString`
  (with `None` fallthrough), and `category`. Reran `DataFieldTypeSpec` — round-trip,
  unknown-string, and category-classification assertions all pass for all 7 variants.
- **RLS on `binary_refs`**: verified consistency with the existing `data_type_rows`
  (V35) precedent — same `ENABLE`/`FORCE ROW LEVEL SECURITY` pair, same indirect-owner
  `EXISTS` subquery shape against `data_types.owner_id`, same comment style explaining the
  privileged-pool bypass rationale. `RlsPolicyGuardSpec`'s `rlsTables` allowlist entry added
  correctly (`"binary_refs"` at the end, with a `V46` comment matching the existing
  convention) — reran the spec and all `binary_refs`-related assertions
  (`relrowsecurity`/`relforcerowsecurity`/at-least-one-policy) pass. This satisfies
  CONTRIBUTING.md's "Adding a new ACL'd table" rule (§93-102) exactly.
- **DRY / readable / modular**: no duplication found; `BinaryRefRepository` is a clean,
  small, single-purpose class; naming is unambiguous throughout.
- **Type safety**: no untyped escape hatches (`Any`/`asInstanceOf`) introduced.
- **Imports & Qualifiers rule**: `node scripts/check-scala-quality.mjs` reports 0 inline-FQN
  violations (37 pre-existing file-size warnings only, informational per CONTRIBUTING.md;
  `model.scala` grew from 303→360 lines, already over the 250-line soft budget before this
  ticket — not a new violation, and still well under the 400-line "propose a split" trigger).
- **Tests meaningful**: `DataFieldTypeSpec`, `BinaryRefsMigrationSpec`,
  `BinaryRefRepositorySpec`, and `TypeDetailPanel.test.tsx` all exercise real code paths
  (round-trip, migration structure, transactional overwrite/isolation, and the rendered
  Select options) and would catch a real regression in any of them (e.g. reverting the
  transactional overwrite to an append would fail the "replaces (not appends)" test).
- **No dead code**: no unused imports/TODOs found in the diff.
- **No over-engineering**: `FieldTypeCategory` as a classifier (not a parallel ADT) and
  `binary_refs` as a derived index (not a competing read path) are both minimal,
  well-justified designs per design.md's alternatives-considered sections.
- **Out-of-scope self-flagged RLS decision**: correctly scoped and executed — matches the
  existing pattern exactly rather than introducing a new one.
- **`git commit -n` bypass verification**: reran every pre-commit hook step independently
  (`.husky/pre-commit`: lint → format:check → check:schemas → check:openspec →
  check:scala-quality → test). Confirmed `check:openspec` is the *only* failing gate (exit
  1, "change ... is complete (15/15) but not archived" — expected, archiving is a later
  workflow phase). `lint` (0 warnings), `format:check`, `check:schemas`, `check:scala-quality`
  all pass cleanly; `npm test` (784/784) and `sbt test` (1039/1039, run separately) both pass.
  The bypass claim is accurate and the executor's handoff note correctly documents it.

Non-blocking: `model.scala` continuing to grow (360 lines) without a split is a soft-budget
warning only, consistent with existing project convention of keeping the `DataFieldType`
vocabulary co-located; not actionable now.

### Phase 3: UI Review — PASS
Issues: none blocking.

- Started dev servers via `scripts/concertino/start-servers.sh` /
  `assert-phase.sh servers` — both reported healthy (`PASS servers`).
- Logged in, navigated to Type Registry (`/registry`), opened the field-type editor for an
  existing type's `x` field. The dropdown lists all 7 options including the new
  `string-body` and `binary-ref` at the end, alongside the 5 existing structured types.
- Happy path end-to-end: selected `string-body`, clicked "Save changes" → "Changes saved."
  confirmation appeared; reloaded the page (`/registry` fresh navigation) and confirmed the
  field's `dataType` persisted as `string-body` server-side (not just client state).
  Reverted the field back to `integer` and re-saved to leave shared dev-DB fixture data
  clean.
- No console errors observed throughout the flow (0 errors, only 3 pre-existing warnings
  unrelated to this change).
- Interactive elements (the field-type `Select`) retain the existing shared component's
  accessible name (`"Data type for x"`) and keyboard/combobox semantics — no new custom
  interactive element was introduced, only two additional options on an existing one.
- Resized to 1440 and 768: at 1440 the Type Registry page and dropdown render cleanly. At
  768, the overall page (sidebar + content panel) exhibits horizontal overflow/clipping —
  but this is a pre-existing page-layout characteristic unrelated to this change (the diff
  is a 2-line addition to an options array; the dropdown itself renders both new options
  correctly and without overflow at 768, screenshot-verified). Noted as an out-of-scope,
  non-blocking observation, not attributable to this ticket's diff.

### Overall: PASS

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/domain/model.scala` is now 360 lines, further over the
  250-line soft budget (pre-existing at 303 before this change). Not a violation, but worth
  keeping in mind if a future ticket adds more to `DataFieldType`/`FieldTypeCategory` — may
  cross the 400-line "propose a split" threshold in CONTRIBUTING.md.
- The Type Registry page's responsive layout at the 768px breakpoint (sidebar/content
  overflow) is a pre-existing issue outside this ticket's scope — worth a follow-up ticket
  if not already tracked, but not caused by or in scope for HEL-217.
