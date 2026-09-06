## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Scope: ONLY the round-2 change requests and the folded-in notes. The already-CONFIRMed AC2 work
was not re-litigated. No backend server, no backend spec, no DB connection was opened (HEL-974
holds the shared dev Postgres).

### What I verified (with evidence)

**CR1 — the `$()` substitution cannot fail the step. CLOSED, all four parts.**

1. *Overclaim removed.* `grep -rn "no skew possible\|skew is impossible\|impossible" design.md` →
   **no hits, exit 1**. Decision 6 now opens its second paragraph with "Single-sourcing alone is not
   sufficient, and claiming otherwise would reintroduce the very failure it targets", and reproduces
   the `bash -e {0}` / argument-position reasoning correctly (including that only the outer `npm`'s
   status is consulted).
2. *Failable form is required, not suggested.* tasks.md 4.2 specifies the exact three-step shape
   (`V="$(...)"` → `[ -n "$V" ] || exit 1` → `npm i -g "@fission-ai/openspec@$V"`) and adds an
   explicit prohibition — "Do NOT inline `$(...)` directly in the npm argument" — with the reason.
   Design Decision 6 carries the same as its first bullet.
3. *The sharp runtime guard exists as its own task.* NEW task 4.2a requires
   `- run: npm run check:openspec-version` **immediately AFTER the install step and BEFORE the
   openspec checks** — the exact placement I asked for, with the variant list (empty print, wrong
   print, stale cache, registry redirect) recorded as its rationale. Confirmed this step is genuinely
   absent today: `grep -n openspec .github/workflows/ci.yml` shows only the self-test step at line 64
   plus comments — no version step anywhere.
4. *4.4 is correctly demoted.* It now reads "this is an authoring-time content check and is NOT the
   guard for a failed runtime invocation — 4.2 and 4.2a are". That is the distinction CR1 turned on.
5. *4.1's output contract is tightened and is implementable.* Task 4.1 now says "STDOUT ONLY — one
   line, bare version, no banner or prefix". Verified against the script: every existing emission in
   `scripts/check-openspec-version.mjs` is `console.error` (lines 44,45,50,53-59) — zero `console.log`.
   So a stdout-only `--print-expected` is additive and `$()` will not pick up the existing banner.

**CR2 — the un-archive reset staged but uncommitted. CLOSED.**

6. NEW task 4.0 is ordered **FIRST, "as its own commit before any re-archive"**, and covers both
   halves (change-dir restoration out of `openspec/changes/archive/` AND both `openspec/specs/**`
   files), with both verification commands I specified.
7. The reset itself is substantively correct in the worktree — I checked each target file against
   `main` individually: `git diff main -- openspec/specs/openspec-spec-hygiene/spec.md` → **empty**,
   `git diff main -- openspec/specs/agent-surface-credential-gate/spec.md` → **empty**.
8. The defect CR2 named is still live and therefore still needs 4.0 to actually run:
   `git grep -n "self-test is enforced in continuous integration" HEAD -- openspec/specs/` still
   returns `HEAD:openspec/specs/openspec-spec-hygiene/spec.md:93`, while the change delta
   (`specs/openspec-spec-hygiene/spec.md:3`) adds the renamed
   "The hygiene guard **and its self-test** are enforced in continuous integration". Committing 4.0
   is what prevents canonical specs carrying both.

**Folded-in notes — both present.**

9. Decision 6's final paragraph keeps the mechanically-correct gate-chain statement and now adds
   "That is a statement about which obligations apply, not about stakes: this amendment makes the
   script newly **load-bearing for a merge-blocking CI job**, and the runtime assertion above is what
   makes it safe to be." That is note 1, accurately.
10. NEW task 4.7 adds the `ci.yml` install-step comment pointing at the script header's
    "detection, not a true dependency pin — tracked separately". That is note 2.

### Verdict: CONFIRM

Both change requests are genuinely closed at the mechanism level, not merely acknowledged: each one
produced a concrete, checkable task obligation (4.2 form, NEW 4.2a step, 4.4 demotion, 4.1 stream
contract, NEW 4.0 commit) rather than a prose reassurance. The amendment is sound enough to implement.

### Non-blocking notes

- **Scope task 4.0's first verification command — `main` moved under it.** `main` is now at `c9e3c051`
  (HEL-974, merged after this branch's merge-base `010f67f0`) and that commit **added**
  `openspec/specs/pipeline-zero-root-db-guard/spec.md`, a file unrelated to this change. So
  `git diff main -- openspec/specs/` now reports `1 file changed, 63 deletions(-)` for that file and
  will **never return empty** on this branch until it rebases — through no fault of the reset. Taken
  literally the task is unsatisfiable, and "fixing" it would mean pulling an unrelated spec file into
  this change's diff. Use the scoped form instead:
  `git diff main -- openspec/specs/openspec-spec-hygiene/spec.md openspec/specs/agent-surface-credential-gate/spec.md`
  (I ran it — **empty**), or `git diff "$(git merge-base HEAD main)" -- openspec/specs/`. The second
  command in 4.0 (the `git grep ... HEAD` one) is unaffected and remains the sharp check.
- Task 4.3's replacement of the task-1.5 step lands where the existing HEL-996 comment block already
  sits (`ci.yml:56-64`); that comment already answers AC4's "why this one differed" for the self-test,
  so 4.3's new comment should extend it rather than duplicate the reasoning a second time.
