# move-evidence (HEL-1234)

Base: a256261dc. Script: `move-match.py` (adapted from archive/2026-10-08-split-panel-service). Run: `python3 -I move-match.py <orig DashboardService.scala from a256261dc> backend/src/main/scala/com/helio/services/dashboards`.

## Green run
```
MATCH  insertNew SIGNATURE
MATCH  insertNew  (orig 112-127 -> DashboardWrites.scala, def)
MATCH  applyUpdate SIGNATURE
MATCH  applyUpdate  (orig 230-252 -> DashboardWrites.scala, def)
MATCH  writeUpdate SIGNATURE
MATCH  writeUpdate  (orig 254-292 -> DashboardWrites.scala, def)
MATCH  repairLayout post-ownership tail  (orig 310-337 -> DashboardLayoutRepairWrite.scala, block)
MATCH  importSnapshot body  (orig 372-391 -> DashboardSnapshotImport.scala, block)
MATCH  validateImportPanels doc  (orig 393-404 -> DashboardSnapshotImport.scala, doc)
MATCH  validateImportPanels SIGNATURE
MATCH  validateImportPanels  (orig 405-449 -> DashboardSnapshotImport.scala, def)
RESULT ALL MATCH
```

## Red run (scratch copy: one token altered in DashboardWrites.insertNew, one message altered in DashboardLayoutRepairWrite)
```
MATCH  insertNew SIGNATURE
DIFF   insertNew  (orig 112-127 -> DashboardWrites.scala, def)
MATCH  applyUpdate SIGNATURE
MATCH  applyUpdate  (orig 230-252 -> DashboardWrites.scala, def)
MATCH  writeUpdate SIGNATURE
MATCH  writeUpdate  (orig 254-292 -> DashboardWrites.scala, def)
DIFF   repairLayout post-ownership tail  (orig 310-337 -> DashboardLayoutRepairWrite.scala, block)
MATCH  importSnapshot body  (orig 372-391 -> DashboardSnapshotImport.scala, block)
MATCH  validateImportPanels doc  (orig 393-404 -> DashboardSnapshotImport.scala, doc)
MATCH  validateImportPanels SIGNATURE
MATCH  validateImportPanels  (orig 405-449 -> DashboardSnapshotImport.scala, def)
RESULT 2 DIFF
```

## Non-moved changed lines (D4), all of them
- Module scaffolding: package/imports/class headers/closing braces in the 3 new files.
- `private def insertNew` / `private def applyUpdate` -> `def` (class is `private[dashboards]`); `writeUpdate` stays `private def`.
- Repair tail re-indented by -4 (whitespace-insensitively identical); wrapped in `repairOwned(dashboardId, existing, patchPayload, user)` (param names verbatim).
- `importSnapshot` body + `validateImportPanels` moved verbatim into `DashboardSnapshotImport.importSnapshot` (same signature); `DashboardService.importSnapshot` is now a one-line delegate (identical signature).
- Receiver qualification: `insertNew(` x2 -> `writes.insertNew(`; `applyUpdate(` x2 -> `writes.applyUpdate(`; repair tail call `layoutRepair.repairOwned(...)` in the `Some(existing)` branch.
- Three `private val` module fields + 2-line comment right after the `require` (`audit` passed as eta-expanded function value).
- Name resolution (D3 note): in `DashboardSnapshotImport`, `validateSnapshotPayload` resolves via `import DashboardServiceValidation._` to `DashboardServiceValidation.validateSnapshotPayload`, the very function the companion forwarder calls.
- Removed now-unused imports from DashboardService.scala: `DashboardSnapshotPanelEntry`, `PanelConfigCodec`, `LayoutPolicy`, `PanelServiceHelpers` (import list narrowed to `LayoutWritePolicy`), `Instant`, `UUID`.
- Side effect: the `outputRepo` constructor param is no longer captured as a private field of `DashboardService` (it is only passed to `DashboardSnapshotImport` at construction; the `require` still precedes). Not part of the public surface.
- Comments: none changed ("this service's own mutation paths above" in `findById` doc is still true; `findById` did not move). `README.md` Holds list updated (task 2.5).

