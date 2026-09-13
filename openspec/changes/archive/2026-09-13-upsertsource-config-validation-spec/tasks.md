## 1. Config model + codec

- [x] 1.1 Add `UpsertTarget` (`NewSource`/`ExistingSource`) with a `SecondaryInput`-style
      discriminated JSON codec.
- [x] 1.2 Add `UpsertMode` (`append`/`replace`) as a closed enum.
- [x] 1.3 Add `UpsertSourceConfig` with a tolerant `decode` (read path) and `format`.

## 2. Write-path validation

- [x] 2.1 Add `UpsertSourceConfig.validateRawConfig`: reject non-object config, wrong-typed
      `target`/`mode`, unrecognised `target.kind`, unsupported `mode`.
- [x] 2.2 Add `UpsertSourceConfig.validateTargetOwnership`: async ownership pre-flight via
      `DataSourceRepository.findByIdOwned`, uniform "not found" for unknown vs. other-tenant ids.

## 3. Tests

- [x] 3.1 Read-path tolerance: legacy/malformed-absent row still decodes (no
      `IllegalStateException` risk through `PipelineStepRepository.rowToDomain`).
- [x] 3.2 Write-path rejections: wrong-typed `target`/`mode`/`target.name`/`target.dataSourceId`,
      unrecognised `target.kind`, unsupported `mode`, non-object top-level config, absent fields
      accepted.
- [x] 3.3 Ownership pre-flight: owned id accepted, unknown id rejected, another tenant's id
      rejected with the identical message shape as unknown (no cross-tenant oracle), against a
      real Postgres instance.

## 4. Spec

- [x] 4.1 Write `pipeline-upsertsource-config` capability spec (config model, tolerant read,
      strict write, ownership check, "not yet creatable").

## 5. Documentation / seam

- [x] 5.1 Document, in the config file's own scaladoc and in design.md, why `upsertsource` is not
      registered in `PipelineStep.Registry` yet, and exactly what HEL-1100/1101/1102 reuse.
