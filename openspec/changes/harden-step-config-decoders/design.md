# Design — HEL-814 Harden pipeline step config decoders

## Context

The ticket's original framing is "make the decoders raise". A design pass on the callers, which the ticket
itself demanded before changing decode behavior, shows that framing is unsafe as stated and contradicts a
contract shipped four days earlier. This document records what was measured, what was decided, and why.

## D0 — The ticket's framing is superseded by HEL-860's contract

`PipelineStep.scala:112-119` (the `validateRawConfig` SPI docstring) and the `pipeline-step-config-rejection`
spec both state that `decodeConfig` is **contractually tolerant for the READ path**, with strictness living on a
write-path `validateRawConfig` hook returning 422. HEL-860 shipped that four days before this ticket ran.

Following the ticket's literal instruction would silently reverse that contract. We follow the contract instead,
and say so in the PR. This is not a scope reduction: the contract's write-path hook is *more* general than the
ticket's approach, because it rejects from the **raw** supplied config rather than from a decoded value, which is
the only way to catch a key the decoder would discard before anyone can inspect it.

**The real defect, restated.** `validateRawConfig` exists and is wired into `PipelineService.addStep:466` and
`updateStep:642` — but not into `PatchSetApplyResolvers.validateEmbeddedStepReferences:223` (preview and
refinement apply) or `PipelineProposalService.validateStep:179` (MCP apply). Both of those check only decode
`Success`/`Failure`, which is precisely the check the ticket's Problem section identifies as insufficient. Those
two surfaces are the ticket.

## D1 — Read-path strictness: wrong JSON type only

**Decision.** `*Config.decode` raises when a key is **present but of the wrong JSON type**. Absent keys, and
present keys holding an empty value of the correct type, keep today's tolerant default.

**Why absence cannot raise.** `PipelineStepRepository.rowToDomain:261` matches on the decode result and, on
`Failure`, throws `IllegalStateException`. That function backs **every** read of a step — run, preview, and
`listByPipeline` for the editor. A decode failure there is not a validation message; it is a 500. Making absence
raise would convert a silently-degraded run into a failure to open the pipeline editor at all, which is a worse
product than the defect being fixed.

**Why wrong-type may raise.** Measured against two independent populations — dev (78 rows / 21 kinds) and prod
(155 steps / 65 pipelines / 11 kinds), 233 rows total — **zero** carry a wrong-type config. Nothing in either
environment changes behavior. This is measurement, not inference: the claim "existing persisted configs still
decode" is tested against real rows rather than argued from the code.

**Knowingly reversed: HEL-860's read-tolerance guarantee for a wrong-TYPE stored row.** HEL-860's AC3 states the
read path is unchanged, and `PipelineStepRoutesSpec.scala:1019-1035` raw-inserts a legacy row
`{"casts":[{"field":"amount","to":"double"}]}` and asserts `GET /pipelines/:id/steps` returns 200 with an empty
cast map, under the comment "this change only adds a WRITE-path check". D1 reverses that for the wrong-**type**
half: such a row now raises, and `rowToDomain` turns that into a 500 on listing.

This is deliberate, not an oversight, and it is the same failure mode D1's own rationale calls "off the table" for
absence — so it needs its justification stated rather than assumed. It is acceptable here only because the
measurement covers it: 0 of 233 rows across dev and prod carry a wrong-type config, so no real row is reachable,
whereas the absence case has 20 real rows. The guarantee being reversed is narrower than HEL-860's headline
("read path unchanged") and is reversed only where nothing exists to break. HEL-860's own test must be updated to
its new expected behavior rather than left to fail, and the PR must say this reversal happened.

**Why an item-level drop must fail the whole config.** Mechanism 1 (`items.flatMap(it => Try(...).toOption)`)
drops a mismatched element and keeps its siblings, producing a *partially* decoded collection. That is strictly
worse than a total failure, because the result looks plausible. A single bad element fails the configuration.

