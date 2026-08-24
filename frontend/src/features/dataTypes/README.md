# Data Types

The type registry: `state/dataTypesSlice.ts`, the API client
(`services/dataTypeService.ts`), wire/domain types (`types/dataType.ts`), and
the browser/detail UI (`ui/TypeRegistryPage`, `TypeRegistryBrowser`,
`TypeDetailPanel`).

**Belongs here:** listing and inspecting the data types pipelines produce.
**Does not belong here:** the pipelines that produce those types, which live
in `pipelines`; panel bindings that consume them, which live in `panels`.
