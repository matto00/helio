## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed at `3468f7ed`. Base for all comparisons: `3596b161` (backend tree hash
`ccff8c85facc`, identical at `29fc0528` / `3596b161` / `649f1490`). Backend-only change;
no dev servers started and no Playwright run, per scope — there is no UI surface.

Everything below was re-derived by me, in this worktree, from my own commands and my own
builds. I read the executor's and evaluator's reports only to know what to attack. Where I
reproduce one of their numbers, I wrote my own implementation of the check rather than
re-running theirs.

---

### What I verified (with evidence)

#### 1. Content identity — my own D6 implementation, not `baseline/filter.awk`

I wrote an independent statement-oriented filter (Python; separate `package`/`import`
rules, multi-line braced-import consumption) and iterated the **union** of base and
worktree `.scala` paths, movers old→new through `mapping.tsv`:

```
base .scala: 540   worktree .scala: 540
mapping rows: 257 of which moves: 248
compared: 540
content differences: 1   -> backend/src/main/scala/com/helio/api/package.scala
missing: 0    orphans: 0    base masked lines: 5649
```

Exactly the allow-listed file, nothing else. The masked-line total (5,649) also matches
the figure design.md D6 recorded when the filter was adopted, from a different
implementation — two independent implementations, same spec, same result.

Allow-list check re-run myself: `sed -E 's/protocols\.[a-z]+\./protocols./g'` on the new
`api/package.scala` is **byte-identical** to the base file. 466 `protocols.` occurrences in
both; 457 now carry a domain segment across 11 subpackages, the other 9 are
`ErrorResponse`/`HealthResponse`/`ResourceMetaResponse`, which genuinely stay at
`api/protocols/` root in `ResourceProtocol.scala`.

#### 2. Every changed Scala line is a `package`/`import` line — checked over the WHOLE diff

The evaluator proved this for the cycle-2 diff only. Over `origin/main...HEAD`, excluding
the allow-listed `api/package.scala`: **733** changed lines are not `^import`-prefixed, and
every one is a continuation line (a selector or a closing `}`) of a multi-line braced
import being collapsed — **all deletions**. Added lines that are neither `package` nor
`import`: exactly **one blank line**, in
`infrastructure/persistence/dashboards/DashboardRepository.scala`, matched by one blank-line
deletion in the same file (a blank separator moving inside the import block). Net zero;
D6 confirms that file identical.

#### 3. The decisive check, rebuilt from scratch by me

I extracted the base tree with `git archive` into a scratch dir (no worktree registered),
compiled it (`sbt compile Test/compile`, exit 0), and compared constant pools class-by-class
against this worktree's build:

```
base classes: 2411   new classes: 2411   (2059 main + 352 test, both trees)
unmatched base keys: 0   unmatched new keys: 0
paired classes: 2411     compared: 2411
classes differing in referenced com.helio internal-name set: 0
```

Two things make this stronger than a name-normalised comparison. First, I found by census
that the entire main tree has **exactly one** simple-name collision — `ResourceType`,
declared in *both* `com.helio.api.http` (was `com.helio.api`) and `com.helio.domain.model`
(was `com.helio.domain`), **both of which this change moves**. That is the one place an
import rewrite could silently re-resolve a name while still compiling. I resolved the pairing
by source-declaration evidence (`api/http/ResourceType.scala:11` ↔ base
`api/ResourceType.scala:11`; `domain/model/model.scala:71` ↔ base `domain/model.scala:71`)
rather than by basename, and the reference sets still match exactly. Second, I hand-traced
the resolution for every main file that references `ResourceType`: `ApiRoutes` had it via
same-package scope and now via `import com.helio.api.http._` with `domain.model` imported
*explicitly* (no wildcard) — same entity; `ResourceTypeRegistry` resolves via same-package
scope in both trees; `PermissionService`/`PipelinePermissionService` shadow it with a local
`private val ResourceType = "dashboard"`/`"pipeline"` `String`.

#### 4. `sbt test`, run by me on this tree

`3346 tests / 212 suites, 0 failed`, exit 0 — byte-identical to `baseline/tests.txt`.

#### 5. Gates, all run by me

`check:repo-integrity`, `lint`, `typecheck`, `format:check`, `check:schemas`,
`check:spec-structure`, `check:openspec`, `check:openspec:selftest` — all exit 0.
`npm test` — 254 suites / 2751 tests passed. `check:scala-quality` — clean, **129** soft
warnings.

Warned-**set** delta re-derived by me from `baseline/quality.txt` (128 basenames):