## D2 — Write-path strictness: wrong type only, drafts stay savable

**Decision.** Implement `validateRawConfig` for all 23 step kinds, rejecting wrong-**type** values only. Wire it
into the two surfaces above.

**Why drafts stay savable.** 12 dev + 8 prod rows carry a missing/empty required field. Every prod instance is a
step added and not yet configured — one sits in a pipeline named "new pipeline", and one is a `compute` with both
`column` and `expression` empty, i.e. an untouched freshly-added step. This is the editor's add-then-configure
flow running in production right now. `LookupStep` already documents its empty ids as "an incomplete draft, not a
security violation", so the codebase had already reached this conclusion independently.

Rejecting these on write would break the editor for every user mid-edit, and would do so to prevent a problem
that D3 closes at the point where it actually matters.

## D3 — Run and analyze time: reject missing/empty required values

**Decision.** A step whose required configuration is missing or empty fails the run, and is reported at analyze
time through the existing `validationError` field.

**Why this is not optional.** "Legitimate to save" is not "legitimate to run". Without this, D2's deliberate
permissiveness would leave the corruption entirely unguarded — a `compute` with `column: ""` silently writes a
column named `""` into the output DataType, which is HEL-888's open bug. D2 and D3 are a matched pair; shipping
D2 alone would be a net regression in guarantees.

**Why it belongs in this ticket rather than a follow-up.** Both halves already have established machinery to
extend, so this is not new subsystem work: HEL-859 already shapes run errors as "name the failing step and its
reason", and the `pipeline-step-config-validation` capability already validates enum options at analyze time and
combines multiple failures into one `validationError`. Splitting D3 out would ship a decision (drafts are
savable) whose safety depends on a ticket that does not exist yet.

**Single source of truth.** The run-time and analyze-time checks derive from one per-step declaration of which
fields are required, so the two surfaces cannot disagree. The existing spec already requires validators to derive
accepted values from the engine's own set rather than a copy; this extends the same discipline.

## D4 — Enum and numeric coercion: normalize case, then reject

**Decision.** Enum-valued options match case-insensitively; a value that does not normalize to a known member is
rejected with a message naming the supported set. An `limit.count` that cannot be represented as its numeric
type is rejected rather than narrowed to `0`; a missing, zero or negative `count` keeps its blessed no-op
meaning (D8).

**Why this is the highest-severity finding, above the two named mechanisms.** `filter.combinator` accepts any
JSON value and silently yields `AND` — an `OR` filter becomes an `AND` filter, changing **which rows survive**
rather than merely how they are grouped. `dedupe.keep: "LAST"` yields `"first"`, **inverting which row wins**.
`limit.count` becoming `0` for an UNREPRESENTABLE number means *unlimited*, silently **widening** a result set
(an explicitly supplied `0`, or an absent one, legitimately means unlimited and is untouched — see D8). None of these are shape
mismatches at all, which is why neither of the ticket's two mechanisms catches them — this is the third
mechanism the ticket asked us to look for.

**At which layer — settled explicitly, because the two readings differ in blast radius.** Decode
**case-normalizes and stays tolerant of an unknown-but-correctly-typed enum value**; rejection lives at
**analyze and run**, alongside D3. Decode-level rejection would mean a stored row carrying a correct-type but
unknown enum value raises in `decode`, which `rowToDomain` turns into a 500 on listing steps — the failure mode
D1's rationale calls off the table, over a population the 233-row measurement never covered (that measurement
counted wrong-JSON-type configs and missing/empty required fields, never unknown-but-correctly-typed enum
values). **The 233-row measurement licenses nothing about enum values** — it counted wrong JSON types and
missing/empty required fields, and says nothing about unknown-but-correctly-typed enums. We are not willing to
take an unmeasured read-path risk to catch a value that analyze and run catch anyway.

