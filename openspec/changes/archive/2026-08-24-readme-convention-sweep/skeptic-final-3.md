## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Extended round, human-authorized. Sample deliberately weighted toward the
least-scrutinized READMEs (backend 6, top-level 4), plus an independent
re-derivation of the `services/README.md` scoping question. Every claim below
was re-derived from `ls`/`grep`/`find` output run in this session — the
executor's sweep report was read only as a set of claims, never as evidence.

### What I verified (with evidence)

**Backend 6 (email, spark, ai, domain/panels, domain/shapes, domain/steps)** —
`for f in ...; do cat $f/README.md; ls $f; done`. Every file named in every one
of the six exists. The two exhaustive-looking enumerations both check out:
- `domain/steps` names 23 step types; `ls` yields exactly 23 `*Step.scala`
  files (Aggregate…Window) plus `StepCodecUtil.scala` — a complete, correct list.
- `domain/shapes` names 9 files, all present (`OutputContract`, `PipelineShape`,
  the 5 shapes, `ShapeParamDescriptor`, `ShapeStepExpansion`).
- `domain/panels` names 9 panel types + `PanelBindingSpec` + `PanelConfigCodec`;
  all present. Unnamed `package.scala` is fine (format says lists aren't exhaustive).
- `ai` names 9 of the 10 sources (omits `ClaudeModels.scala`) — fine, non-exhaustive
  by design; nothing named is absent.
- Cross-references hold: `com/helio/api/routes` exists; `AssistantService` is not
  in `ai/`; `domain.steps`/`domain.shapes` mutual pointers are accurate.

**schemas/README.md** — the strongest claim in the sweep and it fully holds:
```
find schemas -mindepth 2 -type d        -> (empty)   # no nested dirs
find schemas -mindepth 2 -type f ! -name '*.json' -> (empty)  # no code, JSON only
ls -d schemas/*/ -> exactly the 14 named domains, no more, no fewer
```
So "each domain subdirectory holds that domain's schema files directly … pure
JSON Schema groupings with no code" is literally true, and the one-README
decision is stated with its reason as the ticket required.

**docs/README.md** — all six named `.md` files present; `superpowers/` present;
"reference screenshots" = the 2 `.png`s. ✓

**scripts/README.md** — the five `check-*.mjs` gates named (openspec hygiene,
repo integrity, Scala quality, schema drift, spec structure) all exist, as do
`agent/`, `concertino/`, `lib/`. ✓

**services/README.md — item 4, re-derived independently (holds).** I did not
accept "correctly scoped". Derivation:
```
11 of 14 feature dirs have services/  (layout, onboarding, toasts do not)
per-dir check: all 17 non-test files across those 11 services/ dirs import httpClient
grep -rn "axios|fetch(|httpClient" features/{layout,onboarding,toasts} -> ZERO hits
```
The three exceptions are not features whose API client bypasses `httpClient` —
they make **no HTTP calls at all** (pure client-state slices: layout undo/redo,
onboarding, toast queue). So "infrastructure every feature's API client builds
on" is universally true over every feature that has an API client, with an empty
exception set. This is genuine scoping, not narrowing-until-unfalsifiable.
The two siblings are genuinely cross-feature too (`classifyRequestError`: 5
features; `extractErrorMessage`: 7) — not the round-1 utils defect pattern.
The named examples `features/dashboards/services` and `features/sources/services`
both exist. ✓

**Random feature-README sample (layout, toasts, metrics, patchSets)** — every
named file exists (`find features/<f> -type f`), and every "does not belong
here" pointer resolves: `shared/ui/Toast.tsx` ✓, `features/dashboards/ui/
RefinementChatDrawer.tsx` ✓, `features/panels/ui/grid/PanelGrid.*` ✓,
assistant's patch-set/proposal handoff ✓.

**Item 5 re-confirmations — all hold:**
```
grep -rn "com/helio/security|com\.helio\.security|testutil" --include=README.md . -> (none)
ls backend/src/main/scala/com/helio/security -> No such file or directory
git diff --name-only main...HEAD | grep -v '\.md$'
  -> openspec/changes/readme-convention-sweep/.openspec.yaml   (only non-.md; a
     planning artifact of this change — within the docs-only constraint)
git diff --name-only main...HEAD | grep -E 'frontend/src/(app|config|context|store|test|theme|types)/' -> (none)
```

### Verdict: REFUTE

One reproduced, factual defect — the same class the previous two rounds caught
(confident prose contradicted by the tree), this time in the top-level set.

`e2e/README.md` (added by 65eeea69), "Does not belong here" line:

> unit/component tests — those live alongside the source they test
> (`*.test.ts(x)` in `backend/`/`frontend/src`).

Reproduced twice:
```
find backend -name '*.test.ts*'                 -> (empty)
find backend -name '*.ts' -o -name '*.tsx' | grep -v node_modules -> (empty)
find backend/src/test -name '*.scala' | wc -l   -> 218
ls backend/src/                                 -> main  test
```
There is not one TypeScript file anywhere under `backend/`. Backend unit tests
are ScalaTest suites, and they do **not** live "alongside the source they test"
— they live in a separate `backend/src/test/scala/...` tree mirroring
`src/main` (e.g. `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala`).
The claim is wrong on both the file-extension and the location half. For
`frontend/src` the claim is correct (254 co-located `*.test.ts(x)` files).

This is exactly the failure the ticket names as its own primary risk ("confident,
plausible, unverified prose — no automated gate in the repo can catch it"), and
the executor's round-3 sweep reported this file as holding.

### Change Requests

1. `e2e/README.md:7-8` — correct the "does not belong here" pointer. It must
   describe the two test homes as they actually are, e.g.: frontend unit/component
   tests are co-located `*.test.ts(x)` files under `frontend/src`; backend unit
   tests are ScalaTest suites under `backend/src/test/scala/` (a mirrored tree,
   not co-located). Do not write `*.test.ts(x)` in `backend/` — no such file exists.
2. `e2e/README.md:3-5` (fold into the same edit) — "one file per scenario (named
   after the ticket that added it)" is stated as fact but 1 of the 7 specs,
   `auth-cookie-migration.spec.ts`, is not ticket-named. Either soften to
   "usually named after the ticket that added it" or state it as the convention
   for new specs; as written, `ls e2e` contradicts it.

### Non-blocking notes

- `scripts/concertino/next-report-number.sh` and `persist-evidence.sh` do not
  exist inside this worktree (branched from 7cfb1e84, which predates them); I
  used the main-repo copies against the worktree change dir. Not a defect of
  this ticket.
- Everything else I sampled — including the two specifically-flagged items
  (services/ scoping, item 5) — held up under independent re-derivation. Fixing
  CR 1+2 is a single small edit to one file.
