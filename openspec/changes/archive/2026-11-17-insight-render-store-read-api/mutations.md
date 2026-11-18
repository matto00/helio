# HEL-1742 mutation evidence (each mutation applied, run, then reverted)

## M1 authenticated ACL bypassed

Guard: stranger gets the unknown-id 404 (authenticated read + history)

Mutation in `backend/src/main/scala/com/helio/services/insights/OutputInsightReadService.scala`: `outputRepo.findById(id, user).map {` -> `outputRepo.findByIdInternal(id).map {`

Command: `sbt testOnly com.helio.api.routes.pipelines.OutputInsightRoutesSpec`

Result (RED expected):

```
[info] - should answer a non-grantee with exactly the 404 an unknown id gets *** FAILED ***
[info] - should answer a non-grantee with the unknown-id 404 *** FAILED ***
[info] Tests: succeeded 10, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
```

## M2 public dashboard directive removed

Guard: private dashboard 404 for anon/stranger/bad token

Mutation in `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala`: `// HEL-1742: the dashboard gate runs BEFORE the resolver, exactly like `history`.
              aclDirective.authorizeResourceWithSharing(
 ` -> `ServiceResponse.run(insight.resolveInsight(dashboardId, panelId))(identity)`

Command: `sbt testOnly com.helio.api.routes.dashboards.OutputInsightPublicRoutesSpec`

Result (RED expected):

```
[info] - should answer an anonymous caller and a signed-in stranger on a private dashboard exactly as an unknown dashboard *** FAILED ***
[info] - should serve a private dashboard to a valid share token *** FAILED ***
[info] Tests: succeeded 5, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
```

## M3 public projection leaks the cited outputId

Guard: public allow-list (keys, leak markers, schema)

Mutation in `backend/src/main/scala/com/helio/api/protocols/pipelines/OutputInsightProtocol.scala`: `(Vector[(String, JsValue)]("id" -> JsString(c.id), "field" -> JsString(c.field), "isPct" -> JsBoolean(c.isPct)) ++` -> `(Vector[(String, JsValue)]("id" -> JsString(c.id), "outputId" -> JsString("cited-output-secret"), "field" -> JsString(c.field), "isPct" -> J`

Command: `sbt testOnly com.helio.api.routes.dashboards.OutputInsightPublicRoutesSpec`

Result (RED expected):

```
[info] - should return only the allow-listed fields for a render whose row has every column populated *** FAILED ***
[info] Tests: succeeded 6, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M4 non-insight kind not hidden

Guard: non-insight Output is the same 404

Mutation in `backend/src/main/scala/com/helio/services/insights/OutputInsightReadService.scala`: `case Some(o) if o.kind == OutputKind.Insight => Right(o)` -> `case Some(o) => Right(o)`

Command: `sbt testOnly com.helio.api.routes.pipelines.OutputInsightRoutesSpec`

Result (RED expected):

```
[info] - should answer an accessible non-insight Output with the same 404, even with leftover insight rows *** FAILED ***
[info] Tests: succeeded 11, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M5 render served from the newest attempt instead of the newest ok

Guard: a failed attempt must not hide the last good render

Mutation in `backend/src/main/scala/com/helio/services/insights/OutputInsightReadService.scala`: `ok      <- insightRepo.latestOk(id.value)` -> `ok      <- insightRepo.latestAttempt(id.value)`

Command: `sbt testOnly com.helio.api.routes.pipelines.OutputInsightRoutesSpec`

Result (RED expected):

```
[info] - should return the newest ok render and, separately, a newer failed attempt *** FAILED ***
[info] - should report a skipped attempt as lastAttempt with render null when no ok row exists *** FAILED ***
[info] Tests: succeeded 10, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
```

## M7 ApiRoutes does not wire the read service into OutputRoutes

Guard: wiring through ApiRoutes (fail-first for 0.1: routes do not exist)

