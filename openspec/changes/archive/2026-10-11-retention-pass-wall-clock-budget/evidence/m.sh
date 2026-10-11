#!/usr/bin/env bash
# Run a RetentionTickMeasure mode via sbt (args passed through). Repo-relative.
D="$(cd "$(dirname "$0")" && pwd)"
W="$(git -C "$D" rev-parse --show-toplevel)"
cd "$W/backend" || exit 1
exec nice -n 19 sbt -J-Xmx3g "Test/runMain com.helio.services.pipelines.RetentionTickMeasure $*"
