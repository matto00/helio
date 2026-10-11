#!/usr/bin/env bash
D="$(cd "$(dirname "$0")" && pwd)"
"$D/rep.sh" branch-idle-base-r1 off 3
for i in 1 2 3; do "$D/rep.sh" branch-S4-prod-io-base-r$i on 6; done
