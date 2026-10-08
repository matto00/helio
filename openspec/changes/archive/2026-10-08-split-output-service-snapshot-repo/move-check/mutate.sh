#!/usr/bin/env bash
# usage: mutate.sh <name> <file> <old> <new> <testOnly-glob>   (single-token mutation, red run, revert)
set -u
W=/home/matt/Development/helio/.claude/worktrees/task/split-output-service-snapshot-repo/HEL-1187
S=/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad
name=$1; f=$W/$2; old=$3; new=$4; spec=$5
cp "$f" "$S/mut-$name.orig"
python3 - "$f" "$old" "$new" <<'PY'
import sys
p,o,n=sys.argv[1:4]; s=open(p).read(); assert s.count(o)==1,(o,s.count(o)); open(p,'w').write(s.replace(o,n))
PY
diff -U0 "$S/mut-$name.orig" "$f" > "$S/mut-$name.diff"
(cd $W/backend && nice -n 19 timeout 580 sbt "testOnly $spec" > "$S/mut-$name.log" 2>&1; echo "sbt exit=$?" >> "$S/mut-$name.log")
cp "$S/mut-$name.orig" "$f"
cmp -s "$S/mut-$name.orig" "$f" && echo "$name reverted byte-identical" > "$S/mut-$name.reverted"
echo done > "$S/mut-$name.done"