## javap (task 1.2 base captured on unmodified tree before any edit; head after)
Filtered (`grep -v '\$anonfun\$'`) `javap -public` diff for DashboardService, DashboardService$, DashboardService$CreateDashboardInput, DashboardService$CreateDashboardInput$: **empty** (0 lines each). Unfiltered public diff: only `$anonfun$` lines (non-anonfun lines in unfiltered diff: none).

### Base public (DashboardService)
```
Compiled from "DashboardService.scala"
public final class com.helio.services.dashboards.DashboardService {
  public static com.helio.services.audit.AuditService $lessinit$greater$default$3();
  public static scala.util.Either<java.lang.String, scala.runtime.BoxedUnit> validateSnapshotPayload(com.helio.api.protocols.dashboards.DashboardSnapshotPayload);
  public scala.concurrent.Future<com.helio.domain.model.PagedResult<com.helio.domain.model.Dashboard>> findAll(com.helio.domain.model.AuthenticatedUser, com.helio.domain.model.Page);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> findById(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.Tuple2<com.helio.domain.model.Dashboard, java.lang.Object>> create(com.helio.services.dashboards.DashboardService$CreateDashboardInput, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit>> delete(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit>> deleteInternal(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.Tuple2<com.helio.domain.model.Dashboard, scala.collection.immutable.Vector<com.helio.domain.model.Panel>>>> duplicate(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> update(java.lang.String, com.helio.api.protocols.dashboards.UpdateDashboardRequest, com.helio.domain.model.AuthenticatedUser, com.helio.services.panels.LayoutWritePolicy);
  public com.helio.services.panels.LayoutWritePolicy update$default$4();
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> repairLayout(java.lang.String, com.helio.api.protocols.dashboards.DashboardLayoutPatchPayload, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.api.protocols.dashboards.DashboardSnapshotPayload>> exportSnapshot(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.Tuple2<com.helio.domain.model.Dashboard, scala.collection.immutable.Vector<com.helio.domain.model.Panel>>>> importSnapshot(com.helio.api.protocols.dashboards.DashboardSnapshotPayload, com.helio.domain.model.AuthenticatedUser);
  public static final java.lang.String $anonfun$new$1();
  public static final scala.util.Either $anonfun$findById$1(scala.Option);
  public static final scala.Tuple2 $anonfun$create$2(com.helio.domain.model.Dashboard);
  public static final scala.concurrent.Future $anonfun$create$1(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.services.dashboards.DashboardService$CreateDashboardInput, com.helio.domain.model.AuthenticatedUser, scala.Option);
  public static final scala.Tuple2 $anonfun$create$3(com.helio.domain.model.Dashboard);
  public static final scala.Tuple2 $anonfun$create$4(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, scala.Tuple2);
  public static final scala.util.Either $anonfun$delete$1(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.AuthenticatedUser, scala.util.Either);
  public static final scala.util.Either $anonfun$deleteInternal$2(boolean);
  public static final scala.concurrent.Future $anonfun$deleteInternal$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option);
  public static final scala.util.Either $anonfun$duplicate$2(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option);
  public static final scala.concurrent.Future $anonfun$duplicate$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option);
  public static final scala.concurrent.Future $anonfun$update$2(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.Dashboard, scala.Option, scala.Option, scala.Option, com.helio.services.panels.LayoutWritePolicy, scala.util.Either);
  public static final scala.concurrent.Future $anonfun$update$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option, scala.Option, scala.Option, com.helio.services.panels.LayoutWritePolicy, scala.Option);
  public static final scala.util.Either $anonfun$update$3(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.AuthenticatedUser, scala.util.Either);
  public static final scala.Some $anonfun$applyUpdate$1(com.helio.domain.model.DashboardLayout);
  public static final com.helio.domain.model.DashboardAppearance $anonfun$writeUpdate$2(com.helio.domain.model.Dashboard);
  public static final com.helio.domain.model.DashboardLayout $anonfun$writeUpdate$3(com.helio.domain.model.Dashboard);
  public static final scala.util.Either $anonfun$writeUpdate$4(scala.Option);
  public static final scala.concurrent.Future $anonfun$writeUpdate$1(com.helio.services.dashboards.DashboardService, scala.Option, scala.Option, java.time.Instant, scala.Option);
  public static final com.helio.domain.model.DashboardAppearance $anonfun$writeUpdate$5(com.helio.domain.model.Dashboard);
  public static final com.helio.domain.model.DashboardLayout $anonfun$writeUpdate$6(com.helio.domain.model.Dashboard);
  public static final scala.util.Either $anonfun$writeUpdate$7(scala.Option);
  public static final boolean $anonfun$repairLayout$4(com.helio.services.panels.LayoutPolicy$Patch, java.lang.String);
  public static final spray.json.JsString $anonfun$repairLayout$5(java.lang.String);
  public static final scala.util.Either $anonfun$repairLayout$6(scala.Option);
  public static final scala.concurrent.Future $anonfun$repairLayout$3(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.AuthenticatedUser, com.helio.services.panels.LayoutPolicy$Patch, boolean);
  public static final scala.concurrent.Future $anonfun$repairLayout$2(com.helio.services.dashboards.DashboardService, com.helio.domain.model.Dashboard, com.helio.services.panels.LayoutPolicy$Patch, java.lang.String, com.helio.domain.model.AuthenticatedUser, scala.collection.immutable.Set);
  public static final scala.concurrent.Future $anonfun$repairLayout$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, com.helio.api.protocols.dashboards.DashboardLayoutPatchPayload, java.lang.String, scala.Option);
  public static final scala.util.Either $anonfun$exportSnapshot$2(scala.Option);
  public static final scala.util.Either $anonfun$exportSnapshot$4(scala.Option);
  public static final scala.concurrent.Future $anonfun$exportSnapshot$3(com.helio.services.dashboards.DashboardService, java.lang.String, scala.util.Either);
  public static final scala.concurrent.Future $anonfun$exportSnapshot$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option);
  public static final scala.util.Either $anonfun$importSnapshot$2(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, scala.Tuple2);
  public static final scala.concurrent.Future $anonfun$importSnapshot$1(com.helio.services.dashboards.DashboardService, com.helio.api.protocols.dashboards.DashboardSnapshotPayload, com.helio.domain.model.AuthenticatedUser, scala.util.Either);
  public static final scala.Tuple2 $anonfun$validateImportPanels$2(com.helio.domain.panels.PanelConfigCodec$CreateConfig, com.helio.domain.model.PanelAppearance);
  public static final scala.util.Either $anonfun$validateImportPanels$1(com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry, com.helio.domain.panels.PanelConfigCodec$CreateConfig);
  public static final scala.util.Either $anonfun$validateImportPanels$3(com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry, java.lang.String, scala.Option);
  public static final scala.concurrent.Future $anonfun$validateImportPanels$5(com.helio.services.dashboards.DashboardService, com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry, com.helio.domain.model.AuthenticatedUser, scala.util.Either);
  public static final scala.concurrent.Future $anonfun$validateImportPanels$4(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, scala.concurrent.Future, com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry);
  public com.helio.services.dashboards.DashboardService(com.helio.infrastructure.persistence.dashboards.DashboardRepository, com.helio.services.auth.AccessChecker, com.helio.services.audit.AuditService, com.helio.infrastructure.persistence.pipelines.OutputRepository, scala.concurrent.ExecutionContext);
  public static final scala.util.Either $anonfun$deleteInternal$2$adapted(java.lang.Object);
  public static final java.lang.Object $anonfun$repairLayout$4$adapted(com.helio.services.panels.LayoutPolicy$Patch, java.lang.String);
  public static final scala.concurrent.Future $anonfun$repairLayout$3$adapted(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.AuthenticatedUser, com.helio.services.panels.LayoutPolicy$Patch, java.lang.Object);
}
```

