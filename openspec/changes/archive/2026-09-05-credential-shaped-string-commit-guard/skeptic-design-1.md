## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md` (116 lines), `tasks.md` (80 lines),
`specs/agent-surface-credential-gate/spec.md` (133 lines).

**Ground truth read (not taken from the artifacts):**
- `scripts/check-no-credential-in-agent-surface.mjs` at `66f302f5` — `SURFACES` (l.187), `KNOWN_CHECKS` (l.208),
  `VENDOR_PREFIX_SECRET_REGEX` (l.282), `NAMED_SECRET_LITERAL_REGEX` (l.290), `SYNTHETIC_SECRET_MARKERS` (l.300),
  `isSyntheticSecretLiteral` (l.310), `checkSecretLiterals` (l.462), `runChecksForSurface`/`needsText` (l.604–635),
  `ACKNOWLEDGED_UNSCANNED` (l.665), `PARTIAL_COVERAGE` (l.653+), `IGNORED_TOP_LEVEL` (l.640+).
- HEL-956 `351d0168` and HEL-993 `66f302f5` present in this worktree's history (`git log --oneline`).

1. **"`check:no-credential-leak` is absent from CI" — CONFIRMED.** `grep -n "check:" .github/workflows/ci.yml`
   lists `check:e2e-types`, `check:helio-mcp-types`, `check:node-root-encoding[:selftest|:ts|:ts:selftest]`,
   `check:dependabot[:selftest]`. No credential-leak step; the only `credential` matches in that file are prose
   comments (l.57, 270, 272, 334, 340). Decision 6's premise holds.
2. **"`openspec`/`docs`/`notes` are in `ACKNOWLEDGED_UNSCANNED`" — CONFIRMED** verbatim at l.665–674, and the
   `scripts` entry does say "HEL-846 is the intended generic backstop", as does `PARTIAL_COVERAGE.backend`. Task 4.3's
   requirement to retire those forward-references is therefore real and correctly scoped.
3. **Decision 2's false-positive measurement — RE-RUN INDEPENDENTLY, REPRODUCES.** I applied the three candidate
   rules to `git ls-files openspec docs notes` (5,882 files) with the repo's own regexes:
   - `VENDOR_PREFIX_SECRET_REGEX` non-exempt: **0**.
   - `NAMED_SECRET_LITERAL_REGEX` non-exempt under today's marker set: **17** — including exactly the values
     design.md names (`bindingKey = "outputId"`, `key = "dashboard"`, `password = "correct horse battery staple 1!"` ×4,
     `apiKey = "YOUR_NVD_API_KEY"`, `idempotencyKey = "skeptic-live-key-1"`, `token = "sekret-token"`), all but one under
     `openspec/changes/archive/**`. The "~15" figure and the "immutable archived evidence" argument both hold.
   - High-entropy variant (`[A-Za-z0-9+/=_-]{32,}`) with the widened + `_`→`-`-normalized marker set: **0**.
   - Same variant **without** normalization/widening: **1** — `CONNECTOR_MASTER_KEY = REPLACE_WITH_OUTPUT_OF_openssl_rand_dash_base64_32`
     in `docs/cloud-dev-setup.md`. So Decision 2's "normalization measured to matter" is true, for that value.
   Decision 2 is genuinely settled, and settled the right way: no allowlist, and the exclusion is *structural*
   (length/alphabet), not per-value.
4. **CONTRIBUTING.md is durable and not a render target — CONFIRMED.** It is tracked at repo root
   (`git log -1 -- CONTRIBUTING.md` → `16b02136`), and it appears in `concertino.config.json` only under
   `canonicalDocs` (l.71–79) — a doc Concertino *points agents at* (`bindTo: ["executor","evaluator"], when: "always"`),
   not a file it renders. `.concertino/` contains only `laws/` + `workflow-state.template.md`. Decision 5 is correct on
   both halves (durable, and actually read by delivery agents).
5. **Decision 1 (detect-and-block) is genuinely settled**, with reasoning that holds: redaction does not revoke,
   a rewritten transcript is the "fixture edited to make tests pass" failure mode, and every sibling `check:*` in this
   repo reports-and-exits rather than mutating. Not escalated — correct, it is reversible and low-stakes.
6. **Gate-Chain Implications Checklist present verbatim** with all five questions answered, and answered against the
   script's actual behavior (I checked: it imports only `node:fs`/`node:path`/`node:url`, derives paths from
   `import.meta.url`, writes nothing, and never invokes git — so the poisoned-`GIT_DIR` class genuinely does not apply).
7. **Spec delta is well-formed.** Both `## MODIFIED Requirements` headers match existing headers in
   `openspec/specs/agent-surface-credential-gate/spec.md` exactly (l.9, l.86), and each MODIFIED body is a full
   replacement that *preserves* the existing scenarios rather than dropping them. `npm run check:openspec` → `openspec/ is clean`.
8. **No artifact states or implies a leak occurred.** `ticket.md`, `proposal.md` and `design.md` each explicitly assert
   the opposite; task 10.4 re-checks it at handoff. Correct.
