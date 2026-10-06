#!/bin/bash
# usage: loop.sh <id> <N> <testname-filter or ""> ; run from backend/
ID=$1; N=$2; Z=$3
CP=$(cat ../openspec/changes/rotate-credential-await-delete/scratch/cp2.txt)
pass=0; fail=0
for i in $(seq 1 $N); do
  if [ -n "$Z" ]; then
    nice -n 19 java -Xmx512m -cp "$CP" org.scalatest.tools.Runner -R backend/target -s com.helio.infrastructure.persistence.sources.ConnectorRepositorySpec -z "$Z" -oW > ../openspec/changes/rotate-credential-await-delete/scratch/run-$ID-$i.log 2>&1
  else
    nice -n 19 java -Xmx512m -cp "$CP" org.scalatest.tools.Runner -R backend/target -s com.helio.infrastructure.persistence.sources.ConnectorRepositorySpec -oW > ../openspec/changes/rotate-credential-await-delete/scratch/run-$ID-$i.log 2>&1
  fi
  rc=$?
  if [ $rc -eq 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
  echo "$ID run $i rc=$rc"
done
echo "$ID DONE pass=$pass fail=$fail"
