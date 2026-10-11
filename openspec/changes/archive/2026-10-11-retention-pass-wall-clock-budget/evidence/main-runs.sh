#!/usr/bin/env bash
D="$(cd "$(dirname "$0")" && pwd)"
"$D/rep.sh" main-idle-base-r1 off 3
for i in 1 2 3; do "$D/rep.sh" main-S4-prod-io-base-r$i on 4; done
