# Gate-in-isolation transcript: scripts/check-dependabot-groups.selftest.mjs

- Ticket: HEL-898
- Target script: `scripts/check-dependabot-groups.selftest.mjs`
- Wired as npm script: `check:dependabot:selftest`
- Fixture: disposable `mktemp -d` linked-worktree shape (`git worktree add`), never the real repo

## Command

```
(cd /tmp/tmp.TQx7uIKloi/fixture-wt && GIT_DIR=/tmp/tmp.TQx7uIKloi/main-repo/.git/worktrees/fixture-wt GIT_INDEX_FILE=/tmp/tmp.TQx7uIKloi/main-repo/.git/worktrees/fixture-wt/index <invoke scripts/check-dependabot-groups.selftest.mjs>)  # GIT_WORK_TREE deliberately unset — see script header
```

Exit code of the target script's own run: `0` (informational — the
corruption verdict below does not depend on this exit code; a gate
script legitimately failing its own check is not fixture corruption).

## Target script output

```
check-dependabot-groups.selftest: running fixture cases

  PASS  (a) ungrouped family -> fails naming the family as split/ungrouped
  PASS  (b) family split across two groups -> fails naming both groups
  PASS  (c) dev catch-all declared before the react pattern group captures @types/react*
  PASS  (d) declared member absent from the manifest -> fails as a stale declaration
  PASS  (e) production package on neither the family table nor the independent allowlist -> fails naming it
  PASS  (f) grouped, correctly ordered, fully covered -> passes

6 passed, 0 failed, 6 total
```

## Fixture state — before

- `git rev-parse --is-bare-repository`: `false`
- `git status --porcelain`:
```

```
- `.git` manifest:
```
total 20
drwxr-xr-x 8 matt matt 260 Aug 29 23:34 .
drwxr-xr-x 3 matt matt  60 Aug 29 23:34 ..
-rw-r--r-- 1 matt matt  13 Aug 29 23:34 COMMIT_EDITMSG
-rw-r--r-- 1 matt matt  92 Aug 29 23:34 config
-rw-r--r-- 1 matt matt  73 Aug 29 23:34 description
-rw-r--r-- 1 matt matt  21 Aug 29 23:34 HEAD
drwxr-xr-x 2 matt matt 320 Aug 29 23:34 hooks
-rw-r--r-- 1 matt matt  65 Aug 29 23:34 index
drwxr-xr-x 2 matt matt  60 Aug 29 23:34 info
drwxr-xr-x 3 matt matt  80 Aug 29 23:34 logs
drwxr-xr-x 6 matt matt 120 Aug 29 23:34 objects
drwxr-xr-x 4 matt matt  80 Aug 29 23:34 refs
drwxr-xr-x 3 matt matt  60 Aug 29 23:34 worktrees
```

## Fixture state — after

- `git rev-parse --is-bare-repository`: `false`
- `git status --porcelain`:
```

```
- `.git` manifest:
```
total 20
drwxr-xr-x 8 matt matt 260 Aug 29 23:34 .
drwxr-xr-x 3 matt matt  60 Aug 29 23:34 ..
-rw-r--r-- 1 matt matt  13 Aug 29 23:34 COMMIT_EDITMSG
-rw-r--r-- 1 matt matt  92 Aug 29 23:34 config
-rw-r--r-- 1 matt matt  73 Aug 29 23:34 description
-rw-r--r-- 1 matt matt  21 Aug 29 23:34 HEAD
drwxr-xr-x 2 matt matt 320 Aug 29 23:34 hooks
-rw-r--r-- 1 matt matt  65 Aug 29 23:34 index
drwxr-xr-x 2 matt matt  60 Aug 29 23:34 info
drwxr-xr-x 3 matt matt  80 Aug 29 23:34 logs
drwxr-xr-x 6 matt matt 120 Aug 29 23:34 objects
drwxr-xr-x 4 matt matt  80 Aug 29 23:34 refs
drwxr-xr-x 3 matt matt  60 Aug 29 23:34 worktrees
```

## Real, surrounding repo invariants (before/after; must be identical)

```
BEFORE:
false
6352b1a22deb1cd403101ee14c3f65e82a5c8a4a
/home/matt/Development/helio                                                                       8f3756eb [main]
/home/matt/Development/helio/.claude/worktrees/task/group-co-versioned-dependabot-families/HEL-898 6352b1a2 [task/group-co-versioned-dependabot-families/HEL-898]

AFTER:
false
6352b1a22deb1cd403101ee14c3f65e82a5c8a4a
/home/matt/Development/helio                                                                       8f3756eb [main]
/home/matt/Development/helio/.claude/worktrees/task/group-co-versioned-dependabot-families/HEL-898 6352b1a2 [task/group-co-versioned-dependabot-families/HEL-898]
```

Real-repo tripwire: **PASS**

## Verdict

**PASS**
