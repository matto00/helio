#!/usr/bin/env bash
# HEL-1613 sweep (v2): every e2e file asserting/using pixel geometry or overflow, DOM and non-DOM (ECharts / canvas text) measurement APIs.
cd "$(git rev-parse --show-toplevel)"
grep -rnE 'boundingBox|getBoundingClientRect|scrollWidth|clientWidth|offsetWidth|overflow|toHaveScreenshot|toBeInViewport|scrollHeight|clientHeight|offsetHeight|elementFromPoint|getClientRects|offsetTop|scrollTop|getBoundingRect|measureText|getTextRect|getBBox|getComputedTextLength|createRange' e2e --include='*.ts' --exclude='zz*'
