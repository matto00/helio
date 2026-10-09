import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";

import { defaultChartAppearance } from "../../../theme/appearance";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageHeader } from "../../../shared/ui/PageHeader";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { Select } from "../../../shared/ui/Select";
import { useAdminUsage } from "../hooks/useAdminUsage";
import type { AdminUsage, AdminUsageFunnelStageName } from "../types/adminUsage";
import { formatCount, formatDuration, formatPercent, shortDay } from "../format";
import { Stat } from "./Stat";
import { UsageCard } from "./UsageCard";
import { UsageChart } from "./UsageChart";
import { UsageTotals } from "./UsageTotals";
import "./AdminUsagePage.css";

const WINDOWS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
  { value: "365", label: "Last 365 days" },
];

// Data-viz colour (not chrome): the first series colour of the app's own chart palette, so the CSS
// bars read as the same data as the ECharts series next to them.
const BAR_COLOR = defaultChartAppearance.seriesColors[0];

const FUNNEL_LABELS: Record<AdminUsageFunnelStageName, string> = {
  firstrun_file_dropped: "File dropped",
  firstrun_dashboard_created: "Dashboard created",
  first_dashboard_rendered: "First dashboard rendered",
};

function lastNonNull(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== null) return values[i];
  }
  return null;
}

