## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Narrow scope per the orchestrator: round-2's two open CRs, verified **in tasks.md**, plus an
empirical check that the `Record<RecentKind, true>` construct does what it claims. Did not
reopen Decision 1's union shape, the owner-ruled kind scope, or the five CRs round 2 cleared.

### What I verified (with evidence)

**Round-2 CR1 — RESOLVED, in tasks.md, and the mechanism is empirically real.**
`tasks.md:2-19` (task 1.0) now rules the retype explicitly: `RecentEntry["kind"]`
(`recentHistoryStore.ts:16`) and `recordVisit`/`pruneMissing`'s `kind` parameters (`:100`,`:104`)
become `RecentKind = Exclude<ResourceKind, "output">`; it names both breaking call sites
(`useRecentPaletteActions.ts:65` and `:12`); it corrects the wrong `hooks/` path explicitly; and
it forbids the array annotation, prescribing `RECENT_KINDS: Record<RecentKind, true>` with
`VALID_KINDS` derived from its keys. design.md D1 (`:58-85`) matches — the false
"stays legal" justification is gone (`:58` now names it as the withdrawn wording).

I did **not** reason about the TypeScript; I compiled it. Scratch project (`--strict`, `types: []`,
isolated tsconfig) reproducing the *post-change* shapes verbatim from D1's code block plus the two
real consumer lines (`const ref: ResourceRef = { kind: entry.kind, id: entry.id }` and
`Record<RecentEntry["kind"], LucideIcon>`), against the widened union from task 1.1:

- Baseline `tsc -p` → **exit 0**. So the retype genuinely keeps `useRecentPaletteActions.ts:12`
  and `:65` compiling — including `Object.keys(RECENT_KINDS) as readonly RecentKind[]` and the
  existing `(VALID_KINDS as string[]).includes(...)` cast at `recentHistoryStore.ts:38`, both of
  which are legal assertions. This is the third instance the orchestrator warned about, and this
  time the asserted mechanism holds.
- Mutation (add `"dummy"` to `ResourceKind`) → **exit 2**, first error exactly where the task says:
  `error TS2741: Property 'dummy' is missing in type '{ dashboard: true; source: true; pipeline: true; }'
  but required in type 'Record<RecentKind, true>'` at the `RECENT_KINDS` line. The keyed map IS
  exhaustiveness-checked. (`KIND_ICON` errors the same way, a second free guard.)
- Counterfactual: replacing `RECENT_KINDS` with `const VALID_KINDS: readonly RecentKind[] = [...]`
  produced **no error at the array** — confirming round-2's finding that the previously prescribed
  construct was unsatisfiable, and that task 1.0's ban on it is correct.

**Round-2 CR2 — RESOLVED.** `design.md:3-6` Context now reads "outputs are reachable in bulk via the
EXISTING paginating client `listAllOutputs()` — `GET /api/outputs` is paginated, not a
single-request dump (see D3)." `grep -rn "one request"` across the change dir returns only
`design.md:135` ("one request per pipeline", a *correct* statement about the per-pipeline endpoint)
and `proposal.md:12` (see non-blocking note 1). tasks.md 2.1 independently carries the emphatic
reuse ruling, so the implementer's build document is right regardless.

**Newly broken by the round-3 edits — nothing found.** `npx openspec validate
palette-global-resource-search --strict` → *"Change 'palette-global-resource-search' is valid"*.
`git status --porcelain` shows the change dir as the only untracked path; no code has been touched,
so no gate/lint surface is newly at risk. Tasks 1.1–1.4, 2.1–2.2 are unchanged from the versions
round 2 cleared (re-read; the CR6 `never`-assertion language at 1.3 and the pagination language at
2.1 survive intact).

**Two-axes question.** *What no source text carries:* still nothing proves the app indexes anything
on `/` — only a running `/`-route probe against a with-a-dashboard fixture (task 5.1's proviso,
which round 2 verified is non-vacuous) distinguishes an unindexed search from an empty workspace.
*What path the gates did not exercise:* every runtime path — `git diff main...HEAD` is empty of
code, so there is no branch-only string to curl, no rendered UI, and cohesion judgment is not
exercisable at this gate. My typecheck evidence is a scratch reproduction of the plan's constructs,
not of shipped code; task 1.0's "RUN that mutation and confirm it landed" remains a real obligation
on the executor against the real tree.

### Verdict: CONFIRM

Both round-2 items are genuinely fixed in tasks.md (the document an implementer builds from) and in
design.md, and the one construct whose correctness was in doubt is verified by compilation rather
than by argument. The remaining items below are wording-level and do not block correct
implementation.

### Non-blocking notes

- `proposal.md:12` still carries the withdrawn falsehood: "`GET /api/outputs`, which returns every
  Output the caller owns in one request." Round-2 CR2 named only design.md's Context, so this is
  pre-existing rather than newly broken, and tasks.md 2.1 overrides it unambiguously — but it is the
  last surviving copy of the stale premise and costs one sentence to fix.
- Strictly, adding a kind to `ResourceKind` would break the build *somewhere* even with the array
  annotation (the `ResourceRef` union assignment at `:65` also errors). Task 1.0's phrasing
  ("an array-annotated version would pass this vacuously") is true of the `RECENT_KINDS` site it
  names, which is the site the verify step points at, so the instruction is sound; only the blanket
  reading is imprecise.
- `design.md:5` is now a ~120-char line where the surrounding paragraph wraps at ~110. Cosmetic.
- Carried forward, still unaddressed from rounds 1-2 and still non-blocking: the per-kind cap (D7 /
  task 3.4a) has no spec scenario; an output row's subtitle (its pipeline name, the disambiguator
  between similarly-named outputs) is unspecified; the coverage caveat's placement is unspecified,
  so task 5.6's cohesion screenshot has no stated intent to judge against.
