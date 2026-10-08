# HEL-1364: Root npm tree: same sprintf-js moderate advisory via the js-yaml 3 override

## Description

HEL-1320 (PR matto00/helio#819, 67c8ab224) cleared GHSA-hp3w-g68c-fv3c (sprintf-js, moderate, no patched version) from the **frontend** tree. It did this by changing the override under `@istanbuljs/load-nyc-config` to js-yaml `^4.1.1`, per the owner's ruling. It also lowered the frontend audit threshold to moderate.

The **root** `package.json` still has the same js-yaml `^3.15.2` override, so the root tree still pulls in sprintf-js and has the same moderate advisory. It wasn't in HEL-1320's scope, because the root audit gate is still at `high`.

## Do

* Apply the same override change to the root `package.json`, verify that `npm audit` reaches 0 at moderate, and check that root tooling still works.
* Decide, as an owner ruling, whether the root audit threshold should also drop to moderate. Record the decision on this ticket.

## Driver context (claims, verified at Setup — see premise-validation evidence)

* Precedent for lockfile-advisory fixes: HEL-1319, HEL-1346, HEL-1367, HEL-1320 — fix the dependency; no allowlist/suppression unless escalated and ruled by the owner.
* Labels: Follow-up (origin HEL-1320).
