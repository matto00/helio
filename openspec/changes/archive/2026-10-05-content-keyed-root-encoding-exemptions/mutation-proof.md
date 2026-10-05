# Mutation proof (cycle 2)
Each mutation is applied to the scanner, the selftest run, the FAIL lines captured verbatim, then the scanner restored with `git checkout -- <path>` (restore verified by `git diff --quiet`). Scripts staged beforehand so checkout restores the committed-candidate version.

## Scala 1: key by line number instead of content

Expected to FAIL: (a) line-shift. Selftest exit code: 1. Restored: yes. 14 FAIL line(s):

```
FAIL: (a) line shift above exempt sites stays green (NodeSnapshotRepository)
FAIL: (a) line shift above exempt sites stays green (BinaryRefRepository)
FAIL: (a) non-comment lines inserted at top stay green
FAIL: (b') same-scope duplicate: both occurrences red
FAIL: (b') same-scope duplicate names count mismatch and text
FAIL: (stale) deleted site (overwriteRowsAction) reports one stale exemption
FAIL: (stale) deleted site (overwriteRowsAction) names the entry
FAIL: (stale) deleted site (listRows) reports one stale exemption
FAIL: (stale) deleted site (listRows) names the entry
FAIL: (stale) deleted site (overwriteForNode) reports one stale exemption
FAIL: (stale) deleted site (overwriteForNode) names the entry
FAIL: (stale) deleted site (findByNodeAndRow) reports one stale exemption
FAIL: (stale) deleted site (findByNodeAndRow) names the entry
FAIL: (arm) overwriteRowsAction widened: unmatched hit + stale entry
```

## Scala 2: count bound disabled (`if (entry && n === entry.count) continue;` -> `if (entry) continue;`)

