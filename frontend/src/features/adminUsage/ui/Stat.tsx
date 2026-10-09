export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="admin-usage__stat">
      <dt className="eyebrow">{label}</dt>
      <dd className="admin-usage__stat-value mono">{value}</dd>
      {hint && <dd className="admin-usage__stat-hint">{hint}</dd>}
    </div>
  );
}
