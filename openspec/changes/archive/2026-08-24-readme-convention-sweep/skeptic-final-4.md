## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Second authorized budget extension. Focus per orchestrator brief: STRUCTURAL
claims (newly-swept category), enumeration completeness, the e2e fix, and diff
scope. Consumption/import claims treated as closed from round 3 and not re-spent.

### What I verified (with evidence)

**1. Diff scope — docs-only (PASS)**

`git diff --name-only main...HEAD` returns 30 `README.md` files plus 10
`openspec/changes/readme-convention-sweep/*` planning artifacts. Zero code,
config, schema, or build files. `git diff --stat 65eeea69..HEAD` shows only
`e2e/README.md`, `frontend/src/hooks/README.md`, `frontend/src/utils/README.md`
(3 files, +36/-13) across commits 87465f52 / 2540cb21 / 5ce8064e.

**2. e2e/README.md fix holds (PASS)**

`ls e2e` → 7 `.spec.ts` files; 6 are ticket-prefixed
(`hel399`, `hel665`, `hel666`, `hel716` x2, `hel773`), 1 is not
(`auth-cookie-migration.spec.ts`) — exactly what the README now says, including
naming it as the exception and stating consistency is not enforced.

Backend co-location claim now correct: `find backend/src/test -type d` shows the
mirrored `backend/src/test/scala/com/helio/...` ScalaTest tree; the cited example
`backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala` exists (`ls`
confirmed). Cited frontend example `frontend/src/app/App.test.tsx` exists.

Investigated a possible counter-example: `find backend/src/main -name "*Spec.scala"`
returns `backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala`.
Read it — it is production domain code (a `SlotEligibility` binding *specification*,
not a test suite). Not a contradiction. False positive, resolved.

**3. Enumeration claims — independently re-derived by diffing against `ls`/`find`**

- `frontend/src/hooks/README.md` "reduxHooks by all 14 feature dirs":
  `ls -d frontend/src/features/*/ | wc -l` → **14**;
  `grep -rl reduxHooks frontend/src/features/ | sed .. | sort -u` → **14 distinct
  dirs**, matching the full list. PASS.
- `schemas/README.md` "all 14" + the explicit 14-name list: `ls schemas/` → exactly
  those 14 subdirs + README.md. `find schemas -mindepth 2 -type d` → empty, so
  "each domain subdirectory holds that domain's schema files directly" is true.
  `find schemas -name README.md` → only the one, matching "one README here covers
  all 14". PASS.
- `frontend/src/shared/README.md` "these two subdirectories": `ls -F` → exactly
  `chrome/` and `ui/`. "No `features/*/shared` exists":
  `ls -d frontend/src/features/*/shared` → "No such file or directory". Every
  component named under `chrome/` and `ui/` exists in the stated dir. PASS.
- `frontend/src/features/README.md`: the 14 named feature dirs match `ls` exactly;
  `ls -d frontend/src/features/*/*/ | sed .. | sort | uniq -c` → exactly the six
  named slice names (`state` 14, `ui` 12, `services` 11, `types` 10, `hooks` 7,
  `utils` 3) and no others, consistent with "a typical subset ... not every
  feature has all of them". PASS.
- Per-feature file inventories, diffed against `ls` with test/CSS files excluded,
  for `metrics`, `onboarding`, `toasts`, `layout`, `patchSets`, `proposals`:
  every enumeration is **exact — no omissions, no phantoms** (e.g. `metrics/ui`
  lists 7, `ls` returns exactly those 7; `onboarding/state` lists 3, `ls` returns
  exactly those 3; `layout` claims a single slice+hook file, `ls` confirms one each).
  PASS.
- Backend package inventories: `domain/steps` names 23 step files + `StepCodecUtil`
  → `ls` returns exactly those 24. `domain/shapes` names 9 → `ls` returns exactly 9.
  `email` names 3 → 3. `spark` names 2 → 2. `domain/panels` names 9 panel types +
  `PanelBindingSpec` + `PanelConfigCodec` → `ls` returns exactly those 11 plus
  `package.scala` (a package object of shared JSON formats; non-content, acceptable
  omission). PASS.

I ran an automated gap check over all 30 READMEs. It flagged many hits in
`auth`/`dashboards`/`panels`/`pipelines`/`sources`/`settings` — I read each of
those READMEs and they are deliberately **descriptive/categorical**, not
file-inventories ("`hooks/` for dashboard-creation and refinement actions"), which
the ticket explicitly endorses ("not an exhaustive file list — lists rot"). Those
are false positives, not defects.

**4. DEFECT FOUND — `backend/src/main/scala/com/helio/ai/README.md` (REPRODUCED)**

This is the **one** backend package README that presents a per-file inventory and
is not complete, while its five sibling package READMEs are 100% exact.

Reproduction (each `.scala` basename checked for a backticked mention in the README):

```
$ for f in $(ls backend/src/main/scala/com/helio/ai/*.scala | xargs -n1 basename | sed 's/.scala//'); do
    grep -q "\`$f\`" .../ai/README.md && echo "LISTED   $f" || echo "MISSING  $f"; done
LISTED   ClaudeClient
LISTED   ClaudeConfig
MISSING  ClaudeModels        <-- 188 lines, 17 top-level declarations
LISTED   ClaudeProtocol
LISTED   ClaudeSseAssembler
LISTED   ClaudeSseFrameParser
LISTED   ClaudeTokenEstimator
LISTED   ClaudeTransport
LISTED   ClaudeWireModels
LISTED   HttpClaudeTransport
```