### Base private list (javap -p, DashboardService) - moved methods were private, not public under a mangled name
```
Compiled from "DashboardService.scala"
public final class com.helio.services.dashboards.DashboardService {
  private final com.helio.infrastructure.persistence.dashboards.DashboardRepository dashboardRepo;
  private final com.helio.services.auth.AccessChecker accessChecker;
  private final com.helio.services.audit.AuditService auditService;
  private final com.helio.infrastructure.persistence.pipelines.OutputRepository outputRepo;
  private final scala.concurrent.ExecutionContext ec;
  public static com.helio.services.audit.AuditService $lessinit$greater$default$3();
  public static scala.util.Either<java.lang.String, scala.runtime.BoxedUnit> validateSnapshotPayload(com.helio.api.protocols.dashboards.DashboardSnapshotPayload);
  private void audit(java.lang.String, scala.Option<java.lang.String>, com.helio.domain.model.AuthenticatedUser, spray.json.JsValue);
  private spray.json.JsValue audit$default$4();
  public scala.concurrent.Future<com.helio.domain.model.PagedResult<com.helio.domain.model.Dashboard>> findAll(com.helio.domain.model.AuthenticatedUser, com.helio.domain.model.Page);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> findById(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.Tuple2<com.helio.domain.model.Dashboard, java.lang.Object>> create(com.helio.services.dashboards.DashboardService$CreateDashboardInput, com.helio.domain.model.AuthenticatedUser);
  private scala.concurrent.Future<com.helio.domain.model.Dashboard> insertNew(java.lang.String, scala.Option<java.lang.String>, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit>> delete(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit>> deleteInternal(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.Tuple2<com.helio.domain.model.Dashboard, scala.collection.immutable.Vector<com.helio.domain.model.Panel>>>> duplicate(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> update(java.lang.String, com.helio.api.protocols.dashboards.UpdateDashboardRequest, com.helio.domain.model.AuthenticatedUser, com.helio.services.panels.LayoutWritePolicy);
  public com.helio.services.panels.LayoutWritePolicy update$default$4();
  private scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> applyUpdate(java.lang.String, com.helio.domain.model.Dashboard, scala.Option<java.lang.String>, scala.Option<com.helio.domain.model.DashboardAppearance>, scala.Option<com.helio.services.panels.LayoutPolicy$Patch>, com.helio.services.panels.LayoutWritePolicy);
  private scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> writeUpdate(java.lang.String, com.helio.domain.model.Dashboard, scala.Option<java.lang.String>, scala.Option<com.helio.domain.model.DashboardAppearance>, scala.Option<com.helio.domain.model.DashboardLayout>);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> repairLayout(java.lang.String, com.helio.api.protocols.dashboards.DashboardLayoutPatchPayload, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.api.protocols.dashboards.DashboardSnapshotPayload>> exportSnapshot(java.lang.String, com.helio.domain.model.AuthenticatedUser);
  public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.Tuple2<com.helio.domain.model.Dashboard, scala.collection.immutable.Vector<com.helio.domain.model.Panel>>>> importSnapshot(com.helio.api.protocols.dashboards.DashboardSnapshotPayload, com.helio.domain.model.AuthenticatedUser);
  private scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit>> validateImportPanels(com.helio.api.protocols.dashboards.DashboardSnapshotPayload, com.helio.domain.model.AuthenticatedUser);
  public static final java.lang.String $anonfun$new$1();
  public static final scala.util.Either $anonfun$findById$1(scala.Option);
  public static final scala.Tuple2 $anonfun$create$2(com.helio.domain.model.Dashboard);
  public static final scala.concurrent.Future $anonfun$create$1(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.services.dashboards.DashboardService$CreateDashboardInput, com.helio.domain.model.AuthenticatedUser, scala.Option);
  public static final scala.Tuple2 $anonfun$create$3(com.helio.domain.model.Dashboard);
  public static final scala.Tuple2 $anonfun$create$4(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, scala.Tuple2);
  public static final scala.util.Either $anonfun$delete$1(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.AuthenticatedUser, scala.util.Either);
  public static final scala.util.Either $anonfun$deleteInternal$2(boolean);
  public static final scala.concurrent.Future $anonfun$deleteInternal$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option);
  public static final scala.util.Either $anonfun$duplicate$2(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option);
  public static final scala.concurrent.Future $anonfun$duplicate$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option);
  public static final scala.concurrent.Future $anonfun$update$2(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.Dashboard, scala.Option, scala.Option, scala.Option, com.helio.services.panels.LayoutWritePolicy, scala.util.Either);
  public static final scala.concurrent.Future $anonfun$update$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option, scala.Option, scala.Option, com.helio.services.panels.LayoutWritePolicy, scala.Option);
  public static final scala.util.Either $anonfun$update$3(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.AuthenticatedUser, scala.util.Either);
  public static final scala.Some $anonfun$applyUpdate$1(com.helio.domain.model.DashboardLayout);
  public static final com.helio.domain.model.DashboardAppearance $anonfun$writeUpdate$2(com.helio.domain.model.Dashboard);
  public static final com.helio.domain.model.DashboardLayout $anonfun$writeUpdate$3(com.helio.domain.model.Dashboard);
  public static final scala.util.Either $anonfun$writeUpdate$4(scala.Option);
  public static final scala.concurrent.Future $anonfun$writeUpdate$1(com.helio.services.dashboards.DashboardService, scala.Option, scala.Option, java.time.Instant, scala.Option);
  public static final com.helio.domain.model.DashboardAppearance $anonfun$writeUpdate$5(com.helio.domain.model.Dashboard);
  public static final com.helio.domain.model.DashboardLayout $anonfun$writeUpdate$6(com.helio.domain.model.Dashboard);
  public static final scala.util.Either $anonfun$writeUpdate$7(scala.Option);
  public static final boolean $anonfun$repairLayout$4(com.helio.services.panels.LayoutPolicy$Patch, java.lang.String);
  public static final spray.json.JsString $anonfun$repairLayout$5(java.lang.String);
  public static final scala.util.Either $anonfun$repairLayout$6(scala.Option);
  public static final scala.concurrent.Future $anonfun$repairLayout$3(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.AuthenticatedUser, com.helio.services.panels.LayoutPolicy$Patch, boolean);
  public static final scala.concurrent.Future $anonfun$repairLayout$2(com.helio.services.dashboards.DashboardService, com.helio.domain.model.Dashboard, com.helio.services.panels.LayoutPolicy$Patch, java.lang.String, com.helio.domain.model.AuthenticatedUser, scala.collection.immutable.Set);
  public static final scala.concurrent.Future $anonfun$repairLayout$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, com.helio.api.protocols.dashboards.DashboardLayoutPatchPayload, java.lang.String, scala.Option);
  public static final scala.util.Either $anonfun$exportSnapshot$2(scala.Option);
  public static final scala.util.Either $anonfun$exportSnapshot$4(scala.Option);
  public static final scala.concurrent.Future $anonfun$exportSnapshot$3(com.helio.services.dashboards.DashboardService, java.lang.String, scala.util.Either);
  public static final scala.concurrent.Future $anonfun$exportSnapshot$1(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option);
  public static final scala.util.Either $anonfun$importSnapshot$2(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, scala.Tuple2);
  public static final scala.concurrent.Future $anonfun$importSnapshot$1(com.helio.services.dashboards.DashboardService, com.helio.api.protocols.dashboards.DashboardSnapshotPayload, com.helio.domain.model.AuthenticatedUser, scala.util.Either);
  public static final scala.Tuple2 $anonfun$validateImportPanels$2(com.helio.domain.panels.PanelConfigCodec$CreateConfig, com.helio.domain.model.PanelAppearance);
  public static final scala.util.Either $anonfun$validateImportPanels$1(com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry, com.helio.domain.panels.PanelConfigCodec$CreateConfig);
  public static final scala.util.Either $anonfun$validateImportPanels$3(com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry, java.lang.String, scala.Option);
  private final scala.concurrent.Future validateOne$1(com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry, com.helio.domain.model.AuthenticatedUser);
  public static final scala.concurrent.Future $anonfun$validateImportPanels$5(com.helio.services.dashboards.DashboardService, com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry, com.helio.domain.model.AuthenticatedUser, scala.util.Either);
  public static final scala.concurrent.Future $anonfun$validateImportPanels$4(com.helio.services.dashboards.DashboardService, com.helio.domain.model.AuthenticatedUser, scala.concurrent.Future, com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry);
  public com.helio.services.dashboards.DashboardService(com.helio.infrastructure.persistence.dashboards.DashboardRepository, com.helio.services.auth.AccessChecker, com.helio.services.audit.AuditService, com.helio.infrastructure.persistence.pipelines.OutputRepository, scala.concurrent.ExecutionContext);
  public static final scala.util.Either $anonfun$deleteInternal$2$adapted(java.lang.Object);
  public static final java.lang.Object $anonfun$repairLayout$4$adapted(com.helio.services.panels.LayoutPolicy$Patch, java.lang.String);
  public static final scala.concurrent.Future $anonfun$repairLayout$3$adapted(com.helio.services.dashboards.DashboardService, java.lang.String, com.helio.domain.model.AuthenticatedUser, com.helio.services.panels.LayoutPolicy$Patch, java.lang.Object);
  private static java.lang.Object $deserializeLambda$(java.lang.invoke.SerializedLambda);
}
```