```
ADDED   AlertEventStateMachineSpec, ApplyProposalSpecBase,
        DashboardAuthoringRoutesSpec, PanelCapabilityServiceSpec
REMOVED ApiRoutesCorsErrorHandlingSpec, SparkJobSubmitter, UploadRoutesSpec
128 + 4 - 3 = 129
```

Exactly the composition `baseline/quality-deltas.md` claims after its NB-1 correction.

#### 6. Structure

- 248 git-detected renames == 248 `old != new` rows in `mapping.tsv`.
- Test tree: **179 paths, all `M`** — zero `A`/`D`/`R`. HEL-634 boundary intact.
- Package/directory agreement: **540/540**, 0 mismatches, and every file has exactly one
  single-clause `package` declaration (0 nested clauses — D0.2 intact).
- Root-file ACs: `services/` holds only `ServiceError.scala`; `api/routes/` only
  `ServiceResponse.scala`; `api/protocols/` only `IdParsing`/`PaginationProtocol`/
  `ResourceProtocol`; `infrastructure/` no `.scala` at all; `persistence/` root only
  `Database`/`DbContext`; `api/` root only `ApiRoutes`/`JsonProtocols`/`package.scala`;
  `domain/` root only `package.scala`.
- `com.helio.security` **and** `com/helio/security` both return nothing repo-wide; the
  directory is gone.
- `git log --follow` traces moved files on the branch (`domain/model/model.scala` back to
  `190570d4 Initial commit`; `persistence/pipelines/PipelineRepository.scala` back to
  `db02715d HEL-179`).
- No inline FQNs: zero `com.helio.<lowercase>` on any added non-`import` line in the diff.
- D7(c): only `domain/shapes/{SingleRowShape,TimeSeriesShape}.scala` still carry a
  multi-line braced `com.helio` import, and I confirmed both are byte-identical to base
  (untouched, not merely unlisted).
- `domain/package.scala` is **untouched** and all 102 alias targets are `steps.` — so
  `domain/README.md`'s "re-exports nothing from model/connectors/engine/util" is true.
  `domain/panels/package.scala` carries exactly the one predicted added import.

#### 7. The repo gate that the move could have silently gutted — checked

`scripts/check-schema-drift.mjs` reads `api/protocols/` with `readdirSync`. Under the split
a flat read would see **3** files instead of 46, leaving the gate near-vacuous while still
exiting 0. The executor added `{ recursive: true }`. I verified the arithmetic directly:
`flat .scala: 3, recursive .scala: 46`, and the gate reports `66 checked across 47 protocol
files, 7 panel-type surfaces`. Non-vacuous.

#### 8. READMEs — audited, not sampled

- 67 READMEs; **60 newly created directories, 60 READMEs, 0 missing** (computed from the
  base-vs-worktree directory set difference).
- `Holds:` set equality against actual `.scala` basenames for all 52 that carry one:
  **0 mismatches in either direction**. The 15 without a `Holds:` line are structural/root
  READMEs; I read all 15 and each names every `.scala` in its own directory correctly.
- Backticked path references: 111 total, **0 genuinely unresolvable** (7 flagged by my
  resolver, all false positives — 6 resolve relative to a sibling parent, and the seventh is
  `services/hooks/README.md` correctly asserting that `infrastructure/persistence/hooks/`
  does *not* exist).
- Load-bearing claim spot-checked: the "calls repositories, never `db.run` directly" line
  appears in all 13 services READMEs — **0 `db.run` call sites exist anywhere under
  `services/`**. `HookTriggerService` does import exactly `PipelineRepository` and
  `PipelineRunRepository` from `persistence/pipelines/`, as its README now says.
- `api/protocols/README.md`'s "~39 direct mixins" and `domain/README.md`'s "~51 step/config
  types" both check out.

#### 9. What falls outside BOTH D6 and the bytecode check — answered concretely

D6 is blind to `import` lines by construction; the bytecode check sees resolved symbol
references. The gap is (a) string literals, (b) compiler-generated name strings, (c)
everything outside `backend/src`. I checked all three:

- **Source string literals** naming `com.helio`: in `main`, exactly the two D9/HEL-803
  logger names (`services/proposals/AuthoringTelemetry.scala:33`,
  `services/assistant/AssistantTelemetry.scala:29`). No third case. **New finding:** there
  are also **12 matching literals in the test tree** —
  `AuthoringTelemetrySpec.scala` (×7) and `AssistantTelemetrySpec.scala` (×5) call
  `JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry"/"...AssistantTelemetry")`.
  They are correct *today* precisely because the logger names were left stale. HEL-803 must
  change main and test together or those 12 assertions break. (The 4 further hits in
  `StructuredJsonLoggingSpec` are fictional `com.helio.example`/`com.helio.plain` names.)
