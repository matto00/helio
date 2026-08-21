## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit under review: `a8234482`. Base: `8432f280` (verified still == `origin/main`, and an ancestor of
`HEAD`). No UI surface — `git diff --name-only 8432f280...HEAD` contains no path under `frontend/**` or
`backend/**`, so no dev servers were started and no visual review was performed, per the brief.

Every finding below is from a command I ran myself in this session. The evaluator's report and
`files-modified.md` were read only as claims to refute. All probes ran in sandbox copies under the
session scratchpad; the real worktree tree was never archived, and nothing under `openspec/changes/`
outside this change's own directory was written.

---

### What I verified (with evidence)

#### 1. No requirement lost or altered — verified mechanically, at full-block granularity

I wrote my own comparator (`scratchpad/hel775/blockdiff.py`) rather than reusing anyone's. A block runs
from a `### Requirement:` header to the next line matching `/^(##|###)\s/`, so `#### Scenario:` blocks
and their `- **WHEN**` / `- **THEN**` bullets are **inside** the hash. Run over every canonical spec at
both revisions:

```
BASE spec count: 317
HEAD spec count: 317
REMOVED from HEAD: []
ADDED in HEAD: []

TOTAL DIFFERENCES: 1
---
openspec/specs/schema-inference/spec.md | BLOCK-HASH-DIFFERS: InferredSchemaResponse wire format
  base: e1294cc7029bca87
  head: bd627d00fd21df14
```

Ordered requirement-name lists are identical in all 317 files; exactly one block hash differs
corpus-wide, and it is the human-approved exception. No second difference.

**I self-tested my own comparator before trusting it**, because a vacuous checker would report the same
"1 difference" result:

```
=== SELF-TEST: mutate one THEN bullet, confirm hash changes ===
blocks whose hash changed after mutating ONE THEN bullet: ['JSON schema inference']
=== SELF-TEST 2: delete a whole SHALL line ===
changed after deleting first SHALL line: ['JSON schema inference']
```

Corroborated at line level: I read the **entire** `git diff 8432f280...HEAD -- openspec/specs/`. Every
changed line is a `## `-level heading or part of a prepended `## Purpose` block, except the three lines
of the approved scenario in `schema-inference`. No `### Requirement:`, `#### Scenario:`, `- **WHEN**` or
`- **THEN**` line changed anywhere else.

**The repair set is exactly right — no over-repair, no under-repair.** I enumerated the malformed set
myself on the unrepaired baseline and diffed it against the files this commit touched:

```
union of guard-flagged files on UNREPAIRED base: 26
files changed by this commit under openspec/specs: 26
diff -> IDENTICAL — repair set exactly matches the mechanically-enumerated malformed set
```

