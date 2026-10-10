# HEL-1469 behavior changes (for the PR body / evaluator)

Direct `POST /api/pipelines`: no status code or message of an existing single-error failure class changes (C4). Changed: multi-error precedence only (request-only step/Output errors are now reported before an inline root source is created; an unowned join right-source 404 in one step plus a refused config 422 in a later step now reports 422; all lane checks for every step run before any ownership lookup).

Patch-set `pipeline/create` edit (apply AND preview, which share `resolveAll`) -- now refused at RESOLVE time with the 4xx of its class and an `edit N: ` prefix, nothing applied, no source created, instead of resolving and failing at forward apply (HTTP 200 with `failure`) / a 200 preview projection. Full set of classes moved (they all come from the shared pre-flight):
- unknown step type (400)
- duplicate step clientId (400)
- unresolvable `parentStepId` (400)
- undecodable step config (400)
- forward lane reference (400); lane reference absent / self / ancestor (422 / 400 / 400)
- step / Output root-index errors (both parentStepId and rootClientId, unresolvable or missing rootClientId) (400)
- Output `nodeStepClientId` unresolvable, blank Output name, unknown Output kind (400)
- disallowed / invalid Output config (keys, aggregation, chartType, `compare`, `historyPayloads`) (400)
(Refused step configs already moved in HEL-1402.) Multi-error: with step 0 an unknown type and step 1 a refused config, step 0's 400 now wins (before: step 1's 422).

Patch-set mid-set rollback of an applied inline-root pipeline create now also deletes the inline source(s) (via `DataSourceService.delete`, as the user). If the pipeline delete fails no source delete is attempted; a source delete failure makes the edit `unrecoverable`.

Follow-up candidates (stated Non-Goals, not fixed): `POST /api/pipelines/:id/roots` inline root then cycle-guard failure; bare-`url` rest_api inline root's implicit "Auto:" Connector survives compensation; `SourceService.createSql/createRest` failing after their own insert; patch-set UNDO of an applied inline-root create; crash-atomicity of the compensating delete.
