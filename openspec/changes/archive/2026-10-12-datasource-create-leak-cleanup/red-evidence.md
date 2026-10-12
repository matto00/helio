# HEL-1494 red-first evidence

Spec: `backend/src/test/scala/com/helio/services/sources/DataSourceCreateFailureCleanupSpec.scala`.
All 8 create paths driven through `POST /data-sources` (sealed `DataSourceRoutes`) with a fault-injected
`DataSourceRepository`, real embedded Postgres (`VerifiedEmbeddedPostgres.start`), `LocalFileSystem` rooted in a
`TempDirectorySupport.newTempDir`. A fresh seeded user per case; rows counted by that exact owner id; stored files
compared by exact path against the kind's listing. Each case first makes one SUCCESSFUL create (guard: its row and file
must survive), then fails the next. URL variants all run through the route: text/pdf/image via a plain localhost HTTP
server (`isBlocked` admits only the hostname `localhost`), csv via a self-signed localhost HTTPS server (https-only).

## RED: unmodified production tree (log: `.concertino/runs/HEL-1494/logs/red-run.log`)

`[hel1468-guard] ScalaTest summary: failed=17 aborted=0 unreadable=0` / `Tests: succeeded 2, failed 17`.
Every path leaked under BOTH faults (no path was found that does not leak). Status was 500 in all 16 (unchanged by the fix).
`rows` = rows of the exact owner after the failed request (1 = only the earlier success; 2 = the failed request's row leaked).

```
path='csv upload' fault='the row insert failing' owner=48c75a20-7ed6-4e52-8d2f-23ef72777025 rows=1(expected 1) leakedFiles=csv/c62473a5-43e0-4f24-8f46-23140e537a48.csv
path='csv upload' fault='the post-insert schema write failing' owner=c1dccca5-93a9-4cf4-8f0c-bd37f0dfd6ad rows=2(expected 1) leakedFiles=csv/693fcffd-9bfd-4c93-a984-04722d6c6999.csv
path='csv URL' fault='the row insert failing' owner=006e00db-b3f1-4913-9226-d3de83a7620a rows=1(expected 1) leakedFiles=csv/8903e488-b7bb-4443-9855-5f07982d7954.csv
path='csv URL' fault='the post-insert schema write failing' owner=1356fcaf-6d05-43ee-a3d6-bde4f2eef8f4 rows=2(expected 1) leakedFiles=csv/0f2e8731-5bc8-4943-afca-b5635535c5ea.csv
path='text upload' fault='the row insert failing' owner=902bfaac-8cb3-4518-9d95-0f8c55bf39ea rows=1(expected 1) leakedFiles=text/dada5817-552f-4603-8015-077cde4e3769.txt
path='text upload' fault='the post-insert schema write failing' owner=6a27a216-cf70-4b39-a4ff-e8ef2bb0cf87 rows=2(expected 1) leakedFiles=text/1ed8eb5d-e3fe-4c40-aabb-60b47d506aa9.txt
path='text URL' fault='the row insert failing' owner=90bb7d83-c9cb-4b0c-918d-ad7bfeb6efba rows=1(expected 1) leakedFiles=text/6f62e707-c3d3-483e-9473-543e4fc23576.txt
path='text URL' fault='the post-insert schema write failing' owner=cc543775-b3da-447a-9c96-0521678b7b2d rows=2(expected 1) leakedFiles=text/75794637-2bde-4493-ba10-5e798c9bed2b.txt
path='pdf upload' fault='the row insert failing' owner=66fd9dcb-65ee-4f91-b6cd-4731293da52c rows=1(expected 1) leakedFiles=pdf/664bcaee-51ab-47a9-9f14-d8469f8945e4.pdf
path='pdf upload' fault='the post-insert schema write failing' owner=e33f5bdc-06b6-40ce-bc83-920a928f4fa6 rows=2(expected 1) leakedFiles=pdf/96d9b61d-fcdf-423b-b17d-f7fe254469ae.pdf
path='pdf URL' fault='the row insert failing' owner=0feccbc6-a898-4cb8-bc4b-e74e5431541b rows=1(expected 1) leakedFiles=pdf/2a7ffd22-e4b9-4cf5-95dd-5407ce08bc70.pdf
path='pdf URL' fault='the post-insert schema write failing' owner=edcd694e-8923-4864-a41f-ed8b1ea893b1 rows=2(expected 1) leakedFiles=pdf/7fefefd3-dae0-4cec-96c1-01389880f154.pdf
path='image upload' fault='the row insert failing' owner=fb9896dc-a614-455d-8245-d0cc98cbb2f5 rows=1(expected 1) leakedFiles=image/5f89c715-08ef-4ebe-b148-9c0fe2f588d3.png
path='image upload' fault='the post-insert schema write failing' owner=bfccd235-0084-43d6-8c5e-a45c43f652c3 rows=2(expected 1) leakedFiles=image/6adf0555-97fc-46ab-acab-74970fb326b7.png
path='image URL' fault='the row insert failing' owner=1135a68a-2cbe-4ea2-8765-a24bf1021c61 rows=1(expected 1) leakedFiles=image/9fda0d2d-6fbf-4505-a33e-432c087dc34e.png
path='image URL' fault='the post-insert schema write failing' owner=e9c8f008-8865-410d-88d4-5d5b69531517 rows=2(expected 1) leakedFiles=image/411ccc0d-d140-46b6-804d-feb63c37f7e7.png
```

Insert-fault: `rows` 1 but `leakedFiles` names the orphaned object (file leaked, no row). Schema-fault: `rows` 2 and
the leaked file (row + file leaked). The two cleanup-failure specs passed pre-fix (they are guards: the original error
surfaces regardless); the GCS spec was RED (`storage.delete` Wanted but not invoked).

## GREEN: fixed tree (log: `green-run.log`)

`[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` / `Tests: succeeded 19, failed 0`. All 16 route cases
leave exactly the earlier success (rows 1, same file set); the two cleanup-failure specs and the GCS spec (exactly one
`storage.delete(BlobId.of("test-bucket", <the path storage.create just received>))`, `verifyNoMoreInteractions`) pass.

## MUTATION (log: `mutation-run.log`)

Compensation neutralized (`Failure(ex)` branch short-circuited to `Future.failed(ex)`): `[hel1468-guard] ... failed=17`,
`Tests: succeeded 2, failed 17` (the 16 route cases + GCS red; the 2 cleanup-failure guards stay green, as pre-fix).
Reverted (byte-identical to the fixed tree).

## Existing affected specs (log: `affected-run.log`)

Cycle 1 ran DataSourceService*, DataSourceRoutesSpec, UploadRoutesSpec, CsvUploadLimitsRoutesSpec, GcsFileSystemSpec,
SourceCreatePostInsertCleanupSpec, `com.helio.services.sources.DataSourceDelete*` (which did NOT include
`DataSourceDeleteAutoConnectorRoutesSpec`, in the routes package), *FirstRun*, plus the new spec: 338 succeeded. The cycle-2
run (`cycle2-affected-run.log`) uses `*DataSourceDelete*` and so includes it.

## Cycle 2: the "file delete throws" guard now proves the delete was reached

Evaluator CR1: the guard passed under mutation M1 (file-delete step removed) because it only checked the original error surfaced.
It now clears `fs.deleted`, then asserts exactly one recorded delete attempt, that it starts with `text/`, that it is not in
the pre-request listing (a path this request wrote), that the throwing delete left exactly that file in place, that
`"boom: insert"` still surfaces and the owner has 0 rows. The row-delete guard also asserts `repo.deleteCalls == 1`.

- Unmutated (`cycle2-green-run.log`): `[hel1468-guard] failed=0`, `Tests: succeeded 19, failed 0`.
- M1 (`Future.unit` in place of the file-delete step; `cycle2-m1-run.log`): `[hel1468-guard] failed=18`, `succeeded 1`; the
  "file delete throws" guard is among the FAILED (it was green under M1 in cycle 1, where failed=17). Reverted.
- Cycle-2 affected set incl. `*DataSourceDelete*` (`cycle2-affected-run.log`): `failed=0`, `Tests: succeeded 339, failed 0`.
