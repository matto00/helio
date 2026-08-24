## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived every number from the live tree (structure-aware JSON walk, not grep), then
re-checked the round-1 findings that were previously confirmed, to make sure the revision
didn't break them.

**Round-1 change requests — all 5 genuinely resolved:**

1. **CR1 ($ref rewrite rule) — RESOLVED.** D4 now specifies
   `path.posix.relative(dirname(referrerNewPath), dirname(targetNewPath))`, states same-domain
   refs stay bare, gives the `../dashboards/…` cross-domain example, and explicitly rejects the
   flat `<domain>/<file>` prefix. I re-measured the cross-domain bare refs: exactly 6
   (`authoring-conversation`→dashboard-proposal + patch-set; `combined-proposal`→pipeline-proposal
   + dashboard-proposal; `dashboard-authoring-response`→dashboard-proposal;
   `refinement-response`→patch-set) — matching CR1's list, and every other bare ref is
   same-domain under D1 and correctly stays bare. The risk mitigation is also fixed: it now
   mandates `path.resolve(dirname(referrer), refPath.split("#")[0])` filesystem-existence
   checking and explicitly calls the old single-segment grep insufficient.
2. **CR2 ($id) — RESOLVED (with a factual caveat, see note 1).** D4 now rewrites the target's
   own `$id` in lockstep with the absolute `$ref`, with the resolution rationale stated. All 8
   distinct absolute-ref targets (auto-layout-item, dashboard-layout-item, dashboard-layout,
   resource-meta, dashboard-appearance, panel-appearance, dashboard-proposal, panel) do carry
   the `https://helio.local/schemas/<file>.schema.json` form, so the mechanism is sound.
3. **CR3 (ref inventory) — RESOLVED, numbers now exact.** My independent walk:
   **17 files, 35 cross-file `$ref`s = 24 bare-relative (9 carrying `#/$defs/…` fragments) +
   11 absolute, 0 other forms**; 66 same-file `#`-fragment refs correctly excluded. design.md's
   Context now states precisely 17/35/24/11 and the "9 with `#/$defs` fragments" detail. Match.
4. **CR4 (development-plan.md) — RESOLVED and correctly grounded.** Reproduced:
   `git ls-files development-plan.md` → empty; `ls development-plan.md` → No such file;
   `git check-ignore -v` (main checkout) → `.git/info/exclude:7:development-plan.md`. It exists
   only as an untracked local file in the main checkout. D7, tasks 2.2/2.3, proposal.md, and the
   ticket's Part 2 + AC bullet all now record this as unachievable-as-stated rather than
   dropping it. `orchestration-flow.html` **is** tracked (`git ls-files` → present), so task 2.1
   is executable.