function UsageContent({ data }: { data: AdminUsage }) {
  const days = useMemo(() => data.signupsPerDay.map((d) => d.day), [data]);
  const axis = useMemo(() => days.map(shortDay), [days]);

  const signups = useMemo(
    () => [{ name: "Signups", values: data.signupsPerDay.map((d) => d.count) }],
    [data],
  );
  const opens = useMemo(
    () => [{ name: "Provenance opens", values: data.provenanceOpensPerDay.map((d) => d.count) }],
    [data],
  );
  const active = useMemo(
    () => [
      { name: "Daily active users", values: data.activeUsers.map((d) => d.dailyActiveUsers) },
      { name: "Weekly active users", values: data.activeUsers.map((d) => d.weeklyActiveUsers) },
    ],
    [data],
  );
  const ttfd = useMemo(
    () => [
      { name: "Median", values: data.ttfd.perDay.map((d) => d.medianSeconds) },
      { name: "p90", values: data.ttfd.perDay.map((d) => d.p90Seconds) },
    ],
    [data],
  );

  const totalSignups = data.signupsPerDay.reduce((n, d) => n + d.count, 0);
  const totalOpens = data.provenanceOpensPerDay.reduce((n, d) => n + d.count, 0);
  const latestDau = data.activeUsers.length
    ? data.activeUsers[data.activeUsers.length - 1].dailyActiveUsers
    : null;
  const latestWau = lastNonNull(data.activeUsers.map((d) => d.weeklyActiveUsers));
  const funnelMax = Math.max(1, ...data.funnel.map((s) => s.users));
  const templateMax = Math.max(1, ...data.templateChoices.map((t) => t.count));
  const latestTtfd = data.ttfd.latest;

  return (
    <>
      <dl className="admin-usage__stats">
        <Stat label={`Signups (${data.days}d)`} value={String(totalSignups)} />
        <Stat label="DAU (latest day)" value={formatCount(latestDau)} />
        <Stat label="WAU (latest)" value={formatCount(latestWau)} />
        <Stat
          label="Time to first dashboard"
          value={latestTtfd ? formatDuration(latestTtfd.medianSeconds) : "—"}
          hint={latestTtfd ? `median, ${shortDay(latestTtfd.day)}` : "no samples yet"}
        />
      </dl>

      <div className="admin-usage__grid">
        <UsageCard
          title="Signups per day"
          table={{
            caption: "Signups per day",
            headers: ["Day", "Signups"],
            rows: data.signupsPerDay.map((d) => [d.day, String(d.count)]),
          }}
        >
          <UsageChart
            categories={axis}
            series={signups}
            kind="bar"
            ariaLabel={`Signups per day, ${totalSignups} in the last ${data.days} days`}
          />
        </UsageCard>

        <UsageCard
          title="Daily and weekly active users"
          note="Weekly active users is blank for days it cannot be computed."
          table={{
            caption: "Daily and weekly active users",
            headers: ["Day", "DAU", "WAU"],
            rows: data.activeUsers.map((d) => [
              d.day,
              String(d.dailyActiveUsers),
              formatCount(d.weeklyActiveUsers),
            ]),
          }}
        >
          <UsageChart
            categories={axis}
            series={active}
            kind="line"
            ariaLabel={`Daily and weekly active users; latest DAU ${formatCount(latestDau)}, WAU ${formatCount(latestWau)}`}
          />
        </UsageCard>

        <UsageCard
          title="Time to first dashboard"
          note="New users only (users who signed up after telemetry shipped). Earlier users are excluded on purpose."
          table={{
            caption: "Time to first dashboard per day, new users only",
            headers: ["Day", "Samples", "Median", "p90"],
            rows: data.ttfd.perDay.map((d) => [
              d.day,
              String(d.sampleCount),
              formatDuration(d.medianSeconds),
              formatDuration(d.p90Seconds),
            ]),
          }}
        >
          <UsageChart
            categories={axis}
            series={ttfd}
            kind="line"
            valueFormatter={formatDuration}
            ariaLabel={
              latestTtfd
                ? `Time to first dashboard, new users only; latest ${shortDay(latestTtfd.day)} median ${formatDuration(latestTtfd.medianSeconds)}, p90 ${formatDuration(latestTtfd.p90Seconds)}`
                : "Time to first dashboard, new users only; no samples in this window"
            }
          />
        </UsageCard>

        <UsageCard
          title="First-run funnel"
          note="By event day: distinct users per stage summed over the window, not a strict cohort."
          table={{
            caption: "First-run funnel",
            headers: ["Stage", "Users", "From previous stage"],
            rows: data.funnel.map((s) => [
              FUNNEL_LABELS[s.stage],
              String(s.users),
              formatPercent(s.conversionFromPrevious),
            ]),
          }}
        >
          <ol className="admin-usage__bars" aria-label="First-run funnel stages">
            {data.funnel.map((s) => (
              <li key={s.stage} className="admin-usage__bar-row">
                <span className="admin-usage__bar-label">{FUNNEL_LABELS[s.stage]}</span>
                <span className="admin-usage__bar-track" aria-hidden="true">
                  <span
                    className="admin-usage__bar-fill"
                    style={{ width: `${(s.users / funnelMax) * 100}%`, background: BAR_COLOR }}
                  />
                </span>
                <span className="admin-usage__bar-value mono">
                  {s.users}
                  <span className="admin-usage__bar-sub">
                    {formatPercent(s.conversionFromPrevious)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </UsageCard>

        <UsageCard
          title="Template choices"
          note="Includes an “other” bucket for templates outside the shipped set."
          table={{
            caption: "Template choices",
            headers: ["Template", "Chosen"],
            rows: data.templateChoices.map((t) => [t.template, String(t.count)]),
          }}
        >
          {data.templateChoices.length === 0 ? (
            <p className="admin-usage__muted">No template choices in this window.</p>
          ) : (
            <ul className="admin-usage__bars" aria-label="Template choices">
              {data.templateChoices.map((t) => (
                <li key={t.template} className="admin-usage__bar-row">
                  <span className="admin-usage__bar-label">{t.template}</span>
                  <span className="admin-usage__bar-track" aria-hidden="true">
                    <span
                      className="admin-usage__bar-fill"
                      style={{ width: `${(t.count / templateMax) * 100}%`, background: BAR_COLOR }}
                    />
                  </span>
                  <span className="admin-usage__bar-value mono">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </UsageCard>

        <UsageCard
          title="Provenance opens per day"
          table={{
            caption: "Provenance opens per day",
            headers: ["Day", "Opens"],
            rows: data.provenanceOpensPerDay.map((d) => [d.day, String(d.count)]),
          }}
        >
          <UsageChart
            categories={axis}
            series={opens}
            kind="bar"
            ariaLabel={`Provenance opens per day, ${totalOpens} in the last ${data.days} days`}
          />
        </UsageCard>
      </div>
    </>
  );
}

/** Owner-only aggregate usage view (HEL-1211): the read surface for the first-party product
 *  telemetry rollups. The server (`GET /api/admin/usage`) is the real gate; this page only renders
 *  what an owner gets back. */
export function AdminUsagePage() {
  const [days, setDays] = useState(30);
  const { data, status, error, retry } = useAdminUsage(days);

  return (
    <PageShell className="admin-usage">
      <PageHeader
        eyebrow="Owner admin"
        title="Usage"
        actions={
          <Select
            ariaLabel="Time window"
            value={String(days)}
            options={WINDOWS}
            onChange={(v) => setDays(Number(v))}
          />
        }
      />

      {status === "loading" && !data && (
        <PageStatus status="loading" loadingLabel="Loading usage" />
      )}
      {status === "failed" && (
        <PageStatus
          status="failed"
          title="Couldn’t load usage"
          message={error ?? "Failed to load usage."}
          onRetry={retry}
        />
      )}
      {data && status !== "failed" && (
        <>
          <p className="admin-usage__through" aria-live="polite">
            {data.rolledThrough ? (
              <>
                <strong className="mono">Data through {data.rolledThrough} (UTC)</strong>
                <span>The most recent ~2 days are still being rolled up.</span>
              </>
            ) : (
              "No usage has been rolled up yet"
            )}
          </p>
          <UsageTotals totals={data.totals} />
          {data.rolledThrough === null ? (
            <EmptyState
              variant="main"
              icon={<BarChart3 />}
              title="No usage data yet"
              description="Aggregates appear after the first daily rollup runs."
            />
          ) : (
            <UsageContent data={data} />
          )}
        </>
      )}
    </PageShell>
  );
}
