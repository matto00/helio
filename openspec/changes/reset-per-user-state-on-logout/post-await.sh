#!/usr/bin/env bash
# Lists dispatch( / thunkApi.dispatch( lines that have an `await` (or .then() within the 30 preceding lines, in non-test files.
cd "${1:-.}"
rg -l "dispatch\(" --glob '!*.test.*' --glob '!**/__tests__/**' --glob '!test/**' . | sort | while read -r f; do
  awk -v F="$f" '
    /await |\.then\(/ { last=NR }
    /dispatch\(/ && last && NR-last<=30 { printf "%s:%d: %s\n", F, NR, $0 }
  ' "$f"
done
