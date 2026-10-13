# HEL-1434 measurements (read-only)

Measured 2026-10-12 against the local dev DB (`psql -w -d helio`, peer auth as the OS user; whether the running
backend uses this exact DB could not be confirmed without reading `backend/.env`, which this lane never does) and the
dev uploads root `~/.helio/uploads` (read-only `find`/`ls`; nothing written under `~`). Scratch lists were written to
the session scratchpad only. NOTHING was deleted.

## 1.1 Orphan and missing objects (dev)

Commands:

    psql -w -d helio -Atc "select storage_key from image_uploads union all
      select coalesce(nullif(config->>'path',''),nullif(config->>'filePath','')) from data_sources
      where source_type in ('csv','text','pdf','image')" | sort -u > ref.txt
    (cd ~/.helio/uploads; find csv text pdf image images -type f | sort) > files.txt
    comm -13 ref.txt files.txt   # objects no row references (orphans)
    comm -23 ref.txt files.txt   # rows whose object is missing

Rows: 6 `image_uploads`; 42 file-backed `data_sources` (30 csv, 4 text, 3 pdf, 5 image); 0 legacy `filePath`-only rows
(all 42 carry `config.path`). Objects on disk under the 5 prefixes: 76.

| prefix | orphan objects (no referencing row) | rows whose object is missing |
|---|---|---|
| csv/ | 28 | 3 |
| text/ | 1 | 0 |
| pdf/ | 1 | 0 |
| image/ (image-source) | 1 | 0 |
| images/ (image_uploads) | 0 | 0 |
| total | 31 | 3 |

Other prefixes present but out of scope: `assistant-conversations/` (48 files), `form-uploads/` (5).
The dev DB is shared by every worktree, whose backends may use other uploads roots (`~/.helio/uploads-hel897`,
`-hel945` exist), so "missing" may be objects living in another root, and "orphan" objects are largely test residue.

## 1.2 Stuck queue rows (attempt cap)

The queue table does not exist before V128 is applied. Probe, to run after the migration (cap = 10):

    select count(*) filter (where attempts >= 10) as stuck, count(*) as queued from stored_object_deletions;

## 1.3 Prod procedure (owner runs it; this lane has no prod access)

SQL (read-only, prod DB):

    select storage_key from image_uploads
    union
    select coalesce(nullif(config->>'path',''),nullif(config->>'filePath','')) from data_sources
    where source_type in ('csv','text','pdf','image');

GCS listing (read-only): `gcloud storage ls -r "gs://$HELIO_UPLOADS_BUCKET/{images,csv,text,pdf,image}/**"`, strip the
`gs://bucket/` prefix, sort -u, then `comm -13 refs.txt objects.txt` for orphans and `comm -23` for rows with a missing
object. Any cleanup is by exact key and needs owner approval; this change deletes no historic orphan.

## Migration number note

The shared dev DB already has V127 (`dashboard layout version`, applied 2026-10-12 01:40 by another lane, not yet on
origin/main). This change therefore uses V128.
