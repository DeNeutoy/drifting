import { useEffect, useRef, useState } from "preact/hooks";

declare global {
  interface Window {
    Plotly?: {
      newPlot: (el: HTMLElement, data: unknown[], layout?: unknown, config?: unknown) => void;
    };
  }
}

const CDN_URL = "https://cdn.plot.ly/plotly-2.35.2.min.js";
let loadPromise: Promise<void> | null = null;

function loadPlotly(): Promise<void> {
  if (window.Plotly) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CDN_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Plotly"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

interface PlotlyChartProps {
  spec: { data?: unknown[]; layout?: Record<string, unknown> };
}

export function PlotlyChart({ spec }: PlotlyChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(!!window.Plotly);

  useEffect(() => {
    let cancelled = false;
    loadPlotly()
      .then(() => { if (!cancelled) setReady(true); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !el.current || !window.Plotly) return;
    const layout = {
      ...(spec.layout || {}),
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { color: "#c9d1d9" },
      margin: { t: 40, r: 20, b: 40, l: 50 },
    };
    window.Plotly.newPlot(el.current, spec.data || [], layout, {
      responsive: true,
      displayModeBar: false,
    });
  }, [ready, spec]);

  if (error) return <div style={{ color: "var(--text-dim)", padding: "12px" }}>Error: {error}</div>;
  if (!ready) return <div style={{ color: "var(--text-dim)", padding: "12px" }}>Loading Plotly...</div>;
  return <div ref={el} />;
}
