#!/usr/bin/env bash
D="$(cd "$(dirname "$0")" && pwd)"
"$D/rep.sh" main-S4-prod-io-base-r4 on 4
"$D/rep.sh" main-idle-base-r2 off 3
