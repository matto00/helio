// Mirrors the backend `AdminUsageResponse` (`AdminUsageProtocol.scala`,
// schemas/admin/admin-usage-response.schema.json, HEL-1211). Aggregates only; no user ids.

export interface AdminUsageDayCount {
  day: string;
  count: number;
}

/** `weeklyActiveUsers` is `null` (a gap, never 0) for a day with no WAU. */
export interface AdminUsageActiveUsersDay {
  day: string;
  dailyActiveUsers: number;
  weeklyActiveUsers: number | null;
}

/** `sampleCount` is 0 and both percentiles `null` for a day without samples. */
export interface AdminUsageTtfdDay {
  day: string;
  sampleCount: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
}

export interface AdminUsageTtfd {
  newUsersOnly: true;
  perDay: AdminUsageTtfdDay[];
  latest: AdminUsageTtfdDay | null;
}

export type AdminUsageFunnelStageName =
  | "firstrun_file_dropped"
  | "firstrun_dashboard_created"
  | "first_dashboard_rendered";

export interface AdminUsageFunnelStage {
  stage: AdminUsageFunnelStageName;
  users: number;
  conversionFromPrevious: number | null;
}

export interface AdminUsageTemplateCount {
  template: string;
  count: number;
}

export interface AdminUsage {
  days: number;
  from: string;
  to: string;
  rolledThrough: string | null;
  signupsPerDay: AdminUsageDayCount[];
  ttfd: AdminUsageTtfd;
  funnel: AdminUsageFunnelStage[];
  templateChoices: AdminUsageTemplateCount[];
  provenanceOpensPerDay: AdminUsageDayCount[];
  activeUsers: AdminUsageActiveUsersDay[];
}
