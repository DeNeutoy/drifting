export function formatDuration(start: number, end?: number): string {
  if (!end) return "—";
  const s = Math.round(end - start);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export function formatMetric(v: number | undefined | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1000) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(4);
  return v.toPrecision(4);
}

export function formatRelativeTime(ts: number): string {
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