- **Compiler-generated dotted class names in bytecode**: 26 base-only / 26 new-only,
  a clean 1:1 through the package rename. I opened the constant pools and confirmed every
  one sits inside a Slick `getDumpInfo` `"Fast Path of (…).mapTo[…]"` debug string
  (`slick/util/DumpInfo` adjacent in the pool) — internal diagnostics, never on the wire,
  never persisted. Test classes: **0** dotted-string differences.
- **Resources / `.github` / `META-INF`**: zero `com.helio` anywhere. Confirmed.
- **Repo-wide docs/tooling**: enumerated every file outside `backend/src` carrying a
  `com.helio` reference (44 files). Stale ones are listed in NB-3 below — NB-4 of
  `evaluation-2.md` caught 5 of them and missed 2.

#### 10. Base has moved since the gates ran

`origin/main` is now `06cdc1b8` (`HEL-635`, frontend-only), one commit past the merge-base
`649f1490`. I computed the intersection of its changed file set with this change's: **empty**,
and `origin/main:backend` still hashes to `ccff8c85facc` — the same backend tree D6 was run
against. So CON-129's "re-run the gates if main moves" is satisfied by inspection here; the
Delivery merge is clean and carries no backend risk.

---

### The two placement judgments I was asked to rule on

#### `HealthRoutes.scala` at `api/routes/workspace/` — my independent view: `api/routes/` root is the better home, but this does not block

I did not accept the README's reasoning. Findings:

1. `/health` is mounted at `ApiRoutes.scala:514`, **outside** `pathPrefix("api")` and
   outside the CSRF / scoped-token / auth directives — every other one of the 48 route
   classes lives inside that prefix. It is process liveness, not a workspace-scoped resource.
2. `HealthRoutes` delegates to **no** service and uses **no** `ServiceResponse`; it completes
   inline with `HealthResponse(status = "ok")`. It has no service and no repository, so it
   has no "stack" for the epic's grep principle to surface — filing it in `workspace` only
   adds noise to that domain's grep (1 of that directory's 2 files).
3. Its protocol counterpart, `HealthResponse`, stays at `api/protocols/` **root** (inside
   `ResourceProtocol.scala`, a named stay-put shared file). Root↔root is already the
   established treatment for this endpoint; workspace↔root is asymmetric. Nobody in the
   chain has made this argument, and I think it is the strongest one.
4. The README's stated dichotomy — "rather than inventing a 14th category" — omits the third
   option. `api/routes/` root already exists and already holds a domain-agnostic file
   (`ServiceResponse.scala`), so placing `HealthRoutes` there invents nothing.
5. Empirically, 47 of 48 route classes are name-predictable from their directory
   (`Alert*`→alerts, `Pipeline*`/`DataType*`→pipelines, `PatchSet*`/`Refinement*`→patchsets,
   …). `HealthRoutes` is the **sole** exception in the whole routes tree.

Against: `api/routes/README.md` states a clean counter-invariant — "every route class belongs
under one of the 13 domain subdirectories" — which moving `HealthRoutes` to root would break.
The two invariants cannot both hold without a 14th category. The choice is genuinely a
toss-up between two defensible rules, it has zero behavioural consequence, and the directory's
own README names the compromise honestly rather than hiding it (which is the epic's failure
mode inverted, as the orchestrator said). Blocking a 257-file, provably-behaviour-identical
change to re-run `sbt test` + D6 + 10 gates over one file's directory would be gate theatre.

