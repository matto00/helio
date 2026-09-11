## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)
- **Worktree base:** HEAD is `730b42d8` (HEL-1074 merged). The artifacts are ticket.md, proposal.md, design.md, tasks.md, and six spec deltas, all read fresh.
- **Round-2 CR1 (`pipeline-proposal-contract` delta):** RESOLVED.
  - `specs/pipeline-proposal-contract/spec.md` MODIFIES "Roots are existing references or inline specs".
  - The inline `type` set is now `csv`/`rest_api`/`sql`/`static`/`dataset`, with static and dataset stated as equivalent. A new scenario covers both discriminators.
  - The base text at `openspec/specs/pipeline-proposal-contract/spec.md:148-149` is the requirement being replaced, and its header matches exactly.
  - `grep -rln create-pipeline-request openspec/specs` finds no owning spec that enumerates the inline type, so nothing further is needed there.
- **Round-2 CR2 (`pipeline-proposal-apply` delta):** RESOLVED.
  - `specs/pipeline-proposal-apply/spec.md` MODIFIES "Structural pre-validation creates nothing on a bad proposal". The rejection set now includes `dataset`.
  - I compared it with the base at `openspec/specs/pipeline-proposal-apply/spec.md:52-60`. Every base scenario is carried over unchanged, and a new either-discriminator scenario is added.
  - Task 4.3's acceptance test no longer contradicts a binding spec.
- **Round-2 CR3 (`DataSourceProtocol` sites and the `Static` constant plan):** RESOLVED.
  - Live code check: `DataSourceProtocol.scala:89` is `def \`type\`: String = DataSourceKind.Static`, and `:502` is `case Some(JsString(DataSourceKind.Static)) => staticSourceResponseFormat.read(json)`. Both citations are accurate.
  - Task 3.4 names both lines and the concrete change for each (`:89` becomes `Dataset`; `:502` gets the alternative pattern `Static | Dataset`). `Static` and `Dataset` are stable `val` identifiers on an object, so `JsString(A | B)` is a legal Scala pattern.
  - Design Decision 2, task 1.2 and task 3.1 now give the same single answer: `Static` stays public, used only in `canonicalize` and the `:502` arm, and every other comparison goes through `canonicalize` against `Dataset`. The earlier `private[model]` wording is gone, and so is the "decide/keep-remove" wording. No contradiction remains.
  - `DataSource.scala:203` (`val Static`) and `:214` (`parseKind`) match the design's description of the current state.
- **Spec-level sweep for other contradicted requirements:** I ran `grep -rn '"static"|`static`' openspec/specs/*/spec.md`.
  - The requirements that enumerate or bind the kind set are all covered by deltas: connector-registry, frontend-data-sources-page (Manual POST and badge), pipeline-proposal-contract, pipeline-proposal-apply, pipeline-proposal-analyze-api, and static-data-connector.
  - The remaining hits are historical or prose (dataset-row-storage, mcp-data-source-tools, pipeline-run-execution:311, assistant-conversation-loop:193/240, pipeline-proposal-apply:26/156). Each describes behavior that remains true, because `static` is still accepted on write.
- **`openspec validate dataset-source-kind-model --type change`:** prints "Change 'dataset-source-kind-model' is valid".
- **AC trace:**
  - AC1 ("dataset" round-trips) is covered by task 3.4 (`:502` accepts dataset, `:89` emits it) and task 6.1.
  - AC2 ("static" resolves to "dataset") is covered by tasks 1.3/3.1 (canonicalize, parseKind), 3.3, 3.4 and 6.1, plus the static-data-connector delta.
  - AC3 (ConnectorRegistrySpec) is covered by task 4.1 and the connector-registry drift delta.
  - The ticket context's rename-vs-sibling question is answered, with justification, in Decision 1.

### Verdict: CONFIRM

### Non-blocking notes
- The proposal's Impact list still cites `services/pipelines/PatchSetPreviewProjection.scala`. Round 2 placed this file under `services/patchsets/`; confirm the path at execution time. The compiler or grep in task 3.5 will catch it either way.
- Task 1.3 says parseKind accepts "every kind in `All`". After the rename, `All` holds "dataset" and not "static", which is the intended behavior. The executor should assert both `parseKind("dataset")` and `parseKind("static")` in task 4.1.
- Advisory: `assistant-conversation-loop/spec.md:193` and `pipeline-proposal-review-ui/spec.md:33` could mention `dataset` in their prose. This is not required.
