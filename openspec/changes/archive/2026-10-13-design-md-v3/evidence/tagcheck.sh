#!/usr/bin/env bash
# task 2.4: tag counts and HEL-id preservation, DESIGN.md v2 vs v3
v2="$1"; v3="$2"
for f in "$v2" "$v3"; do
  echo "$f: mechanical=$(grep -o '\[mechanical' "$f" | wc -l) judgment=$(grep -o '\[judgment' "$f" | wc -l)"
done
grep -o 'HEL-[0-9]\+' "$v2" | sort -u > /tmp/ids2.$$; grep -o 'HEL-[0-9]\+' "$v3" | sort -u > /tmp/ids3.$$
echo "HEL ids v2=$(wc -l < /tmp/ids2.$$) v3=$(wc -l < /tmp/ids3.$$)"
echo "ids in v2 missing from v3 (comm -23):"; comm -23 /tmp/ids2.$$ /tmp/ids3.$$; echo "(end)"
rm -f /tmp/ids2.$$ /tmp/ids3.$$