**Verdict on this item: recommend, do not require.** If the PR reviewer moves it, it is
`git mv` + package clause + one `import com.helio.api.routes.HealthRoutes` in `ApiRoutes.scala`
+ one `mapping.tsv` row + edits to `api/routes/README.md` (drop "no other file lives directly
here") and `api/routes/workspace/README.md`.

#### `TotpSupport.scala` at `infrastructure/persistence/auth/` — weaker than the `HealthRoutes` call, same conclusion

This one is the more clearly-off of the two and the evaluator was right to flag it. Measured:
`TotpSupport` contains **zero** `db.run`/Slick references, its only consumer is
`services/auth/MfaService`, and it is structurally identical to `TokenHashing` — which sits in
`infrastructure/crypto/`. It is a pure RFC 6238 primitive filed in a package whose own README
opens "Slick repositories, split by domain". The placement's stated justification —
"HEL-633's target layout enumerates this directory's contents as `TokenHashing` only" — is
weak, because design.md D3 overrode that same stale ticket layout five times on reasoning.
The tell is that `infrastructure/crypto/README.md` has to carry an apologetic paragraph
explaining why its sibling primitive lives elsewhere.

Same disposition: documented in both directories' READMEs, zero behavioural consequence,
one `git mv`. Recommend, do not require.

---

### Does the change achieve HEL-632's stated goal? Tested, not assumed

Run against the real tree:

```
find . -path '*alerts*'  -> 9 files: 2 routes, 2 protocols, 3 services, 2 repositories
find . -path '*patchsets*' -> 29 files: 3 routes, 5 protocols, 20 services, 1 repository
find . -path '*metrics*' -> 4 files, one per layer
```

The claim holds for the four layers that were flat, which is where 222 of the 244 movers
were. Per-domain census across routes/protocols/services/persistence is coherent in all 13
domains, and I found no domain that is a junk drawer: the largest, `patchsets` (29), is a
single named subsystem, and `workspace` (11) is genuinely cross-domain search/context/teardown.

**One honest limit worth naming for the PR reviewer**, which is HEL-632's own design and not
a defect of this change: `domain/` is split by *kind* (`model`/`connectors`/`engine`/`util`),
not by domain. So a directory-name grep on `alerts` surfaces 9 files, where a *symbol*-name
grep on `alert` in the base tree surfaced 10 — it misses
`domain/engine/AlertEventStateMachine.scala` and the alert types inside
`domain/model/model.scala`. The four flat layers are now navigable by domain; the domain layer
is not, by instruction. `domain/engine/README.md` names `AlertEventStateMachine` explicitly,
so nothing is hidden — but `services/alerts/README.md` gives no pointer to it (NB-4).

---

### Acceptance criteria — traced

| AC (ticket.md) | Verdict | Evidence |
|---|---|---|
| `sbt test` green; test diff limited to `package`/`import` lines | **MET** | My run: 3346/212, 0 failed. D6 covers the test tree (all 540 files, incl. 179 test paths); only non-import changed lines in the whole diff are braced-import continuations |
| `git log --follow` still traces moved files (`git mv`) | **MET on branch** | Traced 3 moved files back to their original commits. The post-squash re-verification (tasks.md line 70) is still open and is a Delivery precondition |
| `rg 'com.helio.security'` returns nothing; empty `security/` deleted | **MET** | Both dot and slash forms return nothing repo-wide; directory absent; `security/README.md` is the change's only `D` entry |
| No file directly in `services/`, `api/routes/`, `api/protocols/`, `infrastructure/` except the named shared files; `api/` root 3; `domain/` root `package.scala`; `Database`/`DbContext` at `persistence/` root | **MET** | Directory listings above, all seven exactly as specified |
| A `README.md` in each newly created directory, stating what belongs AND what does not, verified against actual contents | **MET** | 60 new dirs / 60 READMEs; 52 `Holds:` sets exactly equal to actual basenames, 0 mismatches; 15 structural READMEs read individually. See NB-1 for a precision nit that does not touch any contents claim |
| No inline fully-qualified names introduced | **MET** | 0 `com.helio.<lowercase>` on added non-import lines; `check:scala-quality` clean |
| Route surface and mount order unchanged; implicit resolution unchanged | **MET** | `ApiRoutes.scala` content-identical to base modulo package/import (D6); 0 of 2411 classes differ in referenced `com.helio` type set, including the one real `ResourceType` collision, in my own build |

---

### Verdict: CONFIRM

Everything the ticket asks for is present and verified from ground truth, and the iron
constraint holds at the symbol-resolution level across 2,411 compiled classes in a build I
made myself. The two open placement calls are documented toss-ups with no behavioural
consequence; neither is worth a re-verification cycle.

**Greatest residual risk for the PR reviewer:** the diff is 248 renames plus ~1,000 changed
import lines, which is not humanly reviewable line-by-line — so the review necessarily rests
on the mechanised evidence, and the single most fragile link in that evidence is the D6
filter itself. It is import-blind by construction, and it was twice wrong during design
(line-oriented, then a combined `package|import` trigger that ate 497 lines of package-object
bodies while failing *toward* PASS). What actually closes that hole is not D6 but the
bytecode constant-pool comparison, and specifically its handling of `ResourceType` — the one
simple name in the entire backend declared in two packages, **both of which this change
moves**. If a reviewer wants to spend their scepticism in exactly one place, spend it there:
confirm that `com.helio.api.http.ResourceType` and `com.helio.domain.model.ResourceType` are
still resolved by the same call sites as before. I verified it three ways (source-declaration
pairing in the constant-pool comparison, hand-traced imports for all five main referencing
files, and a whole-tree collision census proving there is no second instance), and it is
clean — but it is the only place in a 257-file repackage where a green build and 3,346
passing tests would not, on their own, have been proof.

---

### Non-blocking notes

**NB-1 — a boilerplate sentence in 5 of 13 route READMEs over-claims.** "…every route class
is a thin Pekko HTTP `Directives` shell that delegates to a `services/<domain>/` service and
maps its result via `ServiceResponse`" is literally false for 6 of 48 route classes:
`auth/OAuthRoutes`, `dashboards/PublicDashboardRoutes`, `pipelines/PipelineRunStreamRoutes`
(SSE), `sources/ConnectorRoutes` (static registry, no service either),
`sources/PublicUploadRoutes`, `workspace/HealthRoutes` (no service either). It is a
justification clause, not a contents claim, and every `Holds:`/`Does NOT hold:` contents
statement is exactly right — so no AC is breached. Softening it to "most route classes are…"
would make all 13 true.

**NB-2 — `backend/README.md` still opens "Backend Scaffold … No service implementation is
included yet. Planned structure:".** CR-2 made the structure list underneath accurate; the
header now frames that accurate list as *planned*. This is the one remaining false statement
in a file this change already edits, in a change whose entire purpose is making the tree's
documentation true. A three-line edit. (Carried from the evaluator's NB-5, upgraded slightly:
the word "Planned" now actively mislabels correct content.)

**NB-3 — NB-4 of `evaluation-2.md` under-enumerates the stale-reference set by two files.**
Its list (`docs/compute-expression-grammar.md:3`, `notes/uploads-filesystem-layout.md:4`,
`frontend/.../pipelineShape.ts:3`, `.../authoring.ts:4`, `.../refinement.ts:12,21`) is correct
but incomplete. My repo-wide sweep also finds:
- `CONTRIBUTING.md:29` — the canonical code-quality standard's own example FQN is
  `com.helio.domain.PanelId(...)`; `PanelId` is now `com.helio.domain.model.PanelId`, and
  `domain/package.scala` aliases only `steps.*`, so that FQN no longer resolves.
- `scripts/check-scala-quality.mjs:9` — the same stale example, in the header comment of the
  script that enforces the rule.

Also worth correcting in D11: `openspec/specs/` matches **11** files, not 10. HEL-804 should
be widened to "all in-repo references to moved `com.helio` paths/packages", which covers all
9. Everything else outside `backend/src` is clean — `schemas/*.json` (3), 
`frontend/src/features/assistant/types.ts` and `frontend/src/utils/aggregate.ts` all name
`com.helio.ai` / `domain.shapes` / `domain.steps`, none of which move.

**NB-4 — HEL-803's scope is larger than D9 states.** Realigning the two logger names also
requires updating **12** `JsonLogCapture.withCapture("com.helio.services.*Telemetry")`
literals in `AuthoringTelemetrySpec.scala` and `AssistantTelemetrySpec.scala`, or those
assertions break. Worth writing into the ticket now.

**NB-5 — `services/alerts/README.md` gives no pointer to `domain/engine/AlertEventStateMachine`.**
Since `domain/` is kind-split, the alert lifecycle state machine is the one part of the
alerts stack a domain-directory grep does not surface. One sentence in the "Does NOT hold"
clause would close the only real navigation gap I could find in the new tree.

**NB-6 — an empty `backend/src/main/scala/com/helio/services/layout/` directory remains on
disk in this worktree.** `PanelPacker.scala` moved out to `services/panels/` and `git mv` left
the parent behind. Git tracks no empty directories, so a fresh checkout of this branch will
not have it and the delivered change is unaffected — but it is mildly ironic in a ticket whose
ACs include deleting an empty package, and anyone inspecting this worktree will see it.
`rmdir` it before Delivery.

**NB-7 — one task is legitimately still open.** `tasks.md:70` — "after the squash exists,
verify `git log --follow` traces a moved file (D10)". I verified `--follow` works on the
unsquashed branch, which is supporting evidence but not the same check. It remains a Delivery
precondition, not a gate failure.
