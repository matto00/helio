# HEL-993: Close the remaining "silence reads as green" paths in check:no-credential-leak

## Description

HEL-956 (merged as 351d0168, PR #565) widened `check:no-credential-leak` from 16 to 82 scanned files and added
three structural guards. Three residual paths were found during its review and deliberately left for this
follow-up. They are the same shape as HEL-956 itself and as the HEL-886 incident that
started it: **silence reads as green** — the gate produces a confident OK over something it did not verify.

1. A file that fails `readFileSync` is counted but never examined. The `catch { continue }` in
   `runChecksForSurface` (and in `findBannedImport`) drops the file while it still contributes to the reported
   count. Measured: planting a credential at `helio-mcp/.probe.ts` and `chmod 000` yields
   `OK (83 files scanned: ... 67 mcp, 0 violations)`, exit 0. The same shape applies to a symlink-to-directory in
   an `allNonBinary` surface (`EISDIR`).
2. The CLI entry guard is fail-open in shape: if the `import.meta.url` comparison were ever false, the process
   would exit 0 having printed nothing. Shape, not a live defect — set a flag in `main()` and error if the module
   was the process entry but `main()` never ran.
3. The assistant surface's `importGraph` and `credentialProp` checks predate HEL-956 and have no self-test case.

"I reviewed it and it looks right" is not evidence about a gate. Only a mutation that makes it go red is.

## Acceptance criteria

Each must be verified by mutation, not by reading the code — this is the whole point of the ticket.

- [ ] Plant a credential-shaped literal on a scanned surface and `chmod 000` it; the gate exits **non-zero**. A
      file the gate cannot read is never counted as scanned.
- [ ] Force the CLI entry guard's comparison false; the process does **not** exit 0 silently.
- [ ] Plant a violation for `importGraph` (an assistant-surface module transitively importing a banned component)
      and for `credentialProp` (a property literally named `credential`); each turns the self-test **red**, and
      green again once removed.
- [ ] Every new self-test case is mutation-verified: break the behavior under test in the **shipped** script and
      confirm the case goes red. A self-test that exercises a copy is a test of the copy.
- [ ] The reported scan count and per-surface breakdown are unchanged for a clean tree
      (`82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp`), or any change to it is explained.

## Constraints

- Never commit a real credential, including in a self-test fixture. Use obviously-synthetic values.
- Do not resolve a finding by widening an exclusion or adding a per-value allowlist entry (HEL-956's
  convention-over-allowlist rule).
- Preserve HEL-956's two judgement calls: the `credential`-property ban stays **assistant-only** (helio-mcp names
  eight fields `credential` in order to reject them), and coverage stays an **explicit surface table**, not
  whole-repo-minus-exclusions.
- Do NOT use Playwright or run e2e specs (HEL-972 holds them). Do NOT add a migration. No prod DB or deploy access.
- Agent-merge is off: open the PR and hand it back.
