# Skeptic Report — design gate (round 5, skeptic-design-5.md)

Worktree: `/home/matt/Development/helio/.claude/worktrees/task/repackage-backend-domain-subpackages/HEL-633`
Base: `29fc0528`. Fresh cold instance. Every figure below comes from a command I ran in this worktree.
Nothing is taken from `skeptic-design-{1,2,3,4}.md` or from the artifacts' own assertions — I read those
four reports only to know what claims to test.

---

## What I verified (with evidence)

### PART A — the D6 statement-oriented awk filter: I ran it, and it eats real code

I extracted the awk block verbatim from `design.md` D6 (lines 158-165) and ran it three ways to rule out
a tooling artifact: as an `-f` program file, as the inline `awk '…'` one-liner exactly as the design
writes it, and via a line-number-emitting variant compared against my own independently written
comment/string-aware Scala statement parser. **All three agree.** `gawk 5.4.1`.

**The good news first — three of the four things I was asked to check are clean:**

| Check | Result |
|---|---|
| Multi-line braced imports swallowed correctly? | **Yes.** `domain/steps/JoinStep.scala` (7 continuation lines) and `services/PipelineService.scala` (two statements of 42 and 38 names) are fully consumed, closing brace included. |
| Residual `package`/`import` lines tree-wide? | **0** across all 540 files — the design's claim reproduces. |
| Lines that lexically look like `import`/`package` but sit inside a string or comment? | **0** in the whole tree (my parser tracks `/* */`, `//`, `"…"` and `"""…"""`). No hazard here. |
| Braced `package foo { … }` block syntax? | **0** occurrences. |
| Lines masked tree-wide | **6,142** — the design's figure reproduces exactly. |

**The bad news: the fourth check fails.** The filter enters skip-mode on any line matching
`^[[:space:]]*(package|import)[[:space:]]` that carries `{` without `}`, then deletes everything up to the
next line containing `}`. Three lines in the tree match that trigger and are **not** imports:

```
$ grep -rnE '^[[:space:]]*(package|import)[[:space:]]' --include='*.scala' backend/src \
    | grep '{' | grep -v '}' | grep -v 'import com.helio'
main/scala/com/helio/domain/package.scala:8:package object domain {
main/scala/com/helio/api/package.scala:8:package object api {
main/scala/com/helio/domain/panels/package.scala:9:package object panels {
```

`package object X {` is lexically indistinguishable from a package clause to that regex. The filter
therefore swallows the package-object body. Measured, per file (`raw` → `kept` under the design's awk):

| file | raw | kept | masked | genuine stmt lines | **real code eaten** |
|---|---|---|---|---|---|
| `api/package.scala` | 381 | 6 | 375 | 1 | **374** |
| `domain/package.scala` | 115 | 6 | 109 | 1 | **108** |
| `domain/panels/package.scala` | 33 | 20 | 13 | 2 | **11** |
| | | | | | **493 lines** |

Direct observation, inline form verbatim from D6, on `domain/package.scala` — 115 lines in, 6 out:

```
$ awk 'BEGIN{skip=0}
       skip{ if ($0 ~ /}/) skip=0; next }
       /^[[:space:]]*(package|import)[[:space:]]/ {
         if ($0 ~ /\{/ && $0 !~ /}/) skip=1;
         next }
       {print}' main/scala/com/helio/domain/package.scala | wc -l
6
```

All 51 `type X = steps.X` / `val X = steps.X` alias pairs are gone. On
`domain/panels/package.scala` the eaten span is lines 9-19, which is the **complete body of
`implicit val dataTypeIdFormat: JsonFormat[DataTypeId]`** — its `write`, its `read`, its
`deserializationError` branch. (`metricIdFormat`, lines 26-32, survives, purely because the earlier `}`
at line 19 ended skip-mode. The cut point is arbitrary.)

**So design.md D6 line 170 — "it masks 6,142 lines tree-wide *while preserving every brace-bearing code
line*" — is false.** The 6,142 half reproduces to the unit; the second half does not. The eaten lines
`package object domain {`, `implicit val dataTypeIdFormat: … = new JsonFormat[DataTypeId] {` and
`def read(json: JsValue): DataTypeId = json match {` are all brace-bearing code lines.

**Why the design's own pre-adoption verification missed it.** D6 says the awk "matches an independently
written implementation line-for-line (0 mismatches)". My independent implementation found a mismatch on
`domain/panels/package.scala`, so the design's comparison implementation shared the same
`package object` flaw. And the self-check `tasks.md` line 7 prescribes — *"over all 540 `.scala` files it
must leave 0 residual `package`/`import` lines"* — is **the wrong invariant**: it is one-sided, it is
satisfied by an arbitrarily over-consuming filter, and it actively rewards over-consumption. I ran it:
it returns 0, i.e. **green**. The executor gets a passing self-check on a filter that is deleting code.

**It fails silently, in the pass direction.** Masking is symmetric (base and worktree both lose those
lines), so these three files sail through D6. I simulated the mandated edit to
`domain/panels/package.scala` (adding the `DataTypeId`/`MetricId` import, single-line and braced
multi-line forms) — filtered output is byte-identical to base in both cases. The gate never fires, so
nothing prompts the executor to look. And D6 lines 171-174 instruct that the filter "is fixed **here, in
the design**… must not be improvised when the gate first fires" — so an executor who *did* notice is told
not to touch it.

**Blast radius after accounting for the plan's own mitigations.** `api/package.scala` (374 of the 493
lines) is separately and fully covered by the NB-2 check, which I tested and confirmed sound (below). The
genuinely uncovered residue is **119 lines across 2 files** — but those two files are
`domain/package.scala`, whose "content untouched" claim underwrites the 141-file `domain._` fan-out (D5),
and `domain/panels/package.scala`, which `tasks.md` line 26 hands the executor to **hand-edit as a
prerequisite inside Layer 1**. The one file the plan schedules for manual editing in the very first step
is a file whose live JSON format the gate cannot see.

