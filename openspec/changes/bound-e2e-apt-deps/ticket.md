# HEL-1700: e2e CI setup: `npx playwright install --with-deps` stalls on the Azure apt mirror (7.6 and 13.9 min), cancelling legs at their timeout

## Description

Found by the HEL-1699 lane on main run 39830913828 (merge commit 14c08def8), attempt 1.

**What happened:** e2e-prod-build and e2e (1) were cancelled at their job timeouts. The time went to
`npx playwright install --with-deps`, whose apt step stalled on the Azure apt mirror for 7.6 min and 13.9 min. It was
not npm: HEL-1699 now caches node_modules. A rerun of the failed jobs (attempt 2) went green.

**Why it matters:** after HEL-1699, this apt step is the biggest setup risk left for all three e2e job types (6 legs,
e2e-prod-build, e2e-slow).

**Options to evaluate:**

* cache the apt packages, or the Playwright browser plus its system deps;
* use a runner image or container that already has the deps;
* install only the deps chromium needs.

Raising any timeout is an owner call; do not do it without one.

## Acceptance Criteria

- Measure the apt or deps step across main runs before and after the change.
- No leg is cancelled by an apt stall across 5 consecutive main runs. (Only observable after merge: reported as a
  post-merge watch item, not a pre-merge gate.)

## Driver brief additions (2026-10-22)

- Four failures today: two long font-download stalls on the Azure apt mirror (~20 KB/s, ~7-14 min); a 403 from
  packages.microsoft.com ("no longer signed") during apt-get update; a third stall that cancelled jobs at their
  timeout. A fix must cover BOTH the slow-mirror stall and the signed-source 403.
- Prove the fix with CI evidence: the setup step's timing across several runs before and after the change.
- Raising any job timeout, changing runner images, or paying for anything is an owner call (escalate, never do).

## Premise validation (orchestrator, 2026-10-22)

Verified against the job logs; see `.concertino/runs/HEL-1700/evidence/premise-validation.md` in the main checkout.

- Stall: the `.deb` fetch from `http://azure.archive.ubuntu.com` (fonts-ipafont-gothic, fonts-freefont-ttf,
  fonts-unifont, fonts-wqy-zenhei ~20 MB of ~26 MB; also xfonts-*, xvfb, libglib2.0*, libnss3*) at 20-30 kB/s. The
  `apt-get update` index fetch is never the slow part (12.5 MB in 1-13 s). Healthy jobs fetch 25.9 MB in 1 s.
  Seen in 39830913828 a1 (e2e-prod-build job 120006478226, e2e (1) job 120006478323: `Fetched 22.4 MB in 12min 54s`),
  39844229106 a1 (job 120053121138), 39853673220 a1 (job 120086168922), 39854543187 a2 (job 120102175439), and slow but
  surviving in 39854543187 a1 e2e (6) (job 120089196962: `Fetched 19.9 MB in 11min 22s`).
- 403: 39854543187 a1 e2e-prod-build (job 120089196328): `packages.microsoft.com/ubuntu/24.04/prod noble InRelease
  403 Forbidden` then `is no longer signed`, exit 1 at 35 s. That source is preinstalled by the runner image; nothing
  in the e2e jobs installs from it.
- Already chromium-only: the action runs `npx playwright install --with-deps chromium`.
- 31 of 173 e2e job attempts since HEL-1698 had a setup step over 300 s.
