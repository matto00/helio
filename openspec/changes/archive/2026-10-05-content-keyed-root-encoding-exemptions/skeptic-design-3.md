## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 32571b0166a25b127a27bec645b7e2aec11b3c2b. The change dir is untracked and there is no code change yet (`git status --short` shows only `?? openspec/changes/content-keyed-root-encoding-exemptions/`).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/content-keyed-root-encoding-exemptions/hel-1282`.

- **Round-2 CR1 (comment rule) is closed.**
  - D3 now reads: comment lines are those whose trimmed text starts with `//` or `*`, "exactly today's rule in both scripts". It says explicitly that a line starting `/*` is NOT a comment, using the probe line as its example.
  - Tree check: both `scripts/check-node-root-encoding.mjs:162` and `scripts/check-node-root-encoding.ts.mjs:122` have `if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;`. The design claim matches the code.
  - D5 adds a selftest case for both guards: a leading `/* ... */` comment followed by a hit must be red. Tasks 3.1 and 4.2 both list it.

- **Round-2 CR2 (missing-file and stale handling for the TS sibling) is closed.**
  - D4 now says the TS entry point has no TARGET_FILES list. After its scan, it evaluates every table entry whose `file` was not scanned by calling `scanTextForViolations(file, "")`, which reports those entries as stale.
  - Tree check: the TS entry point (`ts.mjs:165`) scans only what `listTsFiles(SRC_ROOT)` finds and has no ENOENT branch. So the planned post-scan pass is the right hook.
  - The TS changes are carried into the tasks:
    - Task 4.1 implements the post-scan pass.
    - Task 4.2 adds the stale and missing-file cases.
    - Task 4.2 includes "stale check off" in the TS mutation list.
  - The spec scenario "Exempted file missing" can now be met by both guards.

- **Round-2 CR3 (completeness of D2's residual risk) is closed.**
  - D2 adds a second stated residual. A proof-invalidating edit that touches neither the hit line nor its governing arm (shadowing the scrutinee, or a caller passing `None`) is not caught.
  - It also says today's guard catches only the line-adding forms of this, and only incidentally.
  - It explains why accepting this is unavoidable, and names the HEL-913 structural fact ("a caller must now say `None` out loud") as what actually carries the proof.

- **Round-1 CRs remain closed.**
  - Arm keying appears in D1, D2 and D3, and in the spec requirement plus its "Governing match arm … changes" scenario.
  - The 5-row mutation table in D5 has named failing cases, task 3.2 requires EVERY row, and restore is done with an exact-path `git checkout`.
  - Stale messages go into the same returned array, filtered by `file === relPath`. The Scala ENOENT path is now reported as stale, not skipped.

- **Other tree claims I checked.**
  - The TS scope regex `\bfunction\s+(\w+)` matches `async function buildOutputSummariesByPipeline(` (`context.ts:210`).
  - The exempt TS hit `nodeStepId: o.nodeStepId ?? null,` is at `context.ts:222`, and `rootId` follows on line 223.
  - The six Scala `file:line` entries in `KNOWN_UNFIXED_LINES` (`.mjs:126-133`) match task 1.1's baseline list.
  - `KNOWN_ROOT_QUALIFIED_LINES` in the Scala guard is empty, so task 2.1 replacing it loses nothing.
  - The ENOENT `continue` (`.mjs:191`) is the silent skip that D4 replaces.

- **AC coverage.**
  - Content keying: D1, task 2.1/4.1.
  - New unexempted hit goes red, with a red mutation: D5 (b), task 5.2.
  - Selftest covers line-shift and new-site: D5 (a)/(b).
  - Driver brief:
    - (a) line-shift, (b) new hit and (c) removed exemption are all in D5.
    - Before/after hit parity is in D6 and task 5.1.
    - Anti-resemblance is explained in D2.
    - Owned files are limited to the four scripts, with no marker changes (D1), checked by task 5.3.

### Verdict: CONFIRM

### Non-blocking notes

- proposal.md "What Changes" lists the key as file + declaration + text + count and omits `arm`. design.md and the spec are authoritative and consistent, but the proposal bullet should be updated for coherence.
- In D2, the bullet "same text, different declaration → no matching `(file, scope, text)` key" also omits `arm` from the tuple. This is harmless: a larger key only makes a match less likely.
- TS relPath format: the post-scan "entry file not among scanned files" comparison must use the same repo-relative form the entry table uses. Otherwise every TS entry will report stale on the clean tree. Task 4.1's "clean" verify step will catch this.