**Tested drop-in fix.** Only `import` statements are ever multi-line braced in this tree; every package
clause is `package <fqn>` alone on its line (verified: 0 braced package blocks, 540/540 single-clause).
Splitting the trigger fixes it:

```awk
BEGIN{skip=0}
skip{ if ($0 ~ /}/) skip=0; next }
/^[[:space:]]*import[[:space:]]/ { if ($0 ~ /\{/ && $0 !~ /}/) skip=1; next }
/^[[:space:]]*package[[:space:]]+[A-Za-z_][A-Za-z0-9_.]*[[:space:]]*$/ { next }
{print}
```

Measured over all 540 files: masks **5,649** lines (= 6,142 − 493, the exact code recovered), leaves **0**
residual `import` lines, retains all three `package object X {` lines and their bodies as code, and
matches my independent parser on every file. It still swallows `JoinStep.scala` and
`PipelineService.scala`'s multi-line imports correctly.

### PART B — round 4's nine non-blocking notes: all nine are addressed

| NB | Claim | My check | Verdict |
|---|---|---|---|
| NB-1 | prerequisite sequencing + tree-wide wording + `Test/compile` | `tasks.md:22-24` now reads "rewrite **every import in `backend/src` naming a symbol this layer moved, wherever it lives** (not just the moving layer's own files) … `sbt Test/compile` green". All four prerequisites relocated into the layer that needs them: `domain/panels/package.scala` import → Layer 1 (`:26`), `api/package.scala` 466 + `JsonProtocols` → Layer 4 (`:29`), `ApiRoutes.scala:12` fan-out → Layer 5 (`:30`). D10 (`design.md:271-277`) matches. | **Fixed** |
| NB-2 | allow-list verified by sed normalization | `design.md:190`, `tasks.md:55`. I tested it: base `api/package.scala` has **466** `protocols.` occurrences and **0** matching `protocols\.[a-z]` (all targets are uppercase type names), so the sed cannot collapse anything pre-existing. Simulated rewrite → normalize → `diff` against base = **clean round-trip**. This check genuinely covers all 381 lines. | **Fixed, and sound** |
| NB-3 | `JsonProtocols` as fourth non-mover; `domain._` fan-out tasked | `design.md:253` "**Four** non-movers"; `tasks.md:17` lists all four; `tasks.md:26` tasks the 141-file (68 main / 73 test) `domain._` fan-out. | **Fixed** |
| NB-4 | `DataTypeService` placement decided | `design.md:95` — the whole `DataType*` family → `pipelines`, with rationale. | **Fixed** |
| NB-5 | pre-authorised quality-set delta | `design.md:201-209` + `tasks.md:58`, both naming `DashboardRepository` (243) / `MetricRepository` (246) and forbidding the "fix". | **Fixed** |
| NB-6 | arithmetic 40 / 691 / 9 | `ticket.md` infrastructure **40** (ground truth: 40). `proposal.md:38` and `design.md:182` now say **691**; no `692` remains. `tasks.md:31` says "the **9** files that move" and enumerates exactly 9. | **Fixed** (one residual nit — see NN-4) |
| NB-7 | widened mapping assertion | `tasks.md:16` now admits "one of the structural directories (`domain/{model,connectors,engine,util}`, `infrastructure/{persistence,storage,crypto,concurrency}`, `api/http`)". | **Fixed** |
| NB-8 | `sbt Test/compile` per layer | `tasks.md:24` and `design.md:275`, the latter with the reason (plain `compile` cannot see test breakage). | **Fixed** |
| NB-9 | HEL-633 layout pasted into `ticket.md` | `ticket.md` carries both the "Target layout" fenced block and the "Placement notes for the ambiguous files" list. I diffed them against the live Linear description via the Linear API — the layout block matches character-for-character; the placement notes are lightly abridged (see NN-5). It also adds an explicit "Where design.md knowingly overrides the above, and why" section, which is more than was asked. | **Fixed** |

