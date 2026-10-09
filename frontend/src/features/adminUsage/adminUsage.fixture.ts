import type { AdminUsage } from "./types/adminUsage";

export const usage: AdminUsage = {
  days: 3,
  from: "2026-04-11",
  to: "2026-04-13",
  rolledThrough: "2026-04-13",
  signupsPerDay: [
    { day: "2026-04-11", count: 2 },
    { day: "2026-04-12", count: 0 },
    { day: "2026-04-13", count: 5 },
  ],
  ttfd: {
    newUsersOnly: true,
    perDay: [
      { day: "2026-04-11", sampleCount: 2, medianSeconds: 320, p90Seconds: 900 },
      { day: "2026-04-12", sampleCount: 0, medianSeconds: null, p90Seconds: null },
      { day: "2026-04-13", sampleCount: 0, medianSeconds: null, p90Seconds: null },
    ],
    latest: { day: "2026-04-11", sampleCount: 2, medianSeconds: 320, p90Seconds: 900 },
  },
  funnel: [
    { stage: "firstrun_file_dropped", users: 8, conversionFromPrevious: null },
    { stage: "firstrun_dashboard_created", users: 6, conversionFromPrevious: 0.75 },
    { stage: "first_dashboard_rendered", users: 3, conversionFromPrevious: 0.5 },
  ],
  templateChoices: [
    { template: "streamer", count: 4 },
    { template: "other", count: 1 },
  ],
  provenanceOpensPerDay: [
    { day: "2026-04-11", count: 1 },
    { day: "2026-04-12", count: 0 },
    { day: "2026-04-13", count: 3 },
  ],
  activeUsers: [
    { day: "2026-04-11", dailyActiveUsers: 4, weeklyActiveUsers: null },
    { day: "2026-04-12", dailyActiveUsers: 0, weeklyActiveUsers: null },
    { day: "2026-04-13", dailyActiveUsers: 7, weeklyActiveUsers: 12 },
  ],
  totals: { totalUsers: 8, activeLast7Days: 2, activeLast30Days: 4, asOf: "2026-04-13" },
};
