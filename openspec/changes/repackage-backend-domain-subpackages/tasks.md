# Tasks — Repackage backend main into domain subpackages

### Backend — baselines (capture BEFORE any move; this is the verification evidence)

- [x] Snapshot base SHA to `baseline/base.txt`; all D6 comparisons run against `git show <base>:<path>`
- [x] Save D6's awk **program body** (not the fenced header, not wrapped in `awk '…'`) to `baseline/filter.awk`; invoke as `awk -f baseline/filter.awk <file>`
- [x] Self-check the filter TWO-SIDED over all 540 `.scala` files — a one-sided check is what let a filter that ate 497 lines of real code pass review: (i) 0 residual `import` lines remain, AND (ii) for every file, `wc -l` minus kept-lines equals exactly the number of lines belonging to a `package`/`import` statement, so it removes nothing else
- [x] Assert (ii) explicitly on the three package objects: `api/package.scala` 381→380 kept, `domain/package.scala` 115→114, `domain/panels/package.scala` 33→31. If any body is missing, STOP — the gate is blind, and it fails toward PASS
- [x] Do not add or remove blank lines in or around any import block; the filter preserves them, so reflowing one fails D6 on an otherwise-correct file
- [x] Record `check-scala-quality.mjs` warned-file basenames (expect exactly 128) to `baseline/quality.txt`
- [x] Record `sbt test` green + total test count to `baseline/tests.txt` on the untouched tree
- [x] Record the union of base-tree and worktree `.scala` paths — D6's iteration domain (D6)

### Backend — mapping (drives moves, rewrites, READMEs, and the D6 gate)

- [x] Write `mapping.tsv` (old path, new path, old FQN, new FQN) covering **257** files
- [x] Assert per-root coverage: services 88, api/routes 48, api/protocols 46, infrastructure 40, domain root 22, api root 12, services/layout 1
- [x] Assert every target is one of the 13 domains (design.md Context), one of the structural directories (`domain/{model,connectors,engine,util}`, `infrastructure/{persistence,storage,crypto,concurrency}`, `api/http`), or a named shared/root file
- [x] Record the 4 non-movers that must still be edited: `api/package.scala`, `domain/panels/package.scala`, `api/ApiRoutes.scala`, `api/JsonProtocols.scala` (D8)
- [x] Assert STAYS-PUT: `domain/package.scala`, `api/{ApiRoutes,JsonProtocols,package.scala}`, `services/ServiceError.scala`, `api/routes/ServiceResponse.scala`, `api/protocols/{IdParsing,PaginationProtocol,ResourceProtocol}.scala`

### Backend — per-layer loop (D10). For EACH layer below, in order:

`git mv` from the mapping → rewrite **every import in `backend/src` naming a symbol this layer moved,
wherever it lives** (not just the moving layer's own files) → insert the imports D0 now requires →
`sbt Test/compile` green → **run the full D6 gate** → commit. Never inline an FQN; never add a second
`package` clause (D0.2).

Run D6 at the end of EVERY layer, not only at the end: it costs ~0.7s across all 540 files, and the
alternative is discovering a gate failure 250 files deep, where the strongest temptation in the whole
change is to widen the allow-list — which D6 forbids by name. The most likely benign trigger is a blank
line added or removed around an import block.

- [x] **Layer 1 `domain/` root** → `domain/{model,connectors,engine,util}/`; `package.scala` stays at root (D5). Prerequisite in this step: add the `DataTypeId`/`MetricId` import `domain/panels/package.scala` now needs (D5) — green is unreachable without it. Fan out `import com.helio.domain._` across **141 files** (68 main / 73 test) — the single largest rewrite in the change. Expect ~16 files / 95 insertion sites.
- [x] **Layer 2 `infrastructure/`** → `infrastructure/{persistence/<domain>,storage,crypto,concurrency}/`, `Database`/`DbContext` at `persistence/` root (D3). Expect ~34 / 82.
- [x] **Layer 3 `services/`** → `services/<domain>/` incl. `layout/PanelPacker.scala` → `panels`; `ServiceError.scala` stays at root. Expect ~58 / 367, of which ~47 are `ServiceError` itself.
- [x] **Layer 4 `api/protocols/`** → `api/protocols/<domain>/`; `IdParsing`/`PaginationProtocol`/`ResourceProtocol` stay at root. Prerequisites in this step: rewrite `api/package.scala`'s **466** relative `protocols.X` alias targets (D5), and expand `api/JsonProtocols.scala:3`'s `import com.helio.api.protocols._` so all **39** mixins still resolve (D8). Expect ~18 / 92.
- [x] **Layer 5 `api/routes/`** → `api/routes/<domain>/`; `PipelineRunRegistry` → `pipelines`; **`ServiceResponse.scala` stays at `routes/` root** (D3). Prerequisite in this step: fan out `ApiRoutes.scala:12`'s `import com.helio.api.routes._` across the 13 route subpackages (D7a). Expect ~39 sites, almost all the **40** files needing a new `ServiceResponse` import.
- [x] **Layer 6 `api/` root**: the **9** files that move → `api/http/` (`AccessCheckerImpl`, `AclDirective`, `AuthDirectives`, `CookieConfig`, `RequestValidation`, `ResourceType`, `ResourceTypeRegistry`, `TraceContextDirective`, `TopLevelErrorHandlers`); `ApiRoutes`/`JsonProtocols`/`package.scala` stay. Also rewrite `ApiRoutes.scala`'s explicit lists (services 44 names, infrastructure 30) and add its `api.http` imports.
- [x] **Layer 7** delete `com/helio/security/`; confirm `rg 'com\.helio\.security'` returns nothing; commit

### Backend — rewrite mechanics that apply throughout the loop

- [x] Fan out braced imports **statement-oriented, not line-oriented**: 240 main / 216 test opening lines, of which 41 main / 18 test are MULTI-LINE with names on continuation lines (D7a)
- [x] Rewrite the 43 indented, scope-local `com.helio` imports (0 main / 43 test); a `^import`-anchored pass skips all of them
- [x] Leave `AuthoringTelemetry.scala:33` / `AssistantTelemetry.scala:29` logger strings UNCHANGED (D9)

### Backend — READMEs (~50 new directories; budget it, do not leave it to the end)

- [x] Enumerate the created directories from `mapping.tsv` (~50) and write a `README.md` in each: what belongs there AND what does not
- [x] Verify each README by `ls`-ing that directory's actual final contents — never write it from the plan
- [x] Do not claim the split creates encapsulation: 117 `private[services]` members stay mutually reachable
- [x] Update `api/README.md`, `infrastructure/README.md`, `app/README.md` if the moves make their text wrong

### Tests

- [x] Rewrite imports in the 143 test files carrying a `com.helio` import, from the same `mapping.tsv`
- [x] Fix the **35** test files with ZERO `com.helio` imports that still break (D4): domain 16, services 6, infrastructure 5, api/protocols 4, api/routes 1, api 3
- [x] Cover the mixin case explicitly — e.g. `class PatchSetProtocolSpec … with PatchSetProtocol`; the dependency is in the `extends` clause, not an import
- [x] Treat "every test file that fails to compile" as the authoritative surface; the counts above are budgeting aids
- [x] **D6 primary gate:** over the union of base and worktree `.scala` paths (movers old→new, non-movers same→same), both sides passed through `baseline/filter.awk` are byte-identical
- [x] **Assert every file's `package` declaration matches its directory** — for each `.scala` under `backend/src/{main,test}/scala/`, the declared package must equal the directory path with `/`→`.`. D6 masks `package` lines by construction and the compiler cannot see this either (consumers import the same FQN from `mapping.tsv`), so a mapping row whose new-path and new-FQN disagree would ship green while silently defeating the entire point of the ticket
- [x] D6 allow-list is exactly 1 file (`api/package.scala`) + added READMEs; a second difference fails the change
- [x] Verify the allow-listed file: `sed -E 's/protocols\.[a-z]+\./protocols./g'` on the new `api/package.scala` is byte-identical to the base file (D6)
- [x] Assert HEL-634 boundary: `git diff --name-status backend/src/test/` shows only `M`, zero `A`/`D`/`R` (D4)
- [x] `sbt test` green; test count identical to `baseline/tests.txt`
- [x] Quality warned-basename **set**-equivalent to `baseline/quality.txt`, EXCEPT files crossing the 250-line soft budget purely via added imports — record those with line arithmetic and do NOT "fix" them (D6). Watch `DashboardRepository.scala` (243) and `MetricRepository.scala` (246)
- [x] Confirm no inline FQNs introduced, and that `grep -c '^package '` is exactly 1 for every `.scala` file (D0.2)
- [x] Merge `origin/main` (CON-129), then re-run: `sbt Test/compile`, `sbt test`, D6 gate, quality set-diff
- [ ] After the squash exists, verify `git log --follow` traces a moved file; escalate before merge if not (D10)