Mutation in `backend/src/main/scala/com/helio/api/ApiRoutes.scala`: `Some((resolvedNodePayloadHistoryRepo, payloadHistoryConfig)), Some(outputInsightReadService)).routes` -> `Some((resolvedNodePayloadHistoryRepo, payloadHistoryConfig))).routes`

Command: `sbt testOnly com.helio.api.routes.pipelines.OutputInsightRoutesSpec`

Result (RED expected):

```
[info] - should return the newest ok render and, separately, a newer failed attempt *** FAILED ***
[info] - should carry explicit nulls for render and lastAttempt when the Output has no rows *** FAILED ***
[info] - should report a skipped attempt as lastAttempt with render null when no ok row exists *** FAILED ***
[info] - should serve a user the pipeline is shared with *** FAILED ***
[info] - should never create or change a row (a read leaves the table untouched) *** FAILED ***
[info] - should list every attempt newest first, whatever its status *** FAILED ***
[info] - should apply since in SQL before limit *** FAILED ***
[info] - should 400 an out-of-range limit or malformed since, never clamping *** FAILED ***
[info] Tests: succeeded 4, failed 8, canceled 0, ignored 0, pending 0
[info] *** 8 TESTS FAILED ***
```

## M8 ApiRoutes does not wire the read service into PublicDashboardRoutes

Guard: public wiring through ApiRoutes

Mutation in `backend/src/main/scala/com/helio/api/ApiRoutes.scala`: `Some(outputHistoryService), Some(outputInsightReadService)).routes` -> `Some(outputHistoryService)).routes`

Command: `sbt testOnly com.helio.api.routes.dashboards.OutputInsightPublicRoutesSpec`

Result (RED expected):

```
[info] - should return only the allow-listed fields for a render whose row has every column populated *** FAILED ***
[info] - should return 200 render null for an insight Output whose only attempt failed, leaking no status *** FAILED ***
[info] - should serve a private dashboard to a valid share token *** FAILED ***
[info] - should 404 a panel that belongs to another dashboard *** FAILED ***
[info] Tests: succeeded 3, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
```

## M6 history ignores since (SQL bound replaced by epoch)

Guard: since is applied in SQL before limit

Mutation in `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputInsightRepository.scala`: `AND created_at >= $sinceTs` -> `AND created_at >= ${Timestamp.from(Instant.EPOCH)}`

Command: `sbt testOnly com.helio.api.routes.pipelines.OutputInsightRoutesSpec`

Result (RED expected):

