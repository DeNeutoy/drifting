import { useEffect, useRef } from "preact/hooks";
import uPlot from "uplot";
import { COLORS } from "../constants";

export interface ChartSeries {
  label?: string;
  data: number[] | Float64Array;
}

export interface SeriesLink {
  label: string;
  href: string;
  runId: string;
}

interface ChartProps {
  title: string;
  series: ChartSeries[];
  width?: number;
  syncKey?: string;
  seriesLinks?: SeriesLink[];
  seriesColors?: Record<string, string>;
  highlightedLabel?: string | null;
  onHighlight?: (label: string | null) => void;
  titleHighlight?: RegExp | null;
}

function renderHighlightedTitle(title: string, regex: RegExp | null | undefined) {
  if (!regex) return title;
  const match = title.match(regex);
  if (!match || match.index === undefined) return title;
  const before = title.slice(0, match.index);
  const matched = match[0];
  const after = title.slice(match.index + matched.length);
  return <>{before}<mark class="metric-match">{matched}</mark>{after}</>;
}

export function Chart({ title, series, width, syncKey, seriesLinks, seriesColors, highlightedLabel, onHighlight, titleHighlight }: ChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  const colorForIndex = (i: number, label?: string) => {
    if (label && seriesColors?.[label]) return seriesColors[label];
    return COLORS[i % COLORS.length];
  };

  useEffect(() => {
    if (!el.current || !series || series.length < 2) return;

    const opts: uPlot.Options = {
      width: width || el.current.parentElement!.clientWidth - 32,
      height: 220,
      legend: { show: false },
      cursor: {
        drag: { x: true, y: false },
        focus: { prox: 1e6 },
        ...(syncKey ? { sync: { key: syncKey } } : {}),
      },
      focus: { alpha: 0.3 },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: "#8b949e",
          grid: { stroke: "rgba(48,54,61,0.6)", width: 1 },
          font: "11px -apple-system, sans-serif",
          ticks: { stroke: "rgba(48,54,61,0.6)" },
          label: "step",
          labelFont: "11px -apple-system, sans-serif",
          labelSize: 20,
        },
        {
          stroke: "#8b949e",
          grid: { stroke: "rgba(48,54,61,0.6)", width: 1 },
          font: "11px -apple-system, sans-serif",
          ticks: { stroke: "rgba(48,54,61,0.6)" },
          size: 60,
        },
      ],
      series: [
        {},
        ...series.slice(1).map((s, i) => ({
          label: s.label || "",
          stroke: colorForIndex(i, s.label),
          width: 1.5,
        })),
      ],
    };

    if (chartRef.current) chartRef.current.destroy();
    const alignedData = series.map((s) => s.data) as uPlot.AlignedData;
    chartRef.current = new uPlot(opts, alignedData, el.current);

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [series, width, syncKey, seriesColors]);

  // Apply focus when highlightedLabel changes
  useEffect(() => {
    const u = chartRef.current;
    if (!u || series.length < 2) return;

    if (!highlightedLabel) {
      // Reset: unfocus all (restore full opacity)
      u.setSeries(null as unknown as number, { focus: true });
      return;
    }

    // Find the 1-based series index matching the label
    const idx = series.findIndex((s, i) => i > 0 && s.label === highlightedLabel);
    if (idx > 0) {
      u.setSeries(idx, { focus: true });
    }
  }, [highlightedLabel, series]);

  const linkMap = new Map<string, string>();
  seriesLinks?.forEach((sl) => linkMap.set(sl.label, sl.href));

  return (
    <div class="chart-card">
      <h3>{renderHighlightedTitle(title, titleHighlight)}</h3>
      <div ref={el} />
      {series.length > 1 && (
        <div class="chart-legend">
          {series.slice(1).map((s, i) => {
            const color = colorForIndex(i, s.label);
            const href = s.label ? linkMap.get(s.label) : undefined;
            const dimmed = highlightedLabel && s.label !== highlightedLabel;
            return (
              <span
                class={`chart-legend-item ${dimmed ? "dimmed" : ""}`}
                key={i}
                onMouseEnter={() => onHighlight?.(s.label ?? null)}
                onMouseLeave={() => onHighlight?.(null)}
              >
                <span class="chart-legend-swatch" style={{ background: color }} />
                {href ? (
                  <a href={href} class="chart-legend-label">{s.label}</a>
                ) : (
                  <span class="chart-legend-label">{s.label}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