9. **Constraints respected:** no Playwright/e2e in tasks (explicitly forbidden in tasks.md's preamble), no Flyway
   migration, `.husky/pre-commit` and root jest config explicitly out of scope (tasks 8.3). No browser work performed by me.
10. **Tasks §5 does force executed mutations** — the preamble states "Every 'this would go red' claim below must be an
    actually-executed command with its transcript pasted… Reasoning about a mutation is not evidence", and 5.4/5.5/5.6/7.4
    each name a specific mutation with a specific expected observation. Task 5.5's separate `needsText` mutation is
    exactly the HEL-956 CR1 silent-no-op class. This part of the plan clears the bar.

### Verdict: REFUTE

Three defects. CR1 is the substantive one: as written, the load-bearing evidence task is **not executable**, because the
change makes `openspec/**` a scanned surface and then requires the planted credential-shaped values to be written into a
file under `openspec/**`.

### Change Requests

1. **The change's own evidence file self-triggers the new gate — unaddressed anywhere in the design.**
   `tasks.md` §5 preamble instructs: "Write every transcript into
   `openspec/changes/credential-shaped-string-commit-guard/mutation-evidence.md`. Use only obviously synthetic planted
   values **carrying no synthetic marker (a marker would exempt them)** — e.g. a `helio_pat_` followed by 64 characters…
   and a 44-character base64-shaped blob assigned to `API_KEY`."
   Task 4.1 simultaneously makes `openspec/` the `delivery-evidence` surface with `checks: ["deliverySecret"]`. So the
   moment the transcript is written, the gate matches its own evidence file and goes red — permanently, and in
   merge-blocking CI (Decision 6). The executor hitting this mid-run will resolve it silently, and the two obvious
   silent resolutions are both bad: weaken the plant until it stops matching (destroying the proof), or add an
   allowlist entry (violating Decision 2's explicit promise).
   This is not hypothetical: I verified `checkSecretLiterals`' failure message names `file:line` only and does **not**
   echo the matched value (l.468–472, l.481–485), so the *gate output* is safe to paste — it is only the plant lines
   themselves that are unsafe.
   Required: state the resolution in `design.md` (a new decision or an extension of Decision 2) and in `tasks.md` §5 —
   e.g. plant into a `.gitignore`d scratch path and paste the transcript with the planted value **elided or
   marker-carrying** in the committed evidence, with the *unelided* value existing only in the untracked plant. Also
   state the standing consequence this creates for the repo: **from this change onward, every evidence, review and
   archive file under `openspec/**` that quotes a credential-shaped value must carry a marker or elide it.** That is a
   new, permanent constraint on all future delivery prose and Decision 2 currently does not mention it, even though its
   own claim ("No new evidence file will ever need to add an entry to the gate") is only true *because* authors are
   expected to follow that convention.

2. **Task 5.6 as written can rename `openspec/` out from under the running delivery.**
   5.6 says "Rename one new surface root and show the vacuous-surface failure naming it. Restore." Two of the three new
   roots are safe to rename; `openspec/` is not — it contains this change's own directory (including the artifacts under
   review and the evidence file from CR1) and `openspec/specs/**`, on which `check:openspec` and the delivery
   `assert-phase.sh` chain depend. A crashed or interrupted run mid-rename leaves the worktree in a state where the
   change directory no longer exists at its expected path. Required: pin 5.6 to `notes/` or `docs/` explicitly, or use
   the existing mutated-copy harness convention (the `scripts/.hel956-selftest-mutated-surfaces.mjs` /
   `scripts/.hel993-selftest-mutated-entry.mjs` pattern already in `.gitignore`) to point the surface root at a
   nonexistent path instead of moving a tracked tree. Forbid renaming `openspec/`.

3. **`design.md` Decision 2's measurement table is mislabelled, and the wrong number is the one likely to be copied
   forward.** The table header reads "Hits on `openspec/` + `docs/` + `notes/` (**7,610 files**)". Measured: those three
   trees hold **5,882** tracked files. 7,610 is the count for the *nine-tree* probe described in the Gate-Chain
   checklist ("`openspec/`, `docs/`, `notes/`, `schemas/`, `e2e/`, `scripts/`, `frontend/src/`, `backend/src/`,
   `helio-mcp/`") — I reproduced both numbers exactly (`git ls-files <9 trees> | wc -l` → 7610). The Risks section then
   compounds it with "measured zero against 7,610 files", which overstates the surfaces actually being added. Given this
   repo's documented history of confidently-false documentation surviving into a shipped script header (HEL-373; task
   4.4 puts these numbers *into* that header), correct the table label to the scanned-surface count and keep 7,610 only
   where the nine-tree probe is what is being described.

### Non-blocking notes

- Decision 2 justifies marker normalization with two values, but only one (`REPLACE_WITH_OUTPUT_OF_openssl_rand_dash_base64_32`,
  `docs/cloud-dev-setup.md`) is on a surface this change scans. The other,
  `re_test_key_should_never_be_logged`, lives in `backend/src/test/scala/com/helio/email/HttpResendEmailSenderSpec.scala`
  — a tree Decision 3 explicitly leaves unscanned. Normalization is still justified (the docs/ hit alone justifies it,
  and Decision 3 names the nine code-tree values it prepares for), but "measured to matter" reads as if both were live
  false positives today. One clause fixes it.
- Decision 3's honest scope boundary and task 4.3's retirement of the now-false "HEL-846 is the intended generic
  backstop" reasons are exactly right, and are the kind of thing that usually gets missed. Worth keeping verbatim.
- Task 3.1's proposed regex allows an *unquoted* value (`optional quote`), which is necessary for markdown transcripts
  and is what makes CR1 bite. Worth a comment in the shipped regex explaining why the quote is optional there when
  `NAMED_SECRET_LITERAL_REGEX` requires it.
