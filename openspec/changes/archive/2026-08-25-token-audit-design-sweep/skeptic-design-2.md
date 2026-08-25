## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

All artifacts re-read fresh from disk; all greps re-run in this worktree's
`frontend/src`. I did not take the orchestrator's revision summary on trust.

**Ground-truth re-measurement (reproduces round 1).**
`grep -rEoh "(margin|padding|gap)(-[a-z]+)?:[^;]*" --include=*.css` →
off-scale >4px px literals: `6px`×41, `10px`×34, `14px`×12, `7px`×10,
`5px`×9, `18px`×2, `30px`×1, `60px`×1 (~110 in CSS alone, consistent with the
~120 figure once `.tsx` and decimals are included). On-scale >4px in CSS:
`8px`×38, `12px`×19, `16px`×6, `20px`×6. ≤4px allowance: `2px`×36, `4px`×24,
`1px`×12, `3px`×3. The measured distribution the artifacts now cite is
accurate.
`grep -rEn "font-family:" | grep -v "var(--font"` → **10 hits, all
`font-family: inherit;`** (uniq-counted). `font-size:` with `px|rem|em|%` →
3 live hits (all `em`). `(margin|padding|gap)` with `em|%` → 6 live hits.
All three widened-pattern claims in `design.md` check out.

**CR-by-CR verification of the revisions:**

1. **CR#1 (AC #1 reconciliation) — partially landed.** `ticket.md:36-38` adds
   an explicit "AC #1 restated" section with the correct formulation, and
   `design.md:92-104` states it too. **But `ticket.md:9` — the actual
   Acceptance Criteria bullet — is verbatim unchanged** and still reads "zero
   hardcoded color/size/weight/family literals outside the documented §3
   exceptions". The AC list is what the evaluator and the final gate will
   trace against; leaving the refuted wording in place there and the
   correction 30 lines below is exactly the ambiguity CR#1 asked to remove
   ("it must be stated, not left implicit"). Minor, but it is the one line
   that matters most.
2. **CR#2 ("vast majority") — landed.** `ticket.md:42` and
   `proposal.md:28-31` both now carry the measured 84-108-vs-~120
   distribution and explicitly retract "vast majority". Verified against my
   own counts above.
3. **CR#3 (drop ~1px tolerance) — landed in the rule, contradicted in the
   Risks sections.** The normative statements are correct and exact-only:
   `design.md:56-58`, `design.md:73-77`, `proposal.md:24-25`, `tasks.md:19`.
   However **`design.md:142` still says the visual-regression risk is
   "mitigated by the near-equal-value-only rule"** and **`proposal.md:47`
   still says "Mitigated by choosing only near-equal-value substitutions"**.
   That is the exact tolerance rule CR#3 required removed, still live in both
   documents, in the section that tells the executor how to manage the risk.
   An executor reading Risks gets the opposite instruction from the one in
   Decisions. This is a real internal contradiction on the load-bearing rule.
4. **CR#4 (guard test = pinned baseline) — landed.** `design.md:106-121` and
   `tasks.md:30-34` now specify an explicit pinned baseline/allowlist
   (file+line+value) of the off-scale residual, with the "no *new* hit"
   framing, plus the RED demonstration retained. Implementable as written.
5. **CR#5 (exclusion list) — landed.** `design.md:29-35` adds `**/*.test.ts(x)`,
   code comments, `MfaEnrollModal` QR `bgColor`/`fgColor`, and
   `PreferencesEditor` appearance defaults, each with justification;
   `tasks.md:5-8` mirrors it.
6. **CR#6 (font-family `inherit`) — landed.** `design.md:51-54` excludes
   `inherit`/`initial`/`unset` and records that all 10 current hits are
   `inherit`. Matches my grep exactly.
7. **CR#7 (false-negative claim) — landed.** `design.md:62-71` narrows the
   impossibility claim to the unprefixed-hex case only and explicitly
   declines to extend it; patterns 2 and 3 (`design.md:38-47`) now include
   `em|%`. My greps confirm the 3+6 em instances those patterns were missing.
8. **CR#8 (HEL-680 reconciliation) — landed in two files, missed in the
   third.** `ticket.md:34` and `design.md:98-104` are corrected. **But
   `proposal.md:37-38` still reads "No new tokens are added (deferred to
   HEL-680 for the one already-known case, the compact-chip padding
   literal)"** — the precise sentence CR#8 named, unedited. And
   `design.md:21-22` ("Non-goals: new tokens — HEL-680's job for the one
   known compact-chip case") contradicts `design.md:98-104` twelve lines
   later within the same file.

**Nothing new found.** The methodology, guard placement (non-overlap with
HEL-729), exclusion set, and task decomposition are now sound and match the
tree. The only defects are stale sentences the revision pass didn't sweep.

### Verdict: REFUTE

Six of eight change requests fully landed and the plan is now substantively
correct. But the revision was applied per-claim rather than per-document, and
three stale sentences survive that *state the refuted position*, two of them
in Risks/Non-Goals sections an implementer reads as instruction. CR#3's
contradiction in particular licenses precisely the near-miss substitutions the
plan elsewhere forbids and that would violate AC #2. These are one-line edits;
cheap now, and a coin-flip on which sentence the executor follows if left.

### Change Requests

1. **Delete the surviving "near-equal-value" tolerance language (CR#3
   incomplete).** `design.md:142` — "mitigated by the near-equal-value-only
   rule" and `proposal.md:47` — "Mitigated by choosing only near-equal-value
   substitutions". Both must state the exact-value/no-tolerance rule
   (`design.md:73-77`) as the mitigation instead. As written the Risks
   sections of both documents instruct the opposite of the Decisions section.
2. **Correct the surviving HEL-680 "one known case" claims (CR#8
   incomplete).** `proposal.md:37-38` and `design.md:21-22` both still call
   the residual "the one already-known / one known compact-chip case",
   contradicting `ticket.md:34` and `design.md:98-104`. Align them with the
   corrected ~120-literal framing (or point at it by reference).
3. **Edit `ticket.md:9` itself, not just add a restatement below it.** The
   Acceptance Criteria bullet still carries the wording round 1 refuted as
   unachievable. Replace it with the restated form ("zero literals **for
   which a matching token already exists** remain unfixed; the off-scale
   residual is enumerated completely") or make the bullet explicitly defer to
   the "AC #1 restated" section. The AC list is the artifact the final gate
   traces; it must not contain the refuted criterion.

### Non-blocking notes

- `tasks.md:22-26` handles round 1's note about the touched-surface list well
  ("Name the concrete touched-surface list here once 1.2's table is final (do
  not narrow silently)") — deferring it to after enumeration is the right call
  since the list isn't knowable up front.
- `design.md:44-50` recording font-size/font-weight as known-clean regression
  guards addresses round 1's non-blocking note; good.
- Environmental note, unchanged from round 1: this worktree's
  `scripts/concertino/` lacks `next-report-number.sh`; I used the canonical
  copy at `/home/matt/Development/helio/scripts/concertino/`, which returned
  `number=2`.
