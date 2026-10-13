#!/usr/bin/env python3
"""HEL-1501 commit 2 byte-move proof. Independent of the generator: re-reads SPLIT_BASE and the
working tree and asserts every moved base region appears verbatim, contiguously, in its new home.
Allowed non-verbatim lines are enumerated (EXPECTED_DIFFS): only the `export` keyword added to the
two state declarations. Exit 1 on any mismatch."""
import subprocess, sys
BASE = "f63ab8365"
D = "frontend/src/features/pipelines/state/"
base = subprocess.check_output(["git", "show", f"{BASE}:{D}pipelinesSlice.ts"], text=True).split("\n")
def rng(a, b): return "\n".join(base[a - 1:b]) + "\n"
def new(name): return open(D + name).read()
checks = [
    ("pipelinesThunks.ts", 44, 72, "SummaryWire+normalize"),
    ("pipelinesThunks.ts", 182, 365, "core thunks"),
    ("pipelineScheduleThunks.ts", 34, 43, "extractErrorMessage"),
    ("pipelineScheduleThunks.ts", 367, 413, "schedule thunks"),
    ("pipelinesSlice.ts", 415, 707, "isStale + slice + exports"),
]
ok = True
for f, a, b, label in checks:
    hit = rng(a, b) in new(f)
    print(f"{'OK  ' if hit else 'FAIL'} base L{a}-{b} ({label}) verbatim in {f}")
    ok &= hit
# State region: identical except the two enumerated `export ` insertions.
EXPECTED_DIFFS = {
    "interface PipelinesState {": "export interface PipelinesState {",
    "const initialState: PipelinesState = {": "export const initialState: PipelinesState = {",
}
region = [EXPECTED_DIFFS.get(l, l) for l in base[72:180]]
hit = "\n".join(region) + "\n" in new("pipelinesState.ts")
print(f"{'OK  ' if hit else 'FAIL'} base L73-180 (state+initialState, {len(EXPECTED_DIFFS)} enumerated export-keyword diffs) in pipelinesState.ts")
ok &= hit
# Accounting: base non-import body lines 34..707 are all covered by the regions above (+ blank 414).
covered = set(range(34, 44)) | set(range(44, 73)) | set(range(73, 181)) | set(range(182, 366)) | set(range(367, 414)) | set(range(415, 708))
missing = [n for n in range(34, 708) if n not in covered and base[n - 1].strip()]
print("uncovered non-blank base lines 34-707:", missing or "none")
ok &= not missing
sys.exit(0 if ok else 1)
