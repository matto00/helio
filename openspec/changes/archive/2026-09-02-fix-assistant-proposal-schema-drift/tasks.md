## 1. ### Backend

- [x] 1.1 Add `enabled` (`type: [boolean, null]`) to `PipelineProposalStepSchema` in
      `AssistantProposalToolSchemas.scala`.
- [x] 1.2 Add `"output"` to `EditTargetSchema`'s `kind` `enumSchema(...)` call in the same file.
- [x] 1.3 Remove the two now-satisfied `KNOWN_PRE_EXISTING_DRIFT` entries (and their justifying
      comment) in `scripts/check-schema-drift.mjs`.

## 2. ### Tests

- [x] 2.1 Run `npm run check:schemas` and confirm it passes with zero exceptions.
- [x] 2.2 Extend `AssistantProposalToolSchemasSpec` with a round-trip example for a pipeline step
      carrying `enabled: false`.
- [x] 2.3 Extend `AssistantProposalToolSchemasSpec` with a round-trip example for a patch-set edit
      targeting `kind: "output"`.
- [x] 2.4 Run `sbt test` for the affected spec file(s).