Why this is misleading, not merely incomplete. The README's opening sentence reads:

> "... wire types (`ClaudeWireModels`, `ClaudeProtocol`), and `ClaudeTokenEstimator`."

`ClaudeModels.scala`'s own scaladoc states the package's central organizing split:

> "Domain-facing request/response/error types for [[ClaudeClient]] — the shapes
>  callers ... actually work with. Wire-format types that mirror the Anthropic
>  Messages API's own JSON shape live in `ClaudeWireModels.scala`; `ClaudeClient`
>  translates between the two."

The README documents only the **wire** half of an explicit two-sided split and is
silent on the **domain-facing** half — which is the half consumers actually import.
`grep -rln ClaudeModels backend/src/main` → 4 consuming service files
(`DashboardAuthoringService`, `RefinementPrompt`, `DashboardAuthoringPrompt`,
`AssistantConversationService`). `grep -nE "^(final case class|sealed trait|object)"
ClaudeModels.scala` → `ClaudeMessage`, `ClaudeRole`, `ClaudeRequest`, `TokenUsage`,
`ClaudeResponse`, `ClaudeError`, `ClaudeStreamEvent`, `ClaudeContentBlock`,
`ClaudeToolMessage`, `ClaudeTool`, `ClaudeToolRequest`, `ClaudeToolOutcome`. A reader
asking "where does `ClaudeRequest`/`ClaudeResponse` live?" is steered by
"wire types (`ClaudeWireModels`, ...)" to the wrong file.

Second, smaller defect in the same sentence: `ClaudeProtocol` is labelled a
**wire type**, but `head -12 ClaudeProtocol.scala` shows it is
`trait ClaudeProtocol extends DefaultJsonProtocol` whose scaladoc says
"spray-json **formatters for** the wire types in `ClaudeWireModels.scala`". It is a
codec/formatter trait, not a type module — the same confident-but-wrong
categorization the ticket names as its failure mode.

This is precisely the ticket's stated verification target: "for five randomly chosen
READMEs, list the directory and confirm every claim holds. Pick them randomly, not
the five you are most confident in."

### Verdict: REFUTE

**Category answer (per orchestrator's explicit question):** this is **NOT a third
claim category**. It is a **miss within the structural category** the round-3 sweep
claimed to cover — specifically the "enumeration completeness" sub-category the
sweep named by hand. `ai/` was swept and passed with a 9-of-10 inventory. The
sub-defect on `ClaudeProtocol` is also structural (what a file *is* / how it is
grouped). No new category is needed; the structural sweep's method (which appears
to have confirmed that every *named* file exists) was one-directional — it verified
"everything listed is real" but not the converse, "everything real is listed or
deliberately abstracted." That asymmetry is exactly the "an omission reads as
correct, nothing signals absence" failure mode.

### Change Requests

1. `backend/src/main/scala/com/helio/ai/README.md:3-6` — the file inventory omits
   `ClaudeModels.scala`, the package's domain-facing model layer (17 top-level
   declarations, imported by 4 service files). Add it, and make the domain-vs-wire
   split explicit, since that split is the package's actual organizing principle
   (source: `ClaudeModels.scala`'s own scaladoc). Alternatively, rewrite the opening
   sentence in the categorical register used by `frontend/src/features/dashboards/README.md`
   so it stops reading as an exhaustive inventory — but do not leave a 9-of-10 list.

2. `backend/src/main/scala/com/helio/ai/README.md:5` — `ClaudeProtocol` is
   miscategorized as a "wire type". Per `ClaudeProtocol.scala:1-9` it is
   `trait ClaudeProtocol extends DefaultJsonProtocol`, the hand-written spray-json
   **formatters for** the wire types. Re-word (e.g. "wire types (`ClaudeWireModels`)
   and their hand-written spray-json formatters (`ClaudeProtocol`)").

3. Before re-submitting, re-run the structural sweep **in the omission direction**
   over the READMEs that present per-file inventories (the 6 backend package READMEs
   plus `metrics`, `onboarding`, `toasts`, `layout`, `patchSets`, `proposals`,
   `shared`, `schemas`): for each, diff `ls <dir>` against the names in the README and
   confirm every real file is either listed or intentionally abstracted. I ran this
   diff myself for all of those listed above and `ai/` was the **only** failure — so
   CR1/CR2 are expected to be the complete fix, and this CR is a confirmation step,
   not an open-ended re-sweep.

### Non-blocking notes

- `backend/src/main/scala/com/helio/domain/panels/README.md` omits `package.scala`.
  I judged this acceptable (package object of shared JSON formats, not a content
  file), but flagging it in case the executor prefers a one-clause mention for
  consistency with how thoroughly `domain/steps` enumerates.
- `frontend/src/shared/ui/` has an `index.ts` barrel and `chrome/` does not. Not a
  claim the README makes, so not a defect — but it is the kind of asymmetry the
  "Belongs here" line could usefully capture later.
