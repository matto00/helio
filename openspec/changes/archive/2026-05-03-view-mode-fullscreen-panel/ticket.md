# HEL-174 — View mode: full-screen panel content render

## Description

Default mode when the detail modal opens. Renders the panel's content at maximum available modal size. Read-only — no editing controls visible. Accessible to any user with view permission on the dashboard.

## Priority

High

## Project

Helio v1.2 — Panel System

## Parent

HEL-139

## Acceptance Criteria

- When the panel detail modal opens, it defaults to "view mode"
- View mode renders the panel's content area at the maximum available size within the modal
- No editing controls are visible in view mode (no rename field, no type picker, no settings)
- The mode is read-only — no user-triggered mutations
- Any user with view permission on the dashboard can access this mode
