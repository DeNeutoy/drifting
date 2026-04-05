import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { api } from "../api";
import { NavBar } from "../components/NavBar";
import { ColumnSelector } from "../components/ColumnSelector";
import { useInterval } from "../hooks/useInterval";
import { navigate } from "../hooks/useRoute";
import { formatMetric } from "../format";
import { POLL_INTERVAL } from "../constants";
import type { RunSummary } from "../types";

interface RunsTablePageProps {
  entity: string;
  project: string;
}

type SortDir = 1 | -1;

export function RunsTablePage({ entity, project }: RunsTablePageProps) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("start_time");
  const [sortDir, setSortDir] = useState<SortDir>(-1);
  const [visibleCols, setVisibleCols] = useState<Set<string> | null>(null);
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const fetchRuns = useCallback(() => {
    api<RunSummary[]>(
      `/api/runs?entity=${encodeURIComponent(entity)}&project=${encodeURIComponent(project)}`,
    ).then(setRuns);
  }, [entity, project]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);
  useInterval(fetchRuns, POLL_INTERVAL);

  const { metricCols, configCols, allCols } = useMemo(() => {
    if (!runs) return { metricCols: [], configCols: [], allCols: [] };
    const mkeys = new Set<string>();
    const ckeys = new Set<string>();
    runs.forEach((r) => {
      if (r.summary_metrics) Object.keys(r.summary_metrics).forEach((k) => mkeys.add(k));
      if (r.config) Object.keys(r.config).forEach((k) => ckeys.add(k));
    });
    const mc = [...mkeys].sort();
    const cc = [...ckeys].sort();
    return { metricCols: mc, configCols: cc, allCols: [...mc, ...cc] };
  }, [runs]);

  useEffect(() => {
    if (visibleCols === null && allCols.length > 0) {
      setVisibleCols(new Set(metricCols.slice(0, 6)));
    }
  }, [allCols, visibleCols, metricCols]);

  if (!runs) return <div class="loading">Loading runs...</div>;

  const activeVisibleCols = visibleCols ?? new Set<string>();

  const filtered = runs.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let va: unknown, vb: unknown;
    if (sortCol === "name") { va = a.name; vb = b.name; }
    else if (sortCol === "status") { va = a.status; vb = b.status; }
    else if (sortCol === "start_time") { va = a.start_time; vb = b.start_time; }
    else if (a.summary_metrics?.[sortCol] !== undefined) {
      va = a.summary_metrics?.[sortCol]; vb = b.summary_metrics?.[sortCol];
    } else {
      va = a.config?.[sortCol]; vb = b.config?.[sortCol];
    }
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va as number) < (vb as number) ? sortDir : (va as number) > (vb as number) ? -sortDir : 0;
  });

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d > 0 ? -1 : 1) as SortDir);
    else { setSortCol(col); setSortDir(-1); }
  }

  function toggleCol(col: string) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }

  const sortArrow = (col: string) => (sortCol === col ? (sortDir > 0 ? " ↑" : " ↓") : "");

  const displayCols = allCols.filter((c) => activeVisibleCols.has(c));
  const isConfig = (col: string) => configCols.includes(col);

  function getCellValue(r: RunSummary, col: string): string {
    if (isConfig(col)) {
      const v = r.config?.[col];
      if (v == null) return "—";
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    return formatMetric(r.summary_metrics?.[col]);
  }

  // Grouping logic
  let groups: { key: string; runs: RunSummary[] }[] | null = null;
  if (groupBy) {
    const map = new Map<string, RunSummary[]>();
    sorted.forEach((r) => {
      const val = isConfig(groupBy)
        ? String(r.config?.[groupBy] ?? "—")
        : String(r.summary_metrics?.[groupBy] ?? "—");
      if (!map.has(val)) map.set(val, []);
      map.get(val)!.push(r);
    });
    groups = [...map.entries()].map(([key, runs]) => ({ key, runs }));
  }

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportCsv() {
    const headers = ["name", "status", ...displayCols];
    const rows = (groups ? groups.flatMap((g) => g.runs) : sorted);
    const csvRows = [
      headers.map(escapeCsvField).join(","),
      ...rows.map((r) =>
        [r.name, r.status, ...displayCols.map((col) => getCellValue(r, col))]
          .map(escapeCsvField)
          .join(",")
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity}_${project}_runs.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function escapeCsvField(val: string): string {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  function renderRow(r: RunSummary) {
    return (
      <tr key={r.run_id}>
        <td>
          <a class="run-name" href={`#/runs/${r.run_id}`} onClick={(e) => { e.preventDefault(); navigate(`/runs/${r.run_id}`); }}>
            {r.name}
          </a>
        </td>
        <td>
          <span class={`status ${r.status}`}>
            {r.status === "running" && <span class="live-dot" />}
            {r.status}
          </span>
        </td>
        {displayCols.map((col) => (
          <td key={col} class="metric-val">{getCellValue(r, col)}</td>
        ))}
      </tr>
    );
  }

  return (
    <div class="container">
      <NavBar entity={entity} project={project} activeTab="table" />

      <div class="table-controls">
        <input
          type="text"
          placeholder="Search runs..."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
        <select
          class="control-btn"
          value={statusFilter}
          onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}
          style={{ cursor: "pointer" }}
        >
          <option value="all">All Status</option>
          <option value="running">Running</option>
          <option value="finished">Finished</option>
          <option value="failed">Failed</option>
        </select>

        <div class="popover-anchor">
          <button class={`control-btn ${groupBy ? "active" : ""}`} onClick={() => setGroupOpen(!groupOpen)}>
            {groupBy ? `Grouped: ${groupBy}` : "Group"}
          </button>
          {groupOpen && (
            <div class="popover">
              <div
                class="popover-item"
                onClick={() => { setGroupBy(null); setGroupOpen(false); }}
              >
                None
              </div>
              {allCols.map((col) => (
                <div
                  key={col}
                  class="popover-item"
                  onClick={() => { setGroupBy(col); setGroupOpen(false); }}
                >
                  {col}
                </div>
              ))}
            </div>
          )}
        </div>

        <ColumnSelector
          allColumns={allCols}
          visibleColumns={activeVisibleCols}
          onToggle={toggleCol}
        />

        <span style={{ color: "var(--text-dim)", fontSize: "13px", marginLeft: "auto" }}>
          {filtered.length} runs
        </span>
        <button class="control-btn" onClick={exportCsv} title="Export as CSV">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: "4px", verticalAlign: "-2px" }}>
            <path d="M2.75 14A1.75 1.75 0 011 12.25v-2.5a.75.75 0 011.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25v-2.5a.75.75 0 011.5 0v2.5A1.75 1.75 0 0113.25 14H2.75z"/>
            <path d="M7.25 7.689V2a.75.75 0 011.5 0v5.689l1.97-1.969a.749.749 0 111.06 1.06l-3.25 3.25a.749.749 0 01-1.06 0L4.22 6.78a.749.749 0 111.06-1.06l1.97 1.969z"/>
          </svg>
          Export CSV
        </button>
      </div>

      <table class="runs-table">
        <thead>
          <tr>
            <th onClick={() => toggleSort("name")}>Name{sortArrow("name")}</th>
            <th onClick={() => toggleSort("status")}>Status{sortArrow("status")}</th>
            {displayCols.map((col) => (
              <th key={col} onClick={() => toggleSort(col)}>{col}{sortArrow(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups
            ? groups.map((g) => (
                <>
                  <tr class="group-header" key={`g-${g.key}`}>
                    <td
                      colSpan={2 + displayCols.length}
                      onClick={() => toggleGroup(g.key)}
                    >
                      {collapsedGroups.has(g.key) ? "▶" : "▼"} {groupBy} = {g.key} ({g.runs.length})
                    </td>
                  </tr>
                  {!collapsedGroups.has(g.key) && g.runs.map(renderRow)}
                </>
              ))
            : sorted.map(renderRow)}
        </tbody>
      </table>
    </div>
  );
}
