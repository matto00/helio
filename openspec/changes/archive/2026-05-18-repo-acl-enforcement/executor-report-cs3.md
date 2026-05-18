# Executor Report — HEL-265 CS3 (DataType + DataSource ACL enforcement)

## Summary

CS3 closes the DataType and DataSource ACL gaps (HEL-256, HEL-268, HEL-242).
Every public read on `DataTypeRepository` and `DataSourceRepository` is now
owner-scoped by default; the privileged unscoped variants are renamed to
`*Internal` with documented callers.

## Files changed

11 main sources + 10 test files + 1 new test file + openspec bookkeeping.
See `files-modified.md` for the full annotated list.

## Test counts

- Before CS3: 652 backend tests
- After CS3:  676 backend tests (+24 new in `DataTypeDataSourceAclSpec`)
- All 676 pass. 4 existing `ApiRoutesSpec` tests updated from 403→404 assertion
  (design change: owner-scoped repo returns NotFound, not Forbidden).

## Verification gates

| Gate                        | Result |
|-----------------------------|--------|
| `sbt scalafmtCheck`         | Pass (pre-existing deprecation warnings only) |
| `sbt test`                  | 676/676 pass |
| `npm run lint`              | Pass (zero warnings) |
| `npm run format:check`      | Pass |
| `npm test`                  | 674 frontend tests pass |
| `npm run build`             | Pass |
| `npm run check:openspec`    | Pass |
| `npm run check:scala-quality` | Pass (23 soft warnings, all pre-existing) |

## Notable design decisions

**`findByIdOwned` vs `findByIdInternal` naming** — parallel to `PipelineRepository`
pattern from CS2. The `*Internal` suffix is a code-search-friendly marker;
the privileged callsite list is documented in comments at each callsite.

**`DataTypeService.accessChecker` removed** — CS3 moves the ACL check entirely
into the repo layer, making the `AccessChecker` dependency on `DataTypeService`
and `DataSourceService` redundant. Removed cleanly; `ApiRoutes` and test
constructors updated.

**`existsBoundToAnyOwnedPanel`** — the new owner-scoped version of the old
`isBoundToAnyPanel`. Cross-user panel bindings (another user's panel bound to
the same type) are intentionally excluded from the count — the caller can only
conflict with their own panels.

**`checkSourceLink` uses `findByIdInternal`** — this reads the source name for
an error message shown to the user who already owns the DataType. This is
error-message rendering only; no source data is returned. Documented at the
callsite.

**`SourceService.refresh/preview`** — previously had a manual `source.ownerId
!= user.id` guard that returned `Forbidden`. Replaced with `findByIdOwned`
which returns `None → NotFound`. Consistent with the 404-not-403 convention.

**`GET /api/data-sources/:id` does not exist as a route** — the task description
listed this endpoint, but the route surface only has `PATCH` and `DELETE` for
`/data-sources/:id`. The ACL test covers the list endpoint (`GET /data-sources`)
which is already owner-scoped, plus the actual endpoints (PATCH, DELETE,
refresh, preview) that did exist. Noted here as a potential gap for CS5 cleanup.

**JoinStep and SparkJobSubmitter use `findByIdInternal`** — the right-side join
source in a JoinStep may legitimately belong to a different user. This is the
cross-user join spinoff explicitly noted in design.md Q1. The privileged read
is appropriate here; the pipeline ACL is the authoritative gate.

## Deferred work (spinoffs)

- Cross-user `JoinStep.rightDataSourceId` ACL — the right-side source of a join
  can belong to any user. This is intentional (per design.md Q1) but should be
  tracked as a separate follow-up (HEL-270 or new ticket).
- `GET /api/data-sources/:id` (single-source GET) — does not appear to exist
  as a route. CS5 cleanup should audit whether it's needed.
- Dashboard/Panel ACL enforcement — CS4 (next sub-PR).
- RLS layer — design.md deferred follow-up.