```
[info] - should apply since in SQL before limit *** FAILED ***
[info] Tests: succeeded 11, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M9 retention drops the keep-newest-ok exception

Guard: newest ok row survives past the age limit

Mutation in `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputInsightRepository.scala`: `AND NOT (i.status = 'ok' AND NOT EXISTS (` -> `AND NOT (i.status = 'zz' AND NOT EXISTS (`

Command: `sbt testOnly com.helio.services.pipelines.OutputInsightRetentionSpec`

Result (RED expected):

```
[info] - should keep both the newest ok row and the newest attempt when they differ *** FAILED ***
[info] Tests: succeeded 6, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M10 retention drops the keep-newest-attempt exception

Guard: newest attempt survives (an Output keeps its latest row)

Mutation in `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputInsightRepository.scala`: `AND EXISTS (SELECT 1 FROM output_insights n
                             WHERE n.output_id = i.output_id AND (n.created_at, n.id) > (i.creat` -> ``

Command: `sbt testOnly com.helio.services.pipelines.OutputInsightRetentionSpec`

Result (RED expected):

```
[info] - should keep both the newest ok row and the newest attempt when they differ *** FAILED ***
[info] Tests: succeeded 6, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M11 retention ignores the owner tier (strictest age for everyone)

Guard: tier ages (beta 90 / owner 365)

Mutation in `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputInsightRepository.scala`: `AND i.created_at < COALESCE(($cutoffs::timestamptz[])[array_position($tiers::text[], u.tier)], $strictest)` -> ``

Command: `sbt testOnly com.helio.services.pipelines.OutputInsightRetentionSpec`

Result (RED expected):

```
[info] - should apply the beta and owner tier ages (90 and 365 days) *** FAILED ***
[info] Tests: succeeded 6, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M12 cascade removed from the FK

Guard: deleting an Output removes its insight rows

Mutation in `backend/src/main/resources/db/migration/V145__output_insights.sql`: `REFERENCES outputs(id) ON DELETE CASCADE` -> `REFERENCES outputs(id)`

Command: `sbt testOnly com.helio.infrastructure.persistence.OutputInsightRlsSpec`

Result (RED expected):

```
[info] - should disappear with its Output (ON DELETE CASCADE) *** FAILED ***
[info] Tests: succeeded 8, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M13 table dropped from RlsPolicyGuardSpec.rlsTables

Guard: rlsTables completeness (catalog RLS tables == allow-list)

Mutation in `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala`: `"output_insights" -> None,` -> ``

Command: `sbt testOnly com.helio.infrastructure.persistence.RlsPolicyGuardSpec`

Result (RED expected):

```
[info] - should matches exactly the set of public-schema tables with relrowsecurity = true *** FAILED ***
[info] Tests: succeeded 130, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M14 FORCE RLS removed from the migration

Guard: RLS enforced (relforcerowsecurity) on output_insights

Mutation in `backend/src/main/resources/db/migration/V145__output_insights.sql`: `ALTER TABLE output_insights FORCE ROW LEVEL SECURITY;` -> ``

Command: `sbt testOnly com.helio.infrastructure.persistence.RlsPolicyGuardSpec`

Result (RED expected):

```
[info] - should output_insights has relforcerowsecurity = true in pg_class *** FAILED ***
[info] Tests: succeeded 133, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M15 an OutputService collaborator added to the read service

Guard: no model client reachable: constructor parameters equal the allow-list

Mutation in `backend/src/main/scala/com/helio/services/insights/OutputInsightReadService.scala`: `insightRepo: OutputInsightRepository
)(implicit` -> `insightRepo: OutputInsightRepository,
    outputService: com.helio.services.pipelines.OutputService = null
)(implicit`

Command: `sbt testOnly com.helio.services.insights.OutputInsightReadServiceShapeSpec`

Result (RED expected):

```
[info] - should take exactly the Output repository, the insight repository and the execution context *** FAILED ***
[info] Tests: succeeded 1, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M16 insight purge error escapes the pass

Guard: an insight-purge failure never fails the pass

Mutation in `backend/src/main/scala/com/helio/services/pipelines/OutputHistoryRetentionService.scala`: `.recover { case NonFatal(e) =>
        log.error("Output insight retention purge failed", e)
        PartResult.Failed
      }` -> ``

Command: `sbt testOnly com.helio.services.pipelines.OutputInsightRetentionSpec`

Result (RED expected):

```
[info] - should not fail the pass (the history part still reports) when the insight purge fails *** FAILED ***
[info] Tests: succeeded 6, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M17 insight-part failure ignored in the next-due precedence (cycle 2, CR2)

Guard: insight-part failure keeps the full interval over a lock-held payload part and over a budget-exhausted history pass

Mutation in `backend/src/main/scala/com/helio/services/pipelines/OutputHistoryRetentionService.scala`: `|| insight == PartResult.Failed` -> ``

Command: `sbt testOnly com.helio.services.pipelines.OutputHistoryRetentionServiceSpec`

Result (RED expected):

```
[info] - should let an insight-part failure win over a lock-held payload part (full interval) *** FAILED ***
[info] - should let an insight-part failure win over a budget-exhausted history pass (no next-tick continuation) *** FAILED ***
[info] Tests: succeeded 12, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
```
