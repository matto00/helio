# Gate-in-isolation transcript: scripts/check-dependabot-groups.mjs

- Ticket: HEL-898
- Target script: `scripts/check-dependabot-groups.mjs`
- Wired as npm script: `check:dependabot`
- Fixture: disposable `mktemp -d` linked-worktree shape (`git worktree add`), never the real repo

## Command

```
(cd /tmp/tmp.04u8gcgvjh/fixture-wt && GIT_DIR=/tmp/tmp.04u8gcgvjh/main-repo/.git/worktrees/fixture-wt GIT_INDEX_FILE=/tmp/tmp.04u8gcgvjh/main-repo/.git/worktrees/fixture-wt/index <invoke scripts/check-dependabot-groups.mjs>)  # GIT_WORK_TREE deliberately unset — see script header
```

Exit code of the target script's own run: `0` (informational — the
corruption verdict below does not depend on this exit code; a gate
script legitimately failing its own check is not fixture corruption).

## Target script output

```
check-dependabot-groups: OK — 5 declared families each resolve to a single group; every production dependency accounted for.
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
