## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Round-1 CR1: design.md Context now states the read set is conditional; D1/C7 require per-test file:line showing each conditional fetch's trigger is unmet, else `affected`. useOnboardingHost.ts:87 fetchSources confirmed (frontend/src/features/onboarding/hooks/).
- CR2: D5 exempts hel1023/hel1028/hel1260. Confirmed on main: seededUsers at hel1023:55,72,390 and hel1028:21,31,280 with afterAll logs; `gh pr diff 774` rewrites exactly those to per-registration console.log. hel1260 logs at :56,:132. No contradiction with D7 remains.
- CR3: D2a widened to the full reload population, with quoted-purpose record, escalation default for persistence/SSE reloads, and a task 1.2 verify. Present.
- CR4: D6 specifies pageref/APIRequestContext frame attribution with spot-check, traces on modified specs, hel1260 verified-not-edited. Present.
- Population: 38 e2e files with a password login (grep count 38); named files (hel1230, auth-cookie-migration, hel665/666/716, hel958) exist. #774 touches the 9 named e2e files; headers/afterAll/seededUsers only for the 7 overlap files.
- All ACs covered by tasks (inventory 1.2, fixes 2.2, no assertion change C2, helper 2.1, HEL-1298/1294 3.3, repeat-each 3.2, green CI D6). Driver constraints mirrored in C1-C6.

### Verdict: CONFIRM

### Non-blocking notes
- Once #774 merges, hel1023/1028 residue emails come from per-registration logs instead of the afterAll summary; the plan handles this ("existing log line on main / #774").
- `loginThenIsolate` is unused by existing specs; fine, but consider a one-line usage in e2e/README (note #774 also edits README, so avoid conflicts).
