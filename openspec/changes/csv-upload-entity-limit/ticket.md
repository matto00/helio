# HEL-1221: CSV upload limits: infer route returns 500 near/over Pekko's 8 MiB entity cap while CsvUrlFetch allows 50 MiB

## Description
Pekko HTTP's default `max-content-length` (8 MiB, no override in application.conf) bounds the whole multipart entity on `POST /api/data-sources/infer` and `POST /api/data-sources`. (1) An upload between 8 and 50 MiB (CsvUrlFetch.maxFileSizeBytes = 50 MiB, which the route-level check and URL ingestion allow) fails, and the infer route returns 500 instead of 413. (2) A file within the multipart envelope overhead of 8 MiB passes the drop zone's client check (`CSV_UPLOAD_MAX_BYTES = 8 MiB` in `frontend/src/features/sources/utils/csvSourceCreate.ts`) and still 500s with a generic message plus a futile Retry (the exact-edge test at FirstRunDropZone.test.tsx ~196 enshrines the faulty boundary).

Fix options: raise/set the entity limit consistently with CSV_MAX_FILE_SIZE_BYTES (and keep the route-level 413), map entity-too-large to a 413 ErrorResponse, and give the client constant a safety margin or derive it from one source of truth.

## Owner ruling (2026-10-03, binding)
- 50 MiB entity limit on the CSV upload routes ONLY (e.g. `withSizeLimit`): `POST /api/data-sources/infer` and `POST /api/data-sources`. Do not change the global default. Enumerate every multipart CSV upload route from the code (first-run drop zone may post elsewhere).
- Map entity-too-large to a clear 413 `ErrorResponse`, never a 500.
- Derive frontend `CSV_UPLOAD_MAX_BYTES` and the backend limit from ONE source of truth, leaving margin for multipart overhead. Fix the drop zone's exact-edge test.
- Check memory: instances are 1 GiB. Measure heap use for a few concurrent ~50 MiB uploads through infer and create. If concurrent 50 MiB uploads could OOM a 1 GiB instance, ESCALATE with numbers instead of shipping.

## Acceptance Criteria
- Red first: an 8-50 MiB upload on main gets a 500, and a near-8-MiB one gets a 500.
- Green: up to 50 MiB succeeds; over 50 MiB gets a 413 with a clear message.
- The frontend shows the 413 clearly, with no futile Retry. Live check in both themes against the RUNNING app.