Note this leaves nothing uncaught: `filter.combinator: 5` is a wrong **type** and so is already rejected by D1
at decode and by D2 on write; `filter.combinator: "XOR"` is correctly-typed-but-unknown and is rejected by
analyze and run. Both halves of the coordinator's concern are covered, at different layers, for a stated reason.

**What decode RETURNS for an unknown-but-correctly-typed enum — pinned, because task 5.1b's assertions depend on
it.** Decode **stops coercing and preserves the supplied value verbatim**. Where the value matches a supported
member case-insensitively it is normalized to that member's canonical spelling (`"LAST"` -> `"last"`); where it
matches none it is passed through unchanged (`"bogus"` stays `"bogus"`). Decode never substitutes a different
member.

This is the only reading that makes the layer decision meaningful. If decode kept coercing, the wrong value would
already be gone by the time analyze or run inspected the config, so neither surface could report it — the
rejection would be unimplementable and the coercion D4 exists to abolish would still happen. Preserving the value
is what makes it visible to the surfaces that reject it. It also keeps the stored row readable, satisfying D1's
constraint that decode must not raise here.

Concretely this moves both enum tests' asserted values: `ChunkByTokenCountStepSpec:145` currently expects
`encoding == "o200k_base"` for `"not-a-real-encoding"` and must now expect `"not-a-real-encoding"`;
`PipelineStepConfigCodecSpec:262` currently expects `keep == "first"` for `"bogus"` and must now expect
`"bogus"`. They remain **guards** on the read path, with the rejection proven separately at analyze and run.

**Why normalize case rather than reject outright.** `"LAST"` is unambiguous intent; this is an agent-authored
surface where case drift is routine. Being forgiving about case costs nothing; being forgiving about unknown
values costs correctness.

## D5 — Characterization tests: 3 of 5 flip, and 2 are relabelled

| Test | Wrong-shape kind | Outcome |
| --- | --- | --- |
| `pivot`: non-array `index` | wrong **type** | flips at decode — **proof** |
| `unpivot`: string `valueVars` | wrong **type** | flips at decode — **proof** |
| `window`: string `partitionBy`, bad `orderBy` element | wrong **type** | flips at decode — **proof** |
| `PatchSetPreviewServiceSpec`: preview accepts wrong-shape join | **absence** of `joinKey` | does **not** flip — **guard** |
| `join`: missing `joinKey` decodes to `""` | **absence** | does **not** flip — **guard** |

Both non-flipping tests fail for the same reason, and it is the approved design rather than an oversight.
`PatchSetPreviewServiceSpec`'s fixture omits `joinKey` entirely (its own comment says so: "joinKey is OMITTED
entirely (never `""` explicitly)"). D2 rejects wrong-**type** values only, and the `pipeline-step-config-rejection`
delta states in terms that absence SHALL NOT be rejected. So `validateRawConfig` returns `None` for that config,
the decode still succeeds under D1, and the existing referential check passes because `rightDataSourceId` is
supplied validly. Preview therefore still returns `Right` — correctly, because that edit is indistinguishable
from a draft, and completeness is enforced at run and analyze time by D3 instead.

Both tests keep their existing assertions and have their comments rewritten to say this explicitly. Without that
relabelling a future reader finding `joinKey shouldBe ""`, or a preview test asserting `Right`, after this ticket
would reasonably conclude the hardening was reverted — the exact confusion this ticket exists to prevent.

What actually closes the gap the preview characterization test was written to expose is a **new** test asserting
that preview rejects a `join` edit whose `joinKey` is *present but of the wrong JSON type*. That is the proof;
the original test becomes its paired guard, sited next to it so the pair is legible in one place.

We do not contrive a flip. Three honest flips and two correctly-labelled guards is the accurate outcome — the
principle applies to the fourth exactly as it applies to the fifth.

## D7 — Shipped specs this change contradicts