Expected to FAIL: (b') same-scope duplicate. Selftest exit code: 1. Restored: yes. 1 FAIL line(s):

```
FAIL: (b') same-scope duplicate: both occurrences red
```

## Scala 3: scope dropped from key (`[file, scope, arm, text]` -> `[file, arm, text]`)

Expected to FAIL: (b'') other-scope duplicate. Selftest exit code: 1. Restored: yes. 20 FAIL line(s):

```
FAIL: baseline: real NodeSnapshotRepository.scala is clean
FAIL: (a) line shift above exempt sites stays green (NodeSnapshotRepository)
FAIL: (a) non-comment lines inserted at top stay green
FAIL: (b) new standalone hit: exactly one violation
FAIL: (b) new standalone hit names file and text
FAIL: (b') same-scope duplicate: both occurrences red
FAIL: (b') same-scope duplicate names count mismatch and text
FAIL: (b'') other-scope duplicate: exactly one violation
FAIL: (c) removed exemption (overwriteRowsAction) turns its site red
FAIL: (c) removed exemption (listRows) turns its site red
FAIL: (c) removed exemption (nodeFilterFragment) turns its site red
FAIL: (stale) deleted site (overwriteRowsAction) reports one stale exemption
FAIL: (stale) deleted site (overwriteRowsAction) names the entry
FAIL: (stale) deleted site (listRows) reports one stale exemption
FAIL: (stale) deleted site (listRows) names the entry
FAIL: (stale) deleted site (nodeFilterFragment) reports one stale exemption
FAIL: (stale) deleted site (nodeFilterFragment) names the entry
FAIL: (whitespace) re-aligned exempt lines stay green (NodeSnapshotRepository.scala)
FAIL: (arm) overwriteRowsAction widened: unmatched hit + stale entry
FAIL: (missing file) NodeSnapshotRepository: 3 stale
```

## Scala 4: stale check disabled (`if (n < e.count) {` -> `if (false) {`)

Expected to FAIL: (stale), (missing file). Selftest exit code: 1. Restored: yes. 18 FAIL line(s):

```
FAIL: (stale) deleted site (overwriteRowsAction) reports one stale exemption
FAIL: (stale) deleted site (overwriteRowsAction) names the entry
FAIL: (stale) deleted site (listRows) reports one stale exemption
FAIL: (stale) deleted site (listRows) names the entry
FAIL: (stale) deleted site (nodeFilterFragment) reports one stale exemption
FAIL: (stale) deleted site (nodeFilterFragment) names the entry
FAIL: (stale) deleted site (overwriteForNode) reports one stale exemption
FAIL: (stale) deleted site (overwriteForNode) names the entry
FAIL: (stale) deleted site (findByNodeAndRow) reports one stale exemption
FAIL: (stale) deleted site (findByNodeAndRow) names the entry
FAIL: (stale) deleted site (selectQuery) reports one stale exemption
FAIL: (stale) deleted site (selectQuery) names the entry
FAIL: (arm) selectQuery widened: unmatched hit + stale entry
FAIL: (arm) selectQuery: stale entry
FAIL: (arm) overwriteRowsAction widened: unmatched hit + stale entry
FAIL: (arm) overwriteRowsAction: stale entry
FAIL: (missing file) NodeSnapshotRepository: 3 stale
FAIL: (missing file) BinaryRefRepository: 3 stale
```

## Scala 5: arm dropped from key (`[file, scope, arm, text]` -> `[file, scope, text]`)

Expected to FAIL: (arm). Selftest exit code: 1. Restored: yes. 6 FAIL line(s):

```
FAIL: (arm) selectQuery widened: unmatched hit + stale entry
FAIL: (arm) selectQuery: hit named
FAIL: (arm) selectQuery: stale entry
FAIL: (arm) overwriteRowsAction widened: unmatched hit + stale entry
FAIL: (arm) overwriteRowsAction: hit named
FAIL: (arm) overwriteRowsAction: stale entry
```

## Scala 6: whitespace normalisation dropped (hit key `normalise(raw)` -> `raw.trim()`)

Expected to FAIL: (whitespace). Selftest exit code: 1. Restored: yes. 31 FAIL line(s):

```
FAIL: baseline: real NodeSnapshotRepository.scala is clean
FAIL: baseline: real BinaryRefRepository.scala is clean
FAIL: (a) line shift above exempt sites stays green (NodeSnapshotRepository)
FAIL: (a) line shift above exempt sites stays green (BinaryRefRepository)
FAIL: (a) non-comment lines inserted at top stay green
FAIL: (b) new standalone hit: exactly one violation
FAIL: (b) new standalone hit names file and text
FAIL: (b') same-scope duplicate: both occurrences red
FAIL: (b') same-scope duplicate names count mismatch and text
FAIL: (b'') other-scope duplicate: exactly one violation
FAIL: (c) removed exemption (overwriteRowsAction) turns its site red
FAIL: (c) removed exemption (listRows) turns its site red
FAIL: (c) removed exemption (nodeFilterFragment) turns its site red
FAIL: (c) removed exemption (findByNodeAndRow) turns its site red
FAIL: (c) removed exemption (findByNodeAndRow) names file and text
FAIL: (c) removed exemption (selectQuery) turns its site red
FAIL: (c) removed exemption (selectQuery) names file and text
FAIL: (stale) deleted site (overwriteRowsAction) reports one stale exemption
FAIL: (stale) deleted site (overwriteRowsAction) names the entry
FAIL: (stale) deleted site (listRows) reports one stale exemption
FAIL: (stale) deleted site (listRows) names the entry
FAIL: (stale) deleted site (nodeFilterFragment) reports one stale exemption
FAIL: (stale) deleted site (nodeFilterFragment) names the entry
FAIL: (stale) deleted site (findByNodeAndRow) reports one stale exemption
FAIL: (stale) deleted site (findByNodeAndRow) names the entry
FAIL: (stale) deleted site (selectQuery) reports one stale exemption
FAIL: (stale) deleted site (selectQuery) names the entry
FAIL: (whitespace) re-aligned exempt lines stay green (NodeSnapshotRepository.scala)
FAIL: (whitespace) re-aligned exempt lines stay green (BinaryRefRepository.scala)
FAIL: (arm) selectQuery widened: unmatched hit + stale entry
FAIL: (arm) overwriteRowsAction widened: unmatched hit + stale entry
```

## TS 1: key by line number instead of content

Expected to FAIL: (d) line-shift, (e) duplicate. Selftest exit code: 1. Restored: yes. 3 FAIL line(s):

```
FAIL: (d) line-shifted context.ts stays green
FAIL: (e) same-scope duplicate: both occurrences red
FAIL: (e) same-scope duplicate names count mismatch and text
```

## TS 2: count bound disabled

Expected to FAIL: (e) same-scope duplicate. Selftest exit code: 1. Restored: yes. 1 FAIL line(s):

```
FAIL: (e) same-scope duplicate: both occurrences red
```

## TS 3: stale check disabled (`if (n < e.count) {` -> `if (false) {`)

Expected to FAIL: (g0) stale / missing-file. Selftest exit code: 1. Restored: yes. 5 FAIL line(s):

```
FAIL: (g0) deleted site: one stale exemption
FAIL: (g0) stale message names the entry
FAIL: (g0) missing file (empty text): entry stale
FAIL: (g1) entry-point post-scan: unscanned entry file reports stale
FAIL: (g1) absolute-form path would not match (repo-relative required)
```

## TS 4: entry-point post-scan pass disabled (`if (!scanned.has(file))` -> `if (false)`)

Expected to FAIL: (g1) post-scan. Selftest exit code: 1. Restored: yes. 2 FAIL line(s):

```
FAIL: (g1) entry-point post-scan: unscanned entry file reports stale
FAIL: (g1) absolute-form path would not match (repo-relative required)
```

# Cycle 3 additions (skeptic-final-1 CR1/CR2)

## Scala 7: text dropped from key (`[file, scope, arm, text]` -> `[file, scope, arm]`)

Expected to FAIL: (text). Selftest exit code: 1. Restored: yes. 3 FAIL line(s):

```
FAIL: (text) weakened selectQuery text: unmatched hit + stale entry
FAIL: (text) weakened hit named
FAIL: (text) stale entry reported
```

## Scala 8: arm not reset on scope change (`arm = NO_ARM;` inside the `if (declared)` block deleted)

Expected to FAIL: (arm-reset). Selftest exit code: 1. Restored: yes. 3 FAIL line(s):

```
FAIL: (arm-reset) collapsed selectQuery: unmatched hit + stale entry
FAIL: (arm-reset) collapsed hit named
FAIL: (arm-reset) stale entry reported
```

## TS 5: arm not reset on scope change (`arm = NO_ARM;` deleted)

Expected to FAIL: (d2). Selftest exit code: 1. Restored: yes. 1 FAIL line(s):

```
FAIL: (d2) shifted-in case arm does not leak across scopes
```

# Cycle 4 addition (skeptic-final-2)

## TS 6: text dropped from key (`[file, scope, arm, text]` -> `[file, scope, arm]`)

Expected to FAIL: (text). Restored: yes (`git diff --quiet` verified). FAIL line(s):

```
FAIL: (text) changed text: unmatched hit + stale entry
FAIL: (text) unmatched hit names the new text
FAIL: (text) stale entry reported
```
