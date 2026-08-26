// Human-readable labels for audit `action` values (design.md Decision 7),
// informed by the exhaustive route->action enumeration in
// openspec/changes/archive/2026-08-26-instrument-audit-mutations/route-audit-enumeration.md.
// An unmapped action falls back to rendering the raw string verbatim
// (fail-open, never a blank row) so a future instrumented action never
// silently disappears from the UI — this map needs manual upkeep as new
// actions ship, but staleness degrades gracefully.

const ACTION_LABELS: Record<string, string> = {
  "dashboard.create": "Created dashboard",
  "dashboard.duplicate": "Duplicated dashboard",
  "dashboard.update": "Updated dashboard",
  "dashboard.delete": "Deleted dashboard",
  "dashboard.contents.replace": "Replaced dashboard contents",
  "dashboard.import": "Imported dashboard",
  "panel.create": "Created panel",
  "panel.duplicate": "Duplicated panel",
  "panel.update": "Updated panel",
  "panel.delete": "Deleted panel",
  "panel.batch_create": "Created panels (batch)",
  "panel.batch_update": "Updated panels (batch)",
  "pipeline.create": "Created pipeline",
  "pipeline.update": "Updated pipeline",
  "pipeline.delete": "Deleted pipeline",
  "pipeline.step.create": "Added pipeline step",
  "pipeline.step.reorder": "Reordered pipeline steps",
  "pipeline.step.update": "Updated pipeline step",
  "pipeline.step.delete": "Deleted pipeline step",
  "pipeline.step.duplicate": "Duplicated pipeline step",
  "pipeline.run.submit": "Ran pipeline",
  "pipeline.schedule.upsert": "Set pipeline schedule",
  "pipeline.schedule.delete": "Removed pipeline schedule",
  "data_source.create": "Created data source",
  "data_source.update": "Updated data source",
  "data_source.delete": "Deleted data source",
  "image_upload.create": "Uploaded image",
  "data_type.update": "Updated data type",
  "data_type.delete": "Deleted data type",
  "auth.register": "Registered account",
  "auth.login": "Signed in",
  "auth.login.challenged": "Signed in (MFA challenge)",
  "auth.login.failed": "Failed sign-in attempt",
  "auth.logout": "Signed out",
  "auth.mfa.enable": "Enabled two-factor authentication",
  "auth.mfa.backup_codes.regenerate": "Regenerated MFA backup codes",
  "auth.mfa.disable": "Disabled two-factor authentication",
  "token.create": "Created personal access token",
  "token.revoke": "Revoked personal access token",
  "ratelimit.trip": "Rate limit triggered",
};

/** Human-readable label for `action`, falling back to the raw string when
 *  unmapped (design.md Decision 7). */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