5. **CR5 (openspec validate no-delta) — RESOLVED, precedent verified real.** proposal.md now
   carries the pre-emption paragraph citing
   `openspec/changes/archive/2026-08-22-repackage-backend-domain-subpackages` `proposal.md:49`;
   I re-read that line in the archive and it says exactly what is claimed ("expected, not a
   defect"). `--skip-specs` instruction present in both proposal.md and Planner Notes.

**Nothing broke in the revision:**

- **D1 mapping still exact.** Re-parsed the 14 domain bullets programmatically and diffed
  against `ls schemas/*.schema.json`: 14 domains, 76 listed, 76 on disk, **0 duplicates,
  0 omissions, 0 phantoms**, every declared per-domain count equals its listed names.
  D1 is also consistent with the revised D4 — every cross-domain pair D4 must compute a
  relative path for has both endpoints assigned to a domain in D1.
- D2/D3/D5 are unchanged from round 1 (which verified them at file:line) and remain internally
  consistent with D1's domain names.

### Verdict: REFUTE

Both remaining objections are the **same error class round 1 refuted on** (an understated
inventory giving the executor a wrong completeness target), just in D6 rather than D4.

### Change Requests

1. **D6's reference inventory is materially incomplete — it will leave stale flat schema paths
   behind, and its own count disagrees with tasks.md.**
   - D6 names 10 live `openspec/specs/**/spec.md` files as the "confirmed set". Measured:
     **11** files under `openspec/specs/` cite a specific `*.schema.json` filename. The missing
     one is **`openspec/specs/collection-panel-type/spec.md:81-82`**, which cites
     `create-panel-request.schema.json`, `panel.schema.json`,
     `update-panels-batch-request.schema.json` and `dashboard-proposal.schema.json` — precisely
     the 4-file panel-type-enum-parity set D3 is updating in the drift checker. This is the most
     contract-relevant reference of the whole set to miss. Add it to D6.
   - **tasks.md 1.6 says "the 9 live `openspec/specs/**/spec.md` files listed in D6"** while D6
     lists 10 and the truth is 11. Three different numbers across two artifacts. Make tasks.md
     reference the count as revised (11) or drop the numeral and say "every file listed in D6".
   - Outside `openspec/specs/`, D6 enumerates only 4 non-spec files (`docs/agent-native.md`,
     `helio-mcp/src/tools/proposal.ts`, `helio-mcp/src/types.ts`, `backend/build.sbt`). Measured
     across `*.scala`/`*.ts`/`*.tsx`/`*.sbt` (excluding `node_modules` and `schemas/` itself),
     the literal `schemas/<flat-file>.schema.json` path form appears **32 times across 21
     files** — i.e. **17 source files D6 does not enumerate at all**, including
     `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala`
     (4), `frontend/src/features/panels/types/panel.ts` (4),
     `frontend/src/features/pipelines/types/pipelineSchedule.ts` (4),
     `.../protocols/workspace/WorkspaceContextProtocol.scala` (2),
     `.../protocols/patchsets/PatchSetProtocol.scala` (2), plus 12 more with 1 each.
     Either enumerate them in D6 or state explicitly that source-comment references are out of
     scope — but do not leave it implicit.

2. **Resolve the scope ambiguity in task 1.7 / the ticket AC that CR1 above exposes.** Task 1.7
   and the AC both assert `rg -n 'schemas/' --glob '!node_modules'` will be "clean" / show "no
   stale flat paths in scripts, docs, or CI config". After the move, that grep will surface the
   ~32 source-comment hits above, which are *not* "scripts, docs, or CI config". A competent
   implementer can read this two ways — sweep them all, or declare them out of AC scope and
   leave 32 stale pointers behind — and there is no acceptance signal telling them which. Pick
   one and write it into both tasks.md 1.7/3.3 and the ticket AC bullet, so the evaluator has an
   unambiguous pass condition. (Recommend: sweep them — they are pure comment/doc pointers, the
   edit is mechanical and zero-risk, and leaving them stale re-creates the "find the contract for
   a given domain" problem this ticket exists to fix.)

### Non-blocking notes

1. **The "all 76 files carry `$id: https://helio.local/schemas/<file>.schema.json`" claim
   (Context section and D4) is false for 4 files.** Measured: all 76 do have a `$id`, but
   `paginated-query-result`, `panel-query`, `update-dashboard-request` and
   `update-panels-batch-response` carry a *bare relative* `$id` (e.g.
   `"$id": "panel-query.schema.json"`), not the absolute form. This is not blocking: none of
   the 4 is the target of any absolute `$ref`, and a relative `$id` remains self-consistent
   after the move, so a D4 script that pattern-matches the absolute form simply skips them
   correctly. But an executor who writes `assert(rewrittenIdCount === 76)` from D4's wording
   will get a confusing failure. Recommend a one-line note in D4: these 4 have relative `$id`s;
   leave them as-is (or normalize them, but say which).
2. proposal.md's **Impact** bullet still says `scripts/check-schema-drift.mjs — glob + `$ref`
   resolution logic`, the round-1 non-blocking note that "What Changes" was fixed for (it now
   correctly parenthesizes "The script does not itself perform `$ref` resolution"). The Impact
   line now contradicts the What-Changes line in the same file. Trivial wording fix.
3. `scripts/concertino/` is absent from this worktree; I ran `next-report-number.sh` /
   `persist-evidence.sh` from the main checkout, as round 1 did.
