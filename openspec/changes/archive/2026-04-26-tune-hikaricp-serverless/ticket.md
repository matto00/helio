# HEL-96 — Tune HikariCP for serverless environment

## Title
Tune HikariCP for serverless environment

## Description
Set HikariCP pool to small values appropriate for Cloud Run's ephemeral instances: `maximumPoolSize=5`, `minimumIdle=0`, `idleTimeout=30000`, `maxLifetime=60000`. Document reasoning: Cloud Run instances are short-lived and scale horizontally, so many long pools × many instances will exhaust Cloud SQL's connection limit.

## Acceptance Criteria
- `maximumPoolSize` is set to 5
- `minimumIdle` is set to 0
- `idleTimeout` is set to 30000 (ms)
- `maxLifetime` is set to 60000 (ms)
- Reasoning is documented (inline comment or README note) explaining why these values are appropriate for Cloud Run / Cloud SQL

## Context
- Project: Deployment
- Milestone: Provision Database
- Parent: HEL-75
- Priority: Medium
- Linear URL: https://linear.app/helioapp/issue/HEL-96/tune-hikaricp-for-serverless-environment
