import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { api } from "../api";
import { Chart } from "../components/Chart";
import { NavBar } from "../components/NavBar";
import { useInterval } from "../hooks/useInterval";
import { formatDuration, formatTime } from "../format";
import { POLL_INTERVAL } from "../constants";
import { MediaPanel } from "../components/MediaPanel";
import type { RunSummary, MetricsResponse, MetricSeries, LogEntry, SystemMetricsResponse, SystemMetricSeries, MediaItem } from "../types";

interface RunDetailPageProps {
  runId: string;
  initialTab?: "charts" | "logs" | "config" | "media";
}

export function RunDetailPage({ runId, initialTab = "charts" }: RunDetailPageProps) {
  const [run, setRun] = useState<RunSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetricsResponse | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [tab, setTab] = useState<"charts" | "logs" | "config" | "media">(initialTab);
  const [logStream, setLogStream] = useState("all");
  const [logSearch, setLogSearch] = useState("");
  const [systemCollapsed, setSystemCollapsed] = useState(false);

  const isLive = run?.status === "running";

  const fetchAll = useCallback(() => {
    api<RunSummary>(`/api/runs/${runId}`).then(setRun).catch(() => setNotFound(true));
    api<MetricsResponse>(`/api/runs/${runId}/metrics`).then(setMetrics).catch(() => {});
    api<LogEntry[]>(`/api/runs/${runId}/logs?limit=5000`).then(setLogs).catch(() => {});
    api<SystemMetricsResponse>(`/api/runs/${runId}/system`).then(setSystemMetrics).catch(() => {});
    api<MediaItem[]>(`/api/runs/${runId}/media`).then(setMedia).catch(() => {});
  }, [runId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);
  useInterval(fetchAll, isLive ? POLL_INTERVAL : null);

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    return logs.filter((l) => {
      if (logStream !== "all" && l.stream !== logStream) return false;
      if (logSearch && !l.line.toLowerCase().includes(logSearch.toLowerCase())) return false;
      return true;
    });
  }, [logs, logStream, logSearch]);

  if (notFound) {
    return (
      <div class="container">
        <NavBar />
        <div class="not-found">
          <h2>Run not found</h2>
          <p>No run with ID <code>{runId}</code> exists.</p>
          <a href="#/">Back to projects</a>
        </div>
      </div>
    );
  }

  if (!run) return <div class="loading">Loading...</div>;

  let config: Record<string, unknown> = {};
  try {
    config = typeof run.config === "string" ? JSON.parse(run.config as string) : run.config || {};
  } catch {
    /* ignore */
  }

  const groupedCharts: Record<string, string[]> = {};
  if (metrics?.keys) {
    metrics.keys.forEach((key) => {
      const prefix = key.includes("/") ? key.split("/")[0] : "_ungrouped";
      if (!groupedCharts[prefix]) groupedCharts[prefix] = [];
      groupedCharts[prefix].push(key);
    });
  }

  const systemKeys = systemMetrics?.keys ? [...systemMetrics.keys].sort() : [];
  const hasSystemMetrics = systemKeys.length > 0;

  return (
    <div class="container">
      <NavBar entity={run.entity} project={run.project} runName={run.name} />

      <div class="tabs">
        <button class={`tab ${tab === "charts" ? "active" : ""}`} onClick={() => setTab("charts")}>
          Charts
        </button>
        <button class={`tab ${tab === "logs" ? "active" : ""}`} onClick={() => setTab("logs")}>
          Logs
        </button>
        <button class={`tab ${tab === "config" ? "active" : ""}`} onClick={() => setTab("config")}>
          Config
        </button>
        <button class={`tab ${tab === "media" ? "active" : ""}`} onClick={() => setTab("media")}>
          Media{media.length > 0 ? ` (${media.length})` : ""}
        </button>
      </div>

      {tab === "charts" && (
        <>
          {Object.entries(groupedCharts).map(([group, keys]) => (
            <div key={group}>
              {group !== "_ungrouped" && <div class="section-title">{group}</div>}
              <div class="charts-grid">
                {keys.map((key) => {
                  const d = metrics![key] as MetricSeries | undefined;
                  if (!d) return null;
                  const series = [
                    { data: new Float64Array(d.steps) },
                    { label: key, data: d.values },
                  ];
                  return <Chart key={key} title={key} series={series} />;
                })}
              </div>
            </div>
          ))}
          {hasSystemMetrics && (
            <div>
              <div
                class="section-title"
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => setSystemCollapsed((c) => !c)}
              >
                <span style={{ display: "inline-block", width: "16px" }}>{systemCollapsed ? "▶" : "▼"}</span>
                System
              </div>
              {!systemCollapsed && (
                <div class="charts-grid">
                  {systemKeys.map((key) => {
                    const d = systemMetrics![key] as SystemMetricSeries | undefined;
                    if (!d || !d.timestamps || d.timestamps.length === 0) return null;
                    const series = [
                      { data: d.timestamps },
                      { label: key, data: d.values },
                    ];
                    return <Chart key={key} title={key} series={series} timeAxis />;
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === "logs" && (
        <div class="logs-container">
          <div class="log-controls">
            <select value={logStream} onChange={(e) => setLogStream((e.target as HTMLSelectElement).value)}>
              <option value="all">All</option>
              <option value="stdout">stdout</option>
              <option value="stderr">stderr</option>
            </select>
            <input
              type="text"
              placeholder="Search logs..."
              value={logSearch}
              onInput={(e) => setLogSearch((e.target as HTMLInputElement).value)}
            />
          </div>
          {filteredLogs.length === 0 ? (
            <div style={{ padding: "20px", color: "var(--text-dim)", textAlign: "center" }}>No logs</div>
          ) : (
            filteredLogs.map((l, i) => (
              <div class="log-line" key={i}>
                <span class="log-ts">{formatTime(l.timestamp)}</span>
                <span class={`log-stream ${l.stream}`}>{l.stream}</span>
                <span class="log-text">{l.line}</span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "config" && (
        <div>
          <div class="config-section" style={{ marginBottom: "16px" }}>
            <div class="meta-grid">
              <span class="label">Run ID</span>
              <span>{run.run_id}</span>
              <span class="label">Entity</span>
              <span>{run.entity}</span>
              <span class="label">Project</span>
              <span>{run.project}</span>
              <span class="label">Status</span>
              <span>
                <span class={`status ${run.status}`}>{run.status}</span>
              </span>
              <span class="label">Duration</span>
              <span>{formatDuration(run.start_time, run.end_time)}</span>
            </div>
          </div>
          {Object.keys(config).length > 0 && (
            <div class="config-section">
              <div class="section-title" style={{ marginBottom: "12px" }}>
                Config
              </div>
              <table class="config-table">
                <tbody>
                  {Object.entries(config).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "media" && <MediaPanel runId={runId} media={media} />}
    </div>
  );
}
