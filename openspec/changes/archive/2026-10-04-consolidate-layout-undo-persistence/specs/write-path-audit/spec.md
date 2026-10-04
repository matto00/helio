## MODIFIED Requirements

### Requirement: Write path audit documents the layout debounce
The audit SHALL note that layout changes (drag/resize) are not sent per `onLayoutChange` event: a completed
drag/resize is staged locally and persisted by the shared 30-second auto-save interval, Save now, or the desktop
grid's unmount flush, resulting in at most one layout PATCH per flush regardless of how many interactions were
staged since the last one.

#### Scenario: Debounce behaviour is recorded
- **WHEN** a developer reads the layout-change row in the audit
- **THEN** it SHALL state that the call fires at most once per flush (auto-save tick, Save now, or unmount), not once
  per pixel moved or per drag/resize stop
