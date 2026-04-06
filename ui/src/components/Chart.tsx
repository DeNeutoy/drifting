import { useEffect, useRef, useMemo } from "preact/hooks";
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
  onHide?: () => void;
  titleHighlight?: RegExp | null;
  timeAxis?: boolean;
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

export function Chart({ title, series, width, syncKey, seriesLinks, seriesColors, highlightedLabel, onHighlight, onHide, titleHighlight, timeAxis }: ChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  const seriesColorsRef = useRef(seriesColors);
  seriesColorsRef.current = seriesColors;

  const colorForIndex = (i: number, label?: string) => {
    if (label && seriesColorsRef.current?.[label]) return seriesColorsRef.current[label];
    return COLORS[i % COLORS.length];
  };

  // Stable key that changes only when the series structure or colors change
  const seriesKey = useMemo(() => {
    return series.slice(1).map((s) => {
      const color = s.label && seriesColors?.[s.label] || "";
      return (s.label || "") + ":" + color;
    }).join("\0");
  }, [series, seriesColors]);

  // Create / recreate uPlot only when structure changes
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
      scales: { x: { time: !!timeAxis } },
      axes: [
        {
          stroke: "#8b949e",
          grid: { stroke: "rgba(48,54,61,0.6)", width: 1 },
          font: "11px -apple-system, sans-serif",
          ticks: { stroke: "rgba(48,54,61,0.6)" },
          ...(!timeAxis ? { label: "step", labelFont: "11px -apple-system, sans-serif", labelSize: 20 } : {}),
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
          spanGaps: !!timeAxis,
        })),
      ],
    };

    if (chartRef.current) chartRef.current.destroy();
    const alignedData = series.map((s) => s.data) as uPlot.AlignedData;
    chartRef.current = new uPlot(opts, alignedData, el.current);

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [seriesKey, width, syncKey, timeAxis]);

  // Update data in-place when values change without recreating the chart
  useEffect(() => {
    const u = chartRef.current;
    if (!u || !series || series.length < 2) return;
    const alignedData = series.map((s) => s.data) as uPlot.AlignedData;
    u.setData(alignedData, false);
  }, [series]);

  // Resize chart when container width changes (layout switch, window resize)
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const ro = new ResizeObserver(() => {
      const u = chartRef.current;
      if (!u) return;
      const newWidth = card.clientWidth - 32;
      if (Math.abs(u.width - newWidth) > 1) {
        u.setSize({ width: newWidth, height: u.height });
      }
    });
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const u = chartRef.current;
    if (!u || series.length < 2) return;

    if (!highlightedLabel) {
      u.setSeries(null as unknown as number, { focus: true });
      return;
    }

    const idx = series.findIndex((s, i) => i > 0 && s.label === highlightedLabel);
    if (idx > 0) {
      u.setSeries(idx, { focus: true });
    }
  }, [highlightedLabel, series]);

  const linkMap = new Map<string, string>();
  seriesLinks?.forEach((sl) => linkMap.set(sl.label, sl.href));

  return (
    <div class="chart-card" ref={cardRef}>
      <h3>
        <span>{renderHighlightedTitle(title, titleHighlight)}</span>
        {onHide && (
          <button class="chart-hide-btn" onClick={onHide} title="Hide panel">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
            </svg>
          </button>
        )}
      </h3>
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
