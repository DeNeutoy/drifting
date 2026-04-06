import { useState, useEffect, useCallback, useRef, useMemo } from "preact/hooks";
import { api } from "../api";
import { Chart } from "../components/Chart";
import type { ChartSeries, SeriesLink } from "../components/Chart";
import { LayoutPicker } from "../components/LayoutPicker";
import type { ChartLayout } from "../components/LayoutPicker";
import { NavBar } from "../components/NavBar";
import { useInterval } from "../hooks/useInterval";
import { COLORS, POLL_INTERVAL } from "../constants";
import type { RunSummary, MetricsResponse, MetricSeries, SystemMetricsResponse, SystemMetricSeries } from "../types";

interface WorkspacePageProps {
  entity: string;
  project: string;
}

const SYNC_KEY = "workspace";

export function WorkspacePage({ entity, project }: WorkspacePageProps) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [metricsData, setMetricsData] = useState<Record<string, MetricsResponse>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>({});
  const [colorPickerRun, setColorPickerRun] = useState<string | null>(null);
  const [hoveredRunName, setHoveredRunName] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [metricSearch, setMetricSearch] = useState("");
  const [systemData, setSystemData] = useState<Record<string, SystemMetricsResponse>>({});
  const [hiddenCharts, setHiddenCharts] = useState<Set<string>>(new Set());
  const [panelsOpen, setPanelsOpen] = useState(false);
  const panelsRef = useRef<HTMLDivElement>(null);
  const [globalLayout, setGlobalLayout] = useState<ChartLayout>({ cols: 2, rows: 1 });
  const [sectionLayouts, setSectionLayouts] = useState<Record<string, ChartLayout>>({});
  const [sectionPages, setSectionPages] = useState<Record<string, number>>({});
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const checkedInitialized = useRef(false);

  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!panelsOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelsRef.current && !panelsRef.current.contains(e.target as Node)) {
        setPanelsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [panelsOpen]);

  const onSidebarResizeStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarRef.current?.offsetWidth ?? sidebarWidth;
    const handle = e.currentTarget as HTMLElement;
    handle.classList.add("dragging");

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(180, Math.min(startW + ev.clientX - startX, window.innerWidth * 0.5));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      handle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const fetchRuns = useCallback(() => {
    api<RunSummary[]>(`/api/runs?entity=${encodeURIComponent(entity)}&project=${encodeURIComponent(project)}`).then(
      (data) => {
        setRuns(data);
        if (data.length === 0) setNotFound(true);
        setChecked((prev) => {
          const merged = { ...prev };
          data.forEach((r) => {
            if (!(r.run_id in merged)) merged[r.run_id] = true;
          });
          if (!checkedInitialized.current) checkedInitialized.current = true;
          return merged;
        });
      },
    ).catch(() => setNotFound(true));
  }, [entity, project]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);
  useInterval(fetchRuns, POLL_INTERVAL);

  const fetchMetrics = useCallback(() => {
    if (!runs) return;
    const checkedRuns = runs.filter((r) => checked[r.run_id]);
    const hasLiveRuns = runs.some((r) => r.status === "running");
    checkedRuns.forEach((r) => {
      const needsRefresh = hasLiveRuns || !metricsData[r.run_id];
      if (!needsRefresh) return;
      api<MetricsResponse>(`/api/runs/${r.run_id}/metrics`).then((data) => {
        setMetricsData((prev) => ({ ...prev, [r.run_id]: data }));
      });
      if (!systemData[r.run_id]) {
        api<SystemMetricsResponse>(`/api/runs/${r.run_id}/system`).then((data) => {
          setSystemData((prev) => ({ ...prev, [r.run_id]: data }));
        }).catch(() => {});
      }
    });
  }, [runs, checked, metricsData, systemData]);

  useEffect(() => { fetchMetrics(); }, [runs, checked]);
  useInterval(fetchMetrics, POLL_INTERVAL);

  // Derive config keys for group-by dropdown
  const configKeys = useMemo(() => {
    if (!runs) return [];
    const keys = new Set<string>();
    runs.forEach((r) => {
      if (r.config) Object.keys(r.config).forEach((k) => keys.add(k));
    });
    return [...keys].sort();
  }, [runs]);

  if (notFound) {
    return (
      <div class="container">
        <NavBar />
        <div class="not-found">
          <h2>Project not found</h2>
          <p>No runs found for <code>{entity}/{project}</code>.</p>
          <a href="#/">Back to projects</a>
        </div>
      </div>
    );
  }

  if (!runs) return <div class="loading">Loading runs...</div>;

  // Build stable run → color map
  const runColorMap: Record<string, string> = {};
  const nameColorMap: Record<string, string> = {};
  runs.forEach((r, i) => {
    const color = colorOverrides[r.run_id] || COLORS[i % COLORS.length];
    runColorMap[r.run_id] = color;
    nameColorMap[r.name] = color;
  });

  // Filter runs for sidebar
  const filteredRuns = runs.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    return true;
  });

  const checkedRuns = filteredRuns.filter((r) => checked[r.run_id]);

  // Group sidebar runs
  let sidebarGroups: { key: string; runs: RunSummary[] }[] | null = null;
  if (groupBy) {
    const map = new Map<string, RunSummary[]>();
    filteredRuns.forEach((r) => {
      const val = String(r.config?.[groupBy] ?? "—");
      if (!map.has(val)) map.set(val, []);
      map.get(val)!.push(r);
    });
    sidebarGroups = [...map.entries()].map(([key, runs]) => ({ key, runs }));
  }

  // Chart data
  const chartKeys = new Set<string>();
  checkedRuns.forEach((r) => {
    const md = metricsData[r.run_id];
    if (md?.keys) md.keys.forEach((k) => chartKeys.add(k));
  });

  let metricRegex: RegExp | null = null;
  if (metricSearch) {
    try { metricRegex = new RegExp(metricSearch, "i"); } catch { /* invalid regex, ignore */ }
  }

  const filteredChartKeys = [...chartKeys]
    .filter((k) => !hiddenCharts.has(k))
    .filter((k) => !metricRegex || metricRegex.test(k));

  const groupedCharts: Record<string, string[]> = {};
  filteredChartKeys.sort().forEach((key) => {
    const prefix = key.includes("/") ? key.split("/")[0] : "_ungrouped";
    if (!groupedCharts[prefix]) groupedCharts[prefix] = [];
    groupedCharts[prefix].push(key);
  });

  function toggleCheck(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // System metrics: collect all keys across checked runs
  const systemChartKeys = new Set<string>();
  checkedRuns.forEach((r) => {
    const sd = systemData[r.run_id];
    if (sd?.keys) sd.keys.forEach((k) => systemChartKeys.add(k));
  });

  const systemGroups: Record<string, string[]> = {};
  [...systemChartKeys].sort().forEach((key) => {
    let group: string;
    if (key.startsWith("gpu.")) {
      const gpuIdx = key.split("/")[0];
      group = `GPU ${gpuIdx.replace("gpu.", "")}`;
    } else if (key.startsWith("cpu")) {
      group = "CPU";
    } else if (key.startsWith("memory")) {
      group = "Memory";
    } else if (key.startsWith("disk")) {
      group = "Disk";
    } else {
      group = "System";
    }
    if (!systemGroups[group]) systemGroups[group] = [];
    systemGroups[group].push(key);
  });

  function buildSystemChartSeries(metricKey: string): { series: ChartSeries[]; links: SeriesLink[] } | null {
    const runSeries: { runId: string; label: string; timestamps: number[]; values: number[] }[] = [];

    checkedRuns.forEach((r) => {
      const sd = systemData[r.run_id];
      if (!sd?.[metricKey]) return;
      const s = sd[metricKey] as SystemMetricSeries;
      if (!s.timestamps || s.timestamps.length === 0) return;
      runSeries.push({ runId: r.run_id, label: r.name, timestamps: s.timestamps, values: s.values });
    });

    if (runSeries.length === 0) return null;

    const allTimestamps = new Set<number>();
    runSeries.forEach((rs) => {
      rs.timestamps.forEach((t) => allTimestamps.add(t));
    });

    const sortedTs = [...allTimestamps].sort((a, b) => a - b);
    const series: ChartSeries[] = [{ data: new Float64Array(sortedTs) }];
    const links: SeriesLink[] = [];

    runSeries.forEach((rs) => {
      const tsMap = new Map<number, number>();
      rs.timestamps.forEach((t, i) => tsMap.set(t, rs.values[i]));
      const data = sortedTs.map((t) => (tsMap.has(t) ? tsMap.get(t)! : null));
      series.push({ label: rs.label, data: data as unknown as number[] });
      links.push({ label: rs.label, href: `#/runs/${rs.runId}`, runId: rs.runId });
    });

    return { series, links };
  }

  function buildChartSeries(metricKey: string): { series: ChartSeries[]; links: SeriesLink[] } | null {
    const allSteps = new Set<number>();
    const runSeries: { runId: string; label: string; steps: number[]; values: number[] }[] = [];

    checkedRuns.forEach((r) => {
      const md = metricsData[r.run_id];
      if (!md?.[metricKey]) return;
      const s = md[metricKey] as MetricSeries;
      s.steps.forEach((st) => allSteps.add(st));
      runSeries.push({ runId: r.run_id, label: r.name, steps: s.steps, values: s.values });
    });

    if (runSeries.length === 0) return null;

    const sortedSteps = [...allSteps].sort((a, b) => a - b);
    const series: ChartSeries[] = [{ data: new Float64Array(sortedSteps) }];
    const links: SeriesLink[] = [];

    runSeries.forEach((rs) => {
      const stepMap = new Map<number, number>();
      rs.steps.forEach((s, i) => stepMap.set(s, rs.values[i]));
      const data = sortedSteps.map((s) => (stepMap.has(s) ? stepMap.get(s)! : null));
      series.push({ label: rs.label, data: data as unknown as number[] });
      links.push({ label: rs.label, href: `#/runs/${rs.runId}`, runId: rs.runId });
    });

    return { series, links };
  }

  function renderRunItem(r: RunSummary) {
    const color = runColorMap[r.run_id];
    const isHovered = hoveredRunName === r.name;
    return (
      <div
        class={`run-item ${isHovered ? "run-item-highlighted" : ""}`}
        key={r.run_id}
        onMouseEnter={() => setHoveredRunName(r.name)}
        onMouseLeave={() => setHoveredRunName(null)}
      >
        <input
          type="checkbox"
          checked={!!checked[r.run_id]}
          onChange={() => toggleCheck(r.run_id)}
        />
        <span
          class="color-dot"
          style={{ background: color, cursor: "pointer" }}
          title="Click to change color"
          onClick={() => setColorPickerRun(colorPickerRun === r.run_id ? null : r.run_id)}
        />
        <a href={`#/runs/${r.run_id}`} class="run-item-name">{r.name}</a>
        <a href={`#/runs/${r.run_id}/logs`} class="run-item-logs" title="View logs">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 3.5A1.5 1.5 0 012.5 2h11A1.5 1.5 0 0115 3.5v9a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9zM3 5h10v1H3V5zm0 3h7v1H3V8zm0 3h10v1H3v-1z"/>
          </svg>
        </a>
        {colorPickerRun === r.run_id && (
          <div class="color-picker-popover">
            {COLORS.map((c) => (
              <span
                key={c}
                class={`color-picker-swatch ${c === color ? "selected" : ""}`}
                style={{ background: c }}
                onClick={() => {
                  setColorOverrides((prev) => ({ ...prev, [r.run_id]: c }));
                  setColorPickerRun(null);
                }}
              />
            ))}
            <input
              type="color"
              class="color-picker-custom"
              value={color}
              onChange={(e) => {
                setColorOverrides((prev) => ({ ...prev, [r.run_id]: (e.target as HTMLInputElement).value }));
                setColorPickerRun(null);
              }}
              title="Custom color"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div class="container" style={{ padding: 0 }}>
      <div style={{ padding: "24px 24px 0" }}>
        <NavBar entity={entity} project={project} activeTab="workspace" />
      </div>
      <div class="workspace-layout">
        <div class="workspace-sidebar" ref={sidebarRef} style={{ width: sidebarWidth }}>
          <div class="sidebar-resize-handle" onMouseDown={onSidebarResizeStart} />
          <input
            type="text"
            class="sidebar-search"
            placeholder="Search runs..."
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
          <div class="sidebar-controls">
            <select
              class="control-btn sidebar-control-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}
            >
              <option value="all">All Status</option>
              <option value="running">Running</option>
              <option value="finished">Finished</option>
              <option value="failed">Failed</option>
            </select>
            <div class="popover-anchor">
              <button class={`control-btn sidebar-control-select ${groupBy ? "active" : ""}`} onClick={() => setGroupOpen(!groupOpen)}>
                {groupBy ? `Group: ${groupBy}` : "Group"}
              </button>
              {groupOpen && (
                <div class="popover">
                  <div class="popover-item" onClick={() => { setGroupBy(null); setGroupOpen(false); }}>None</div>
                  {configKeys.map((k) => (
                    <div key={k} class="popover-item" onClick={() => { setGroupBy(k); setGroupOpen(false); }}>{k}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div class="sidebar-run-list">
            {sidebarGroups
              ? sidebarGroups.map((g) => (
                  <div key={g.key}>
                    <div class="sidebar-group-label" onClick={() => toggleGroup(g.key)}>
                      {collapsedGroups.has(g.key) ? "▶" : "▼"} {groupBy} = {g.key} ({g.runs.length})
                    </div>
                    {!collapsedGroups.has(g.key) && g.runs.map(renderRunItem)}
                  </div>
                ))
              : filteredRuns.map(renderRunItem)}
          </div>
        </div>
        <div class="workspace-main">
          <div class="metric-search-bar">
            <input
              type="text"
              class="sidebar-search"
              placeholder="Filter metrics (regex)..."
              value={metricSearch}
              onInput={(e) => setMetricSearch((e.target as HTMLInputElement).value)}
            />
            {metricSearch && (
              <span class="metric-search-count">
                {filteredChartKeys.length} / {chartKeys.size} metrics
              </span>
            )}
            <LayoutPicker value={globalLayout} onChange={setGlobalLayout} />
            <div class="popover-anchor" ref={panelsRef}>
              <button
                class={`control-btn ${hiddenCharts.size > 0 ? "active" : ""}`}
                onClick={() => setPanelsOpen(!panelsOpen)}
              >
                Panels{hiddenCharts.size > 0 ? ` (${hiddenCharts.size} hidden)` : ""}
              </button>
              {panelsOpen && (() => {
                const allKeys = [...new Set([...chartKeys, ...systemChartKeys])].sort();
                return (
                  <div class="popover panels-popover">
                    <div
                      class="popover-item panels-show-all"
                      onClick={() => setHiddenCharts(new Set())}
                    >
                      Show all
                    </div>
                    {allKeys.map((k) => (
                      <div key={k} class="popover-item" onClick={() => {
                        setHiddenCharts((prev) => {
                          const next = new Set(prev);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          return next;
                        });
                      }}>
                        <input type="checkbox" checked={!hiddenCharts.has(k)} readOnly />
                        <span class="panels-metric-label">{k}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
          {Object.entries(groupedCharts).map(([group, keys]) => {
            const sectionKey = group === "_ungrouped" ? "_ungrouped" : group;
            const collapsed = collapsedSections.has(sectionKey);
            const layout = sectionLayouts[sectionKey] ?? globalLayout;
            const pageSize = layout.cols * layout.rows;
            const page = sectionPages[sectionKey] ?? 0;
            const totalPages = Math.ceil(keys.length / pageSize);
            const clampedPage = Math.min(page, totalPages - 1);
            const pageKeys = keys.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);
            return (
              <div key={group}>
                <div
                  class="section-title section-title-collapsible"
                  onClick={() => setCollapsedSections((prev) => {
                    const next = new Set(prev);
                    if (next.has(sectionKey)) next.delete(sectionKey);
                    else next.add(sectionKey);
                    return next;
                  })}
                >
                  <span class="section-toggle">{collapsed ? "▶" : "▼"}</span>
                  {group === "_ungrouped" ? "Metrics" : group}
                  <span class="section-count">{keys.length}</span>
                  {!collapsed && (
                    <span class="section-layout-wrap" onClick={(e) => e.stopPropagation()}>
                      <LayoutPicker
                        compact
                        value={layout}
                        onChange={(l) => setSectionLayouts((prev) => ({ ...prev, [sectionKey]: l }))}
                      />
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <>
                    <div class="charts-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }}>
                      {pageKeys.map((key) => {
                        const result = buildChartSeries(key);
                        if (!result) return null;
                        return (
                          <Chart
                            key={key}
                            title={key}
                            series={result.series}
                            seriesLinks={result.links}
                            seriesColors={nameColorMap}
                            syncKey={SYNC_KEY}
                            highlightedLabel={hoveredRunName}
                            onHighlight={setHoveredRunName}
                            titleHighlight={metricRegex}
                            onHide={() => setHiddenCharts((prev) => new Set(prev).add(key))}
                          />
                        );
                      })}
                    </div>
                    {totalPages > 1 && (
                      <div class="charts-pagination">
                        <button disabled={clampedPage === 0} onClick={() => setSectionPages((p) => ({ ...p, [sectionKey]: clampedPage - 1 }))}>Prev</button>
                        <span>{clampedPage + 1} / {totalPages}</span>
                        <button disabled={clampedPage >= totalPages - 1} onClick={() => setSectionPages((p) => ({ ...p, [sectionKey]: clampedPage + 1 }))}>Next</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {systemChartKeys.size > 0 && (() => {
            const sectionKey = "system";
            const collapsed = collapsedSections.has(sectionKey);
            const allSystemKeys = [...systemChartKeys].filter((k) => !hiddenCharts.has(k)).sort();
            const layout = sectionLayouts[sectionKey] ?? globalLayout;
            const pageSize = layout.cols * layout.rows;
            const page = sectionPages[sectionKey] ?? 0;
            const totalPages = Math.ceil(allSystemKeys.length / pageSize);
            const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
            const pageKeys = allSystemKeys.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);
            return (
              <div key={sectionKey}>
                <div
                  class="section-title section-title-collapsible"
                  onClick={() => setCollapsedSections((prev) => {
                    const next = new Set(prev);
                    if (next.has(sectionKey)) next.delete(sectionKey);
                    else next.add(sectionKey);
                    return next;
                  })}
                >
                  <span class="section-toggle">{collapsed ? "▶" : "▼"}</span>
                  System
                  <span class="section-count">{allSystemKeys.length}</span>
                  {!collapsed && (
                    <span class="section-layout-wrap" onClick={(e) => e.stopPropagation()}>
                      <LayoutPicker
                        compact
                        value={layout}
                        onChange={(l) => setSectionLayouts((prev) => ({ ...prev, [sectionKey]: l }))}
                      />
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <>
                    <div class="charts-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }}>
                      {pageKeys.map((key) => {
                        const result = buildSystemChartSeries(key);
                        if (!result) return null;
                        return (
                          <Chart
                            key={key}
                            title={key}
                            series={result.series}
                            seriesLinks={result.links}
                            seriesColors={nameColorMap}
                            highlightedLabel={hoveredRunName}
                            onHighlight={setHoveredRunName}
                            onHide={() => setHiddenCharts((prev) => new Set(prev).add(key))}
                            timeAxis
                          />
                        );
                      })}
                    </div>
                    {totalPages > 1 && (
                      <div class="charts-pagination">
                        <button disabled={clampedPage === 0} onClick={() => setSectionPages((p) => ({ ...p, [sectionKey]: clampedPage - 1 }))}>Prev</button>
                        <span>{clampedPage + 1} / {totalPages}</span>
                        <button disabled={clampedPage >= totalPages - 1} onClick={() => setSectionPages((p) => ({ ...p, [sectionKey]: clampedPage + 1 }))}>Next</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
