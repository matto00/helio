# Repackage backend main into domain subpackages

## Why

Five flat backend layers hold 244 of 322 Scala files (222 in the four largest), with up to 88 in one directory.
Navigating them means reading long alphabetical lists rather than following structure. `infrastructure/`
alone mixes four unrelated concerns (Slick persistence, blob storage, crypto, an ExecutionContext), and
`com/helio/security/` is an empty package whose README describes code that lives elsewhere.

## What Changes

- Subdivide `services/`, `api/routes/`, `api/protocols/`, and `infrastructure/` by domain; split
  `domain/` root into `model/`, `connectors/`, `engine/`, `util/`. Layer-first is retained.
- Split `infrastructure/` into `persistence/`, `storage/`, `crypto/`, `concurrency/`.
- **Amend HEL-632's "eight fixed domain names" to thirteen.** The eight were fixed when eight covered
  the code; four weeks of shipped work (HEL-341/342/343/418/420/659) added 70 files matching none of
  them. Adding `metrics`, `assistant`, `agents`, `proposals`, `patchsets` preserves the epic's stated
  principle — one grep on a domain name surfaces its whole stack. Absorbing or distributing them
  destroys it. See design.md D1.
- Delete the empty `com/helio/security/` package.
- Add a `README.md` to each created directory stating what belongs there **and what does not**, each
  verified against that directory's actual final contents.
- Update every `import` in the 218-file test tree so `sbt test` stays green.
- Rewrite `api/package.scala`'s 466 relative `protocols.X` alias targets. This is the **only** file in
  the change whose content changes outside `package`/`import` lines — see design.md D5 and the D6
  allow-list, which fails the change on a second difference.
- **Insert** roughly 675 new import lines across ~165 files (an estimate; an independent count says
  507 — the compiler is the authority). A single-clause `package a.b.c` clause does not open `a.b`, so
  every reference that resolved through package scope breaks (design.md D0/D7b). This is the largest
  category of work in the change, and the moment inlining an FQN — or silently switching the file to
  nested package clauses — becomes tempting. Both are forbidden.

## Non-goals

- **No behaviour changes.** Moves, `package` declarations, imports, and READMEs only. No logic edits,
  no signature changes, no type renames, no bug fixes in passing. Bugs found get spinoff tickets.
- **No test-file relocation** — that is HEL-634. This ticket edits test imports only.
- **No file splitting.** `ApiRoutes.scala` (691), `model.scala` (989), `PipelineService.scala` (890),
  `WorkspaceContextService.scala` (847) move intact; they have their own tickets (HEL-760/689/684/678).
- **`ai/`, `email/`, `spark/`, `app/` stay put** — separate top-level packages, not inside the five
  layers being subdivided. A follow-up ticket records the deferred question.

## Capabilities

- **New Capabilities**: none.
- **Modified Capabilities**: none. This change alters no requirement, endpoint, or wire shape. Archive
  with `--skip-specs`.

**Therefore `openspec validate` reports "Change must have at least one delta" — expected, not a defect.**
A behaviour-preserving refactor has no requirement to delta. This is established practice here: 19
archived changes carry no `specs/` directory, including five near-identical structural refactors
(`backend-protocols-split`, `backend-routes-decompose`, `backend-service-layer`, `frontend-feature-folders`,
`frontend-decomp-closeout`), each with proposal + design + tasks and no Capabilities section. Inventing a
spec delta to satisfy the validator would also write into `openspec/specs/`, which HEL-775 currently owns.
Reviewers: confirm the delta is genuinely absent, do not "fix" it.

## Impact

- **257 files mapped**: 244 movers in the five layers, plus `api/` root (12) and `services/layout/` (1).
  143 test files edited, imports only.
- Zero runtime, API, schema, migration or frontend impact — verified, not assumed: no `com.helio`
  reference exists in `backend/src/{main,test}/resources/`, `.github/`, or any `META-INF/services`, and
  `build.sbt`'s `mainClass` names `com.helio.app.Main`, which stays put.
- **Not zero documentation impact.** 10 files under `openspec/specs/` name `com.helio` packages; a few
  reference symbols that move. HEL-775 owns that directory, so the drift is recorded in a spinoff rather
  than fixed here (design.md D11, **HEL-804**). Two hardcoded logger-name string literals are likewise
  left stale on purpose (D9, **HEL-803**) — editing them renames a live log category, a behaviour change.