(24 flagged by validator ERROR + 25 flagged by set-disagreement; union 26. This also independently
reproduces tasks.md 1.4's predicted "25 visible != total".)

#### 2. The one approved exception is within its bounds — compared word by word

Requirement's existing SHALL sentence, and the added scenario:

```
`POST /api/sources/infer` and `POST /api/data-sources/infer` SHALL both return the same response
envelope: `{ "fields": [{ "name": string, "displayName": string, "dataType": string, "nullable": boolean }] }`.

#### Scenario: Both infer endpoints return the same envelope
- **WHEN** `POST /api/sources/infer` and `POST /api/data-sources/infer` are each called
- **THEN** both return the same response envelope
  `{ "fields": [{ "name": string, "displayName": string, "dataType": string, "nullable": boolean }] }`
```

The WHEN is the SHALL's subject restated as a trigger. The THEN is the SHALL's predicate plus an
envelope literal that is character-identical to the one in the SHALL sentence. No status code, no error
path, no field semantics, no nullability rule, nothing that is not already in that one sentence. It
also matches tasks.md 10.1's mandated wording verbatim. Constraint 1 of design.md 3a is satisfied — the
declined "invent spec content" option did not arrive by the back door.

#### 3. The guard is capable of failing — six fixtures I built myself, plus a control

Built under the scratchpad, never in `openspec/specs/`. Each run in its own directory so I could
confirm the guard names the offending file individually.

| Fixture I built | Guard exit | Message (abridged) |
| --- | --- | --- |
| control: well-formed spec | **0** | "spec-structure check passed (1 canonical specs, 0 issues)" |
| (a) raw delta file | **1** | stray `## ADDED Requirements` + both reqs hidden from parser *and* validator + "Spec must have a Purpose section" |
| (b) hidden appended `## ADDED Requirements` section | **1** | "hidden from delta parser: Hidden bonus requirement; hidden from validator: …" |
| (c) `## Purpose` removed | **1** | validator's own "Spec must have a Purpose section" |
| (d) stray `## MODIFIED Requirements` | **1** | stray heading + "Modified stray requirement" hidden |
| (e) requirement after a level-1 `#` inside the requirements body | **1** | "requirement-name sets disagree (**hidden from validator**: Requirement hidden from the validator only)" |
| (f) duplicate requirement name | **1** | "duplicate requirement name(s): Dashboard can be deleted via DELETE endpoint" |

Fixture (e) is the load-bearing one: it is invisible to the validator but **visible** to the delta
parser, so it passes `openspec validate` and a parser-only check, and only the set-equality invariant
catches it. Design decision 3's rejection of the two narrower designs is empirically correct.

**Attempts to defeat it.** I built four more adversarial fixtures beyond the brief:

- empty `## Requirements` section → caught ("Spec must have at least one requirement").
- `## Requirements (v2)` (heading with a suffix, invisible to the delta parser's anchored regex) →
  caught (sets disagree + "Spec must have a Requirements section").
- `## Purpose` placed *after* `## Requirements` → guard **passes**; I then ran a real `MODIFIED`
  archive against it and archive **succeeded**, so this is a correct pass, not a hole.
- I also read openspec's own `dist/core/specs-apply.js` to enumerate every abort path
  (`RENAMED/REMOVED/MODIFIED … not found`, and rebuilt-spec invalidity). Every one of them is gated on
  either delta-parser visibility or validator validity — both halves of the invariant. **I could not
  construct a spec the guard passes that still aborts a real archive.**

#### 4. Archive genuinely works now — asserted on stdout, never on `$?`

All probes in sandbox copies. Assertions are string checks for `Specs updated successfully` present and
`Aborted` absent.

| Probe | Tree | Result |
| --- | --- | --- |
| `MODIFIED` vs `dashboard-delete` (Class A) | **repaired** | `Specs updated successfully.` / no `Aborted` |
| `REMOVED` vs `schema-inference` (Class B, 8 reqs) | **repaired** | `Specs updated successfully.` / no `Aborted`; 7 reqs remain |
| `ADDED`-only vs `panel-ordering` (Class A) | **repaired** | `Specs updated successfully.` |
| `MODIFIED` vs `dashboard-delete` — control | unrepaired | `MODIFIED failed … - not found` / `Aborted. No files were changed.` |
| `ADDED`-only vs `panel-ordering` — control | unrepaired | `✗ Spec must have a Purpose section` / `Aborted.` |
| heading-rename-ONLY vs `dashboard-delete` (AC2) | rename-only | `✗ Spec must have a Purpose section` / `Aborted.` |

I confirmed archive's exit-0-on-abort first-hand: the control printed `Aborted. No files were changed.`
while my shell captured `RAW-EXIT=0`. An exit-code assertion here would have reported false green.

The `REMOVED` probe correctly targeted a multi-requirement Class B capability; I did not mistake the
legitimate single-requirement `Spec must have at least one requirement` abort for a defect.

Post-archive content intact: `dashboard-delete`'s untouched requirement survived verbatim with its
Purpose; `schema-inference` retained 7 requirements including the approved-exception one.

**Phase-3 de-risk (beyond the brief).** I archived *this change itself* in a sandbox:
`Specs updated successfully.` / `openspec-spec-hygiene: create / + 5 added`, and the new guard is still
green on the resulting 318-spec tree. This change will not abort its own archive.

#### 5. All 24 authored `## Purpose` blocks — read individually, not sampled

I read every one of the 24 (Class A ×19, Class C ×3, Class D ×2) against that file's own requirement
bodies and scenario titles. **None asserts behavior its requirements do not support; none misdescribes
its capability; none reads as invented.** Each clears the 50-character WARNING threshold.

Where a Purpose summarized more than the requirement *headings* carry, I went to the file text rather
than accepting it:

- `dashboard-duplication` — "navigates to the newly created copy" is the file's own scenario title
  ("Duplication navigates to the new dashboard"), not a paraphrase I had to grant.
- `panel-delete` — "across all breakpoints" is verbatim in the requirement body and its scenario
  ("removed from the dashboard layout for all breakpoints (lg, md, sm, xs)").
- `panel-duplication` — "default layout resolution logic" is verbatim in the requirement body.
- `frontend-dashboard-selection-flow` — "preserving an existing valid selection" and "lazy
  per-dashboard panel loading" are both scenario titles in the file.
- `dashboard-partial-update` — "fields/dashboard payload envelope" matches the requirement's
  "`fields` envelope and a `dashboard` object".
- `dashboard-rename` / `panel-title-edit` — "keyboard and blur confirmation" matches the Enter / Blur /
  Escape scenarios.
- `user-preference-update` — "session-authenticated" matches "identity is derived from the session
  token"; "(zoom level, accent color)" matches the two named scenarios.
- `csv-upload-connector`, `layout-undo-redo`, `oauth-error-display`, `overlay-management`,
  `panel-polling`, `rest-api-connector`, `resource-metadata`, `smart-panel-placement`,
  `frontend-protected-routes`, `dashboard-appearance-settings`, `dashboard-panel-layouts`,
  `dashboard-delete`, `dashboard-ordering`, `panel-ordering`, `dashboard-create-route-validation`,
  `frontend-dashboard-creation` — each traced to its own requirements with no surplus claim.

#### 6. The tasks.md 7.1 deviation is equivalent — measured on the discriminating corpus

The guard calls the imported `Validator.validateSpec(path)` per file rather than shelling out to
`openspec validate --specs`. The repaired tree cannot discriminate, so I ran both against the
**unrepaired** baseline:

```
openspec validate --specs on 8432f280:  Totals: 293 passed, 24 failed (317 items)
guard's validator half on same tree:    24 files flagged "openspec validator reports ERROR(s)"
diff of the two sorted id lists:        IDENTICAL SETS
```

The deviation loses nothing and buys the capability that made section 3 above possible at all — the
guard can be pointed at a fixtures directory outside a scaffolded openspec project. It is documented at
the point of use (`scripts/check-spec-structure.mjs:22-30`). Judged equivalent and an improvement.

#### 7. Wiring, gates and cleanliness

- `.husky/pre-commit:7` is `npm run check:spec-structure`, `:8` is `npm run check:openspec` — the guard
  runs **before** the known-false-positive check, under `set -e`, as design decision 2 requires.
- `package.json` exposes `"check:spec-structure": "node scripts/check-spec-structure.mjs"`.
- Missing-CLI convention matches the precedent: the guard exits 2, as `check-openspec-hygiene.mjs:28`
  does. `openspec` is a global CLI for both scripts — no new dependency posture.

Fresh gate runs of my own, in the worktree:

```
npm run lint            -> exit 0
npm run format:check    -> exit 0  "All matched files use Prettier code style!"
npm run check:openspec  -> exit 0  "openspec/ is clean"
npm run check:spec-structure -> exit 0  "spec-structure check passed (317 canonical specs, 0 issues)"
openspec validate --specs    -> Totals: 317 passed, 0 failed (317 items)
openspec validate repair-malformed-canonical-specs --type change -> valid
npx jest --passWithNoTests   -> exit 0 (root half of `npm test`)
```

`npm --prefix frontend test`, `npm --prefix frontend run build` and `sbt test` are N/A — no
`frontend/**` or `backend/**` path in the diff, so no runtime behavior can change.

AC5: `shared-status-message` and `frontend-panel-empty-state` are both `is valid`, carry zero delta-only
headings, and are correctly **not** touched by this commit (verified, not assumed, and not silently
"re-repaired").

No probe artifacts leaked. `git status --untracked-files=all` shows only
`M openspec/changes/…/workflow-state.md` and `?? openspec/changes/…/evaluation-1.md` — both this
change's own workflow-tracking files. All my sandboxes live under the session scratchpad.

---

### Verdict: CONFIRM

The ticket's own worst outcome — a silently dropped or altered requirement — is refuted mechanically at
full-block granularity with a self-tested comparator: exactly one licensed difference across 317 specs
and 1476 requirement blocks. The single approved exception is a strict restatement of text already in
the file. The guard fails red on six fixtures I built myself, including the parser/validator divergence
case that only the set-equality invariant catches, and I could not construct a spec that passes it and
still aborts a real archive. The bug reproduces on the base tree and is gone on the repaired one, proven
on stdout rather than exit code. All 24 authored Purposes are traceable to their own requirements. Ships.

### Non-blocking notes

1. **tasks.md 9.4 is still genuinely outstanding.** My sandbox archive of this change produced
   `## Purpose\nTBD - created by archiving change repair-malformed-canonical-specs. Update Purpose after
   archive.` for the new `openspec-spec-hygiene` spec. That placeholder passes the new guard (Purpose
   present, >50 chars), so nothing will catch it automatically. Phase 3 must hand-write it, as 9.4 says
   — on a spec-hygiene ticket specifically, it would be a poor look to leave.
2. **The guard fails closed on a `### Requirement:` line inside a fenced code block.** I put an
   illustrative fenced `### Requirement:` inside a trailing `## Notes` section of an otherwise
   well-formed spec; `inFileRequirementNames` (`scripts/check-spec-structure.mjs:99-106`) scans raw
   lines and does not skip fences, while the parser and validator both correctly ignore it, so the guard
   reports "sets disagree" on a spec a real archive handles fine. Zero canonical specs have this shape
   today, and the failure direction is the safe one (blocks a commit rather than passing a defect), so
   this is not worth holding the ticket for — but a future spec that documents the delta format inline
   will trip it, and the fix is a three-line fence-skip in `inFileRequirementNames`.
3. **Residual upstream hazard the invariant does not cover (out of scope, flagged for the record).**
   openspec's `extractRequirementsSection` ends the requirements section only on `/^##\s/`, so any
   trailing non-requirement content inside that section — including a level-1 `#` heading and its prose
   — is absorbed into the *last* requirement block's `raw` and is silently destroyed if a later
   `MODIFIED`/`REMOVED` delta targets that requirement. This is upstream archive behavior, explicitly a
   non-goal here, and I confirmed **0 of 317** canonical specs currently have that shape. Noting it only
   so a future reader does not assume the new guard covers it.
