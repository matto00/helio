# HEL-846: Redact credentials from delivery evidence files before committing

## Description

This is **preventive hardening, not incident response.** A history scan against `main` confirmed that no real-shaped credential has ever landed in `openspec/changes/**`: a sweep of `helio_pat_[A-Za-z0-9]{20,}` across every commit that ever touched that tree returns zero hits, and every `helio_pat_` / `sk-ant-` occurrence at HEAD is prose, a bare-prefix mention, a spec placeholder (`helio_pat_<valid-token>`, `helio_pat_...`, `helio_pat_xxxxxxxx`) or a deliberately synthetic fixture (`sk-ant-SECRET-SHOULD-NEVER-LEAK-xyz` in the HEL-401 archive). HEL-828's e2e transcript was redacted before it was committed. **No artifact produced by this change may state or imply that a credential leaked into committed history.**

The gap this ticket closes is that *nothing mechanically prevents the next one*. Live verification runs legitimately mint real credentials — that realism is why they catch defects green test suites miss — and today the only thing standing between a minted token and a commit is a reviewer happening to look.

Two parts:

1. **A mechanical guard** that fails when a credential-shaped string appears in a committed file across the surfaces agents actually write during delivery (`openspec/**` above all). Ground truth for what already exists: `scripts/check-no-credential-in-agent-surface.mjs` declares three surfaces (`assistant-surface`, `fixture`, `mcp`) driven by a `SURFACES` table, and its own header states verbatim that generic token-shaped secrets "ANYWHERE agents write files during delivery are HEL-846's guard, not this one". `openspec/` is currently an `ACKNOWLEDGED_UNSCANNED` top-level directory.
2. **An explicit redact-and-revoke rule** in a durable, agent-read location: any credential, token or secret minted for live verification is redacted from the transcript before that transcript is committed, and revoked when the run ends.

## Acceptance criteria

- [ ] A committed file containing a credential-shaped string fails a check — demonstrated red with a planted fake value, then green after removal. The red must be produced by actually running the check and pasting the transcript; reasoning about what a mutation would do is not evidence.
- [ ] The guard does NOT fire on the legitimate existing cases: `helio_pat_xxxxxxxx` placeholders in `helio-mcp/src/config.ts` and `helio-mcp/README.md`, prose mentions of the `helio_pat_` prefix, and elided forms in review reports. Run it against the real tree and show zero false positives.
- [ ] The redact-and-revoke rule is written into the delivery role docs or CONTRIBUTING, wherever agents will actually read it. `.concertino/` and `scripts/concertino/` are RENDER TARGETS — a local edit there is erased by the next `concertino sync` — so the rule must live somewhere durable in this repo, and `design.md` must say plainly where it went and why.
- [ ] The check runs somewhere it cannot be silently skipped. `.husky/pre-commit`'s `npm test` is vacuous inside worktrees (HEL-768), which is where every delivery runs, and the husky chain is bypassable with `git commit -n`. A hook-only guard may not fire where it matters; this must be addressed explicitly.

## Quality bar (from the two prior tickets on this same gate)

`scripts/check-no-credential-in-agent-surface.mjs` moved twice recently:

- **HEL-956** (`351d0168`) — replaced ad-hoc coverage with a declared `SURFACES` table driving the scan, widened 16 → 82 files, and added structural guards: a zero-file surface fails, every top-level directory must classify as covered/partial/acknowledged-unscanned, and the table is validated (`assertSurfacesValid`) before any scan runs.
- **HEL-993** (`66f302f5`) — closed four "silence reads as green" paths: unreadable files counted but unexamined, an import-graph BFS read failure, a fail-open CLI entry guard, and `collectFiles` dropping everything under an unlistable directory.

Between them those two tickets found **seven** defects in that gate, every one producing a confident OK over unexamined code, and **none** was caught by reading the source — all by mutation. **A mutation must make any new guard go red, and that mutation must actually be run with its transcript pasted.** Any "silence reads as green" path in new code — an unreadable file, an unlistable directory, an empty match set, a surface entry resolving to zero files — is a defect by this repo's established standard, not a nitpick.

## Constraints

- **Do NOT use Playwright or run e2e specs.** Another worktree holds the Playwright session. This is a build-tooling change with no UI surface; there is nothing to review in a browser.
- **Do NOT add a Flyway migration.**
- Concurrency: HEL-768 (jest/worktree config) is in flight and may touch root `jest.config`/`package.json`. Adding a `check:*` script entry to `package.json` is low-collision and fine; **restructuring jest config is not** and must be escalated, not decided locally.
- No production database or deploy access.
- **Never commit a real credential, including in a fixture.** Use obviously synthetic values, as the existing self-test cases do.
- CON-132 gate-chain rule applies with full force: this change touches a script `.husky/pre-commit` invokes. `design.md` must carry the verbatim `## Gate-Chain Implications Checklist`, and the executor must produce per-script isolation-test transcripts, or Delivery's `assert-phase.sh` fails closed.