### Private-list diff base -> head (non-anonfun lines): moved private methods leave, 3 private module fields/accessors arrive, nothing public changes
```
<   private final com.helio.infrastructure.persistence.pipelines.OutputRepository outputRepo;
>   private final com.helio.services.dashboards.DashboardWrites writes;
>   private final com.helio.services.dashboards.DashboardLayoutRepairWrite layoutRepair;
>   private final com.helio.services.dashboards.DashboardSnapshotImport snapshotImport;
>   private com.helio.services.dashboards.DashboardWrites writes();
>   private com.helio.services.dashboards.DashboardLayoutRepairWrite layoutRepair();
>   private com.helio.services.dashboards.DashboardSnapshotImport snapshotImport();
<   private scala.concurrent.Future<com.helio.domain.model.Dashboard> insertNew(java.lang.String, scala.Option<java.lang.String>, com.helio.domain.model.AuthenticatedUser);
<   private scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> applyUpdate(java.lang.String, com.helio.domain.model.Dashboard, scala.Option<java.lang.String>, scala.Option<com.helio.domain.model.DashboardAppearance>, scala.Option<com.helio.services.panels.LayoutPolicy$Patch>, com.helio.services.panels.LayoutWritePolicy);
<   private scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.domain.model.Dashboard>> writeUpdate(java.lang.String, com.helio.domain.model.Dashboard, scala.Option<java.lang.String>, scala.Option<com.helio.domain.model.DashboardAppearance>, scala.Option<com.helio.domain.model.DashboardLayout>);
<   private scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit>> validateImportPanels(com.helio.api.protocols.dashboards.DashboardSnapshotPayload, com.helio.domain.model.AuthenticatedUser);
<   private final scala.concurrent.Future validateOne$1(com.helio.api.protocols.dashboards.DashboardSnapshotPanelEntry, com.helio.domain.model.AuthenticatedUser);
```
