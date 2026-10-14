#!/usr/bin/env bash
# THROWAWAY (HEL-1580 round 4): mechanical enumeration of every production write site of the state PatchSetPipelineDefinition.of reads.
# Run from the repo root (or the worktree root): bash openspec/changes/archive/2026-10-13-live-draft-preview-spike/prototype/writer-search.sh
set -u
cd "$(git rev-parse --show-toplevel)"
T='pipelines|pipeline_steps|outputs|pipeline_roots|pipeline_schedules|panels|alert_rules'
SLICK='PanelTable|PanelRepository|PipelineTable|PipelineStepTable|OutputTable|PipelineRootTable|PipelineScheduleTable|AlertRuleTable'
echo "## S1: raw SQL write statements naming a fingerprinted table (backend/src/main/scala)"
grep -rnE "INSERT INTO|DELETE FROM|ON CONFLICT|UPDATE +[a-z_]+( +[a-z]+)? *(SET|$)|TRUNCATE" backend/src/main/scala --include=*.scala | grep -P "^[^:]+:\d+:.*\b($T)\b" | grep -vE "^\S+:[0-9]+:\s*(//|\*|/\*)"
echo "## S2: files that touch a fingerprinted table through Slick"
grep -rlE "$SLICK" backend/src/main/scala --include=*.scala | sort
echo "## S3: Slick/SQL write forms in those files"
FILES=$(grep -rlE "$SLICK" backend/src/main/scala --include=*.scala | sort)
grep -nE "\+= |\+\+= |\.update\(|\.delete\b|insertOrUpdate|\.returning|forceInsert|sqlu" $FILES
echo "## S4: FK ON DELETE CASCADE into or through the fingerprinted tables (migrations)"
grep -rnE -i "REFERENCES +($T|data_sources|dashboards)\b[^;,]*ON DELETE CASCADE" backend/src/main/resources/db/migration
echo "## S4b: FKs from users into the fingerprinted tables, any ON DELETE action"
grep -rnE -i "REFERENCES +users\b" backend/src/main/resources/db/migration | grep -E "\b($T)\b"
echo "## S4c: ON DELETE SET NULL / SET DEFAULT on the fingerprinted tables"
grep -rnE -i "ON DELETE (SET NULL|SET DEFAULT)" backend/src/main/resources/db/migration | grep -P "^[^:]+:\d+:.*\b($T)\b"
echo "## S5: SQL functions and triggers whose bodies write a table (migrations)"
for f in $(grep -rlE "CREATE (OR REPLACE )?(FUNCTION|TRIGGER)" backend/src/main/resources/db/migration | sort); do grep -HnE "^\s*(INSERT INTO|UPDATE|DELETE FROM)\b" "$f"; done
