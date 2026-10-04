# Executor notes -- HEL-1258

## Design claims corrected against the live tree
- Design D8 says mutating the owned-id predicate ("drop the owner_id predicate in the owned-id read") goes red. On the
  NOBYPASSRLS app pool it does NOT: `data_sources` RLS already scopes to the owner, so the explicit `owner_id` predicate
  is defence in depth (same as `findAll`). It goes red only when the predicate is dropped AND the read leaves RLS
  (privileged pool) -- see MUT-B2. Recorded honestly rather than claiming the plain predicate drop is covered.
- Design D7 grep-first caveat held: `SidebarBody` still needs `pipelines` for the pipelines section; only the sources-branch
  `fetchPipelines` dispatch was removed.
- Frontend path is `frontend/src/features/sources/...` (not the design's shorthand); the preloaded-state literals needing
  `references`/`referencesStatus` were 6 test files + `test/renderWithStore.tsx`.

## Mutation evidence (C1), run on `DataSourceReferenceGuardNonSuperuserSpec` (app pool NOSUPERUSER NOBYPASSRLS)
Baseline: 30/30 green (26 pre-existing + 4 new 7.x cases).
- MUT-A finder in user context (`ctx.withUserContext(viewerId)` instead of `withSystemContext`): red -- 15 failures incl. new
  `7.2` (hidden counts vanish) and `7.3` (granted not named); pre-existing 6.2x/6.3x also red. Restored -> green.
- MUT-B owner predicate dropped from `findOwnedIds`, user context kept: 30/30 GREEN (RLS alone scopes the read; see above).
- MUT-B2 owner predicate dropped AND privileged read: red -- `7.1` (owned-id read returns a stranger's source) and `7.4`
  (foreign referenced source appears in items). Restored -> green.
- MUT-C pipeline visibility predicate forced true (`true OR p.owner_id = viewer ...`, i.e. hidden names reach the route body):
  red -- new `7.2` fails on "no hidden id/name in the serialised body" (15 failures total incl. 6.x). Restored -> green.
All mutated files restored (finder not in `git diff`); the superuser-pool `DataSourceRoutesSpec` is unaffected by MUT-A/C
by construction (superuser bypasses RLS), which is why 7.x live on the app pool.
Frontend mutation: `referenceCounts` ignoring hidden counts -> 5 tests red (sourceReferences x3, SourceListTable hidden,
SidebarBody hidden); restored -> green.

## Gates (final)
- `nice -n 19 sbt testFull`: 5596 passed, 0 failed (`sbt --client shutdown` run separately).
- `npm test` (2 workers): 413 suites / 4291 tests passed. `npm run lint`, `format:check`, `typecheck` clean.
- `check:schemas` (schema in sync), `check:openspec`, `check:scala-quality`, `check:tokens` clean.

## Live check (task 3.6), worktree ports 6690/9597, matt@helio.dev, light then dark
Seeded by exact id in the shared dev DB: join-only source (referenced only by a join secondary input), form-only source
(referenced only by a form panel), unused source, a base source + pipeline. `/sources` "Used by": join-only "1 pipeline",
form-only "1 form panel", base "1 pipeline", unused "Unused" -- in BOTH themes. Sidebar Delete on the form-only source:
"1 form panel references this source, so deleting it will be refused until you remove that reference." in both themes
(screenshots reviewed; existing typography/colour, legible in light and dark). All seeded rows deleted by exact id
(0 residue verified); servers stopped; scratch files removed.

## Query count
`findReferenceSummaries` = 1 owned-id read (user context) + 3 finder queries (privileged) = 4, independent of N.
Not N+1. (Reviewer note from design gate: the finder's strpos OR-prefilter scales with global step count x owned sources;
finder reused unchanged.)

## Notes / spinoff candidates
- No migration; V115 not claimed.
- `getByRole("cell")[3]` in a test relies on column order; acceptable.
