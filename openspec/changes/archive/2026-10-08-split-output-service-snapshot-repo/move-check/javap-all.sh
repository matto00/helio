#!/usr/bin/env bash
# usage: javap-all.sh <classdir> ; prints "== <class>" + javap -public per class, sorted by class name
d=$1; cd "$d"
find . -name '*.class' | sed 's|^\./||; s|\.class$||; s|/|.|g' | LC_ALL=C sort | while read -r c; do echo "== $c"; javap -public -cp "$d" "$c" 2>&1 | grep -v '^Compiled from'; done