A change that narrows a shipped guarantee must carry a MODIFIED delta saying so. Rounds 3-5 each found one by
inspection, in a new place, which is the signature of an unbounded search. Round 6 replaced that with an
enumeration: grep all 21 `pipeline-*-op` specs for tolerance language, classify each hit as config-decode
tolerance (this change's surface) or row-data tolerance (not), and record a verdict per spec. Full table in
`spec-tolerance-enumeration.md`.

Result: 14 carry the language, **4 need a delta** (`assert`, `dedupe`, `chunk-by-token-count`, `compute`), 10 are
unaffected. All 4 now have one. The enumeration is the falsifiable artifact — overturning it means naming a
row-data hit this change actually reaches, or a config hit missed.

`pipeline-compute-op` was the one found by the enumeration rather than by inspection, and it is the case the
production measurement had already flagged: its requirement says a compute step SHALL append a field named
`column` to every row, unconditionally, which with an empty `column` writes a field named `""`.

## D8 — Two fields the shipped specs settle, so D3 must not re-decide them

The requiredness column that D3 keys off is produced during execution (task 1.1), which means a field could be
marked `required` even though a shipped spec blesses its absent or empty value — reintroducing exactly the
defect class D7 exists to close, after the design gate has already closed. Two are pinned here:

- **`limit.count`** — `pipeline-limit-op:9` and its named scenario "Count is zero or negative" guarantee that a
  missing, zero, or negative count returns all rows. **Optional with a legitimate default.** No delta needed;
  D4 rejects only an unrepresentable value.
- **`sort.sortBy`** — `pipeline-sort-op:10` and its named scenario "Empty sortBy is a no-op" guarantee that an
  empty sort key list returns rows in original order. **Optional with a legitimate default.** No delta needed.
  Note `SortStep` is already in the change's blast radius via task 2.3's item-level strictness, which is
  unaffected by this: a *malformed element* still fails, an *empty array* is still a no-op.

- **`cast.casts`** — `pipeline-cast-op:35` "Empty casts map is a no-op". **Optional with a legitimate default.**
- **`rename.renames`** — `pipeline-rename-op:25` "Empty renames map is a no-op". **Optional with a legitimate
  default.** (Both also already blessed on the write path by HEL-860's "An omitted key is not rejected".)
- **`filter.conditions`** — `pipeline-filter-op:11` requirement text: "An empty `conditions` array SHALL pass all
  rows." **Optional with a legitimate default.**
- **`select.fields`** — `pipeline-select-op:24` "Select with empty fields list produces empty rows". **Optional**,
  but note this one is *behaviour-defining rather than a no-op*: an empty list has a specified, non-identity
  result (every output row is `{}`). Marking it required would break a named scenario in a way a reader skimming
  for "no-op" would not anticipate.

- **`dedupe.keys`** — `pipeline-dedupe-op:9` "When `keys` is empty, rows are compared as whole rows", plus the UI
  requirement `:52` ("Leaving the key multi-select empty SHALL be a valid configuration (whole-row distinct)")
  and named scenarios `:59` and "Whole-row distinct". **Optional with a legitimate default**, and — like
  `select.fields` — *behaviour-defining rather than a no-op*: empty means whole-row distinct, a different and
  fully specified algorithm, not a pass-through. **This change's own `pipeline-dedupe-op` delta restates that
  sentence verbatim at its line 5**, so marking `keys` required would have put two files of this change in direct
  contradiction, not merely created a latent execution risk.

**No MODIFIED delta is needed for any of the seven.** Classifying them optional preserves every shipped guarantee,
and the runtime-completeness requirement never reaches them. Were the design to instead want any of them to fail
the run, that capability would need a delta in this change — that is the trade, stated so it is not made silently.

**Why these seven and not others.** All seven are the *sole or principal* config of their step kind, which is
exactly why task 1.1's requiredness heuristic would mark them `required` — "the step does nothing without it"
reads true of each, and yet each has a shipped scenario saying the empty case is legitimate. Two of the seven
(`select.fields`, `dedupe.keys`) are stronger still: their empty case is *behaviour-defining*, a specified
non-identity result rather than a no-op, so the damage from marking them required is a silently changed
algorithm rather than a spurious failure. That is the trap D8 exists to disarm, and the heuristic that springs it
should be treated as a prompt to read the spec, never as an answer.

The first two were missed by D7's first pass because they state tolerance as behaviour ("no-op", "SHALL return all rows")
rather than in the vocabulary that pass grepped for. The other four were missed again by the second pass, because
that pass was run only over the 7 zero-hit specs — leaving the 14 classified from their pass-1 hits alone, so a
*second* guarantee inside an already-classified spec went unseen. Three patterns have now been run over all 21;
see `spec-tolerance-enumeration.md`. Pattern-based recall is not a completeness proof, which is why task 1.2b —
a per-field, per-citation check performed during execution — is the actual guarantee here, not the enumeration.

## Evidence plan

- **Proof** (must be shown red before the fix): the 3 flipping decode tests; the NEW wrong-type preview-rejection
  test (task 7.2 — the preview characterization test itself does not flip, see D5); and new assertions covering the
  two previously-unguarded write surfaces and the D3/D4 behaviors.
- **Guards** (green before and after, failable by mutation, labelled as guards): the `join` read-tolerance test,
  the `PatchSetPreviewServiceSpec` preview test, the "draft still saves" and "draft still lists" cases, and
  HEL-860's cast/rename **write-path rejection** tests (those remain green).
- **Tests this change also moves, beyond HEL-671's five** — the "3 of 5" table is an account of the
  characterization tests only, not of total test impact:
  - `PipelineStepRoutesSpec.scala:1019-1035` — legacy wrong-type row now 500s rather than returning 200 with an
    empty map. **Proof** that D1 took effect.
  - `PipelineAnalyzeProposalRoutesSpec.scala:429-434` — asserts the typed decoder yields an empty cast map; under
    D1 it raises. **Proof**.
  - `AssertStepSpec.scala:48-53` — `{"rules":["not-an-object",42,null]}` asserts 3 all-default rules; under D1 +
    task 2.3 the whole config fails. **Proof**.
  - `AssertStepSpec.scala:70-73` — `params: "not-an-object"` asserts `JsObject.empty`; under D1 a non-object for
    an object-valued key raises. **Proof**.
  - `AssertStepSpec.scala:55-58` — `AssertConfig.decode("42")` asserts `AssertConfig(Vector.empty)`. This is the
    `asObject` non-object fallback that task 2.4 must decide; whichever way it goes, this test is the thing that
    decision moves or preserves, and it must be named in 2.4 rather than discovered.
  - `ChunkByTokenCountStepSpec.scala:145-149` and `PipelineStepConfigCodecSpec.scala:262-265` — assert today's
    enum coercion for `encoding` and `dedupe.keep`. Per D4's layer decision decode still returns a value, so these
    become **guards** on case-normalized input, with the unknown-value rejection proven at analyze/run.
  This list, not the "3 of 5" table, is the account of total test impact; the table covers HEL-671's
  characterization tests only.
- Every assertion checks decoded **contents** or an observable HTTP status and message — never that decode "did
  not throw", which is the property the bug preserves.

## Risks

- **Prod populations were sampled, not exhaustively frozen.** 233 rows across two environments is strong but not
  a proof of absence for wrong-type rows created between measurement and deploy. Mitigated by wrong-type being the
  only read-path failure mode and by the write path rejecting new ones from every surface.
- **D3 changes run outcomes for the 20 existing draft rows**: they currently run and produce degraded output;
  they will now fail with a named reason. That is the intended correction, and it is visible rather than silent.
- **Scope is wide** (23 step files). Mitigated by the per-field requiredness table being derived by enumeration
  and reviewed as data, not written per-file from intuition.
