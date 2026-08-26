import type { AuditSource } from "../types/auditEvent";

/** Every row returned by `GET /api/audit-events` is by construction the
 *  caller's own (owner-scoped read) — an "actor" column showing the raw
 *  `actorUserId` would only ever echo the viewer's own UUID back at them.
 *  The "actor" the AC's language refers to is derived from `source`
 *  instead (design.md Decision 6a). `mcp` is a legal wire value the UI
 *  never actually receives today (no writer produces it) but is handled
 *  generically rather than crashing, per Decision 6. */
export function actorLabel(source: AuditSource): string {
  switch (source) {
    case "ui":
      return "You (browser)";
    case "pat":
      return "You (API token)";
    case "system":
      return "System";
    case "mcp":
      // Legal wire value, never actually produced today (no writer emits
      // it — see AuthDirectives). Rendered generically, distinctly from
      // "pat", rather than crashing or silently reusing the PAT label —
      // that reuse would be the exact "MCP labeled as PAT" inference this
      // ticket forbids doing in the other direction (design.md Decision 6).
      return `You (${source})`;
    default:
      return source;
  }
}