### Independent ground-truth re-measurement (cold, my own commands)

Every load-bearing count in the artifacts reproduces:

- Layer census `services 88 / api/routes 48 / api/protocols 46 / infrastructure 40 / domain root 22` =
  **244**; `api/` root **12**; `services/layout` **1**; total to map **257**; main tree **322**; test tree
  **218**; `backend/src` total **540** `.scala`.
- D0's premises: **0** braced `package … { }` block declarations tree-wide; **0** files with two plain
  package clauses (the three `package object` files match a naive `^package [a-zA-Z]` grep twice — which
  is itself the lexical confusion that breaks the D6 filter, and is not a second package *clause*).
- `api/package.scala` 381 lines, 466 `protocols.` occurrences, 0 lowercase-suffixed.
- `domain/package.scala` 115 lines, 51 alias pairs, all targeting `steps.`.
- `domain/panels/package.scala` 33 lines, holds both `implicit val`s, single `spray.json._` import.

I found no new defect outside D6.

---

## Verdict: REFUTE

I want to be precise about how narrow this is, because it is the last round.

Round 4's estimate thread is closed and I did not reopen it. The nine non-blocking notes are all genuinely
fixed, several better than asked (NB-2's check round-trips clean; NB-9 adds an override-rationale section;
NB-1's prerequisites are individually placed rather than bulk-moved). Every count I re-measured cold lands
on the artifacts' figures. D0 is right, the layer census is right, the mapping arithmetic is right, the
sequencing is now executable, and I looked for a new defect outside D6 and did not find one.

The single blocking item is the one the orchestrator pre-designated as the most important thing to check,
and the check came back positive: **the replacement filter silently deletes 493 lines of real code.** The
orchestrator's own framing was that this would be "far worse than the line-oriented one it replaces" — and
it is, quantitatively: the old line-oriented filter dropped 3 lines of real code tree-wide (the three
`package object X {` lines and nothing more); the new one drops 493, including whole package-object
bodies.

It meets the REFUTE bar on two of the three stated grounds:

1. **A behaviour change that ships undetected.** Not hypothetically — `tasks.md:26` sends the executor to
   hand-edit `domain/panels/package.scala` as a prerequisite in Layer 1, and 11 of that file's 33 lines,
   comprising the entire body of a live `JsonFormat[DataTypeId]`, are outside the gate's view. A
   perturbation there compiles, plausibly passes tests, and D6 will not see it.
2. **An unreviewable result.** The change's entire review story is "257 files are too many to read, so D6
   proves content identity everywhere except one allow-listed file." That story is 493 lines short of
   true, and `design.md` states the shortfall's absence as *verified fact*, which is worse than stating
   nothing — a reviewer who trusts D6's PASS is trusting a measurement that was not taken.

It is not a "gate would catch it during execution" item, because the defect **is** the gate; and it is not
an "executor will notice" item, because it fails toward PASS and the prescribed self-check returns green.
This is the same structural class as round 4's CR-1 — a defect in the safety net rather than in the
estimates — which is why I am not letting the round-5 budget talk me out of the standard the orchestrator
set before I started.

Mitigating, and worth weighing in the escalation: the fix is four lines of awk, tested above; 374 of the
493 lines are already covered by NB-2's independent check; and nothing else in the plan is blocking. If
the human wants to accept-and-patch rather than re-plan, CR-1 below is the complete patch.

---

## Change Requests

### CR-1 — **blocking** — D6's replacement filter deletes 493 lines of real code from the three package objects

`design.md` D6, lines 158-165. The trigger regex `^[[:space:]]*(package|import)[[:space:]]` matches
`package object X {`, which carries `{` and no `}`, so skip-mode engages and consumes the package-object
body up to the next line containing `}`. Reproduced three ways (`-f`, inline-verbatim, line-number diff
against an independent parser). Effect: `api/package.scala` 374 lines eaten, `domain/package.scala` 108,
`domain/panels/package.scala` 11.

Required:

1. **Replace the awk in D6** with the split-trigger version (tested above: masks 5,649 lines, 0 residual
   `import` lines, all three package-object bodies preserved, multi-line imports still swallowed,
   matches an independent parser on all 540 files):

   ```awk
   BEGIN{skip=0}
   skip{ if ($0 ~ /}/) skip=0; next }
   /^[[:space:]]*import[[:space:]]/ { if ($0 ~ /\{/ && $0 !~ /}/) skip=1; next }
   /^[[:space:]]*package[[:space:]]+[A-Za-z_][A-Za-z0-9_.]*[[:space:]]*$/ { next }
   {print}
   ```

   Justification for the second rule being anchored to end-of-line: all 540 files are single-clause
   `package <fqn>` (D0), and there are 0 braced `package … { }` blocks in the tree — both re-verified in
   this review.

2. **Delete or correct `design.md`:170's claim** that the filter preserves "every brace-bearing code
   line". As written it is a false statement of verified fact about the change's central safety net. With
   the corrected filter the claim becomes true and should be restated with the new figure (5,649).

3. **Replace `tasks.md`:7's self-check.** *"0 residual `package`/`import` lines"* is one-sided and is
   satisfied by an over-consuming filter — it is the invariant that produced this bug. Make it two-sided,
   e.g.: *"(i) the filter leaves 0 residual `import` lines over all 540 files; **and** (ii) for every
   file, `wc -l` minus the kept-line count equals the number of lines belonging to a `package`/`import`
   statement, so the filter removes no line that is not part of one. Assert (ii) explicitly on the three
   package objects — `api/package.scala`, `domain/package.scala`, `domain/panels/package.scala` — whose
   bodies must survive the filter intact."*

4. **Note in D6 that `domain/package.scala` and `domain/panels/package.scala` are now genuinely covered**
   by the primary gate once (1) lands, which is what makes D5's "content untouched" claim for
   `domain/package.scala` provable rather than asserted.

---

## Non-blocking notes

**NN-1 — `tasks.md`:6 says save the filter "verbatim from design.md D6" to `baseline/filter.awk`.** The
D6 block is presented as an inline `awk '…'` invocation; saved verbatim it is not a valid `-f` program
file (leading `awk '`, trailing `'`, and the fenced-block header). Self-evident on first run — state that
the *program body* is what goes in the file.

**NN-2 — blank lines around import blocks are preserved by the filter, and will fail the gate if
reflowed.** Verified: the filter drops statement lines but keeps the blank lines between import groups.
Fanning out imports never requires touching those blanks, but an executor who tidies the import block
(collapses a blank separator, regroups) produces a D6 difference on an otherwise-correct file. This one
fires loudly rather than silently, so it is cheap — just brief the executor: *do not add or remove blank
lines in or around the import block.*

**NN-3 — `design.md`:192, "Applied to `backend/src/test/` too", has an ambiguous antecedent.** The
sentence sits inside the `api/package.scala` sed-normalization paragraph, but the sed cannot meaningfully
apply to test files (no `protocols.X` alias targets there). The intent is presumably that the *D6
comparison* covers the test tree — which the "union of every `.scala` path" iteration domain already
guarantees. Reads as a leftover; either re-anchor it or drop it.

**NN-4 — `ServiceResponse` is 40 in D3 and `tasks.md`:30, but 39 in D7(b)'s table row.** These are two
differently-measured quantities (files-referencing-minus-definer vs the insertion-surface census) and
`tasks.md` carries both without contradiction, so nothing depends on it. Ground truth: 41 `api/routes/`
files match, 0 import it, 40 excluding the definer. Pure residual arithmetic — flagged only for
completeness, and explicitly not a REFUTE ground.

**NN-5 — `ticket.md`'s "verbatim from Linear" is very slightly abridged in the placement notes.**
Comparing against the live HEL-633 description: the layout block is character-exact, but the placement
list drops two trailing rationale clauses — "(layout is a panel-grid concern)" from the `AutoLayout` line
and "they are genuinely cross-domain" from the `IdParsing`/`PaginationProtocol`/`ResourceProtocol` line.
No placement changes; the word "verbatim" is just marginally overclaimed.

**Credit.** NB-2 deserves specific credit: it is the one check in the plan that operates on raw file bytes
rather than through the filter, and it is the reason 374 of the 493 blinded lines are covered anyway.
Whoever wrote it built the only redundancy in D6's verification story, and it is what keeps this REFUTE
narrow. NB-1's prerequisite relocation was done properly — each prerequisite placed in the specific layer
step that needs it, with the reason attached ("green is unreachable without it"), rather than gathered
into a preamble. And D6's iteration-domain-as-union, which I re-read carefully looking for a hole, is
correctly reasoned: it is genuinely what makes an unexpected added or deleted file fail rather than be
skipped.
