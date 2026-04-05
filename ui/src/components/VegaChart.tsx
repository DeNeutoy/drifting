import { useEffect, useRef, useState } from "preact/hooks";

declare global {
  interface Window {
    vegaEmbed?: (el: HTMLElement, spec: unknown, opts?: unknown) => Promise<unknown>;
  }
}

const CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/vega@5/build/vega.min.js",
  "https://cdn.jsdelivr.net/npm/vega-lite@5/build/vega-lite.min.js",
  "https://cdn.jsdelivr.net/npm/vega-embed@6/build/vega-embed.min.js",
];
let loadPromise: Promise<void> | null = null;

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(script);
  });
}

function loadVega(): Promise<void> {
  if (window.vegaEmbed) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    for (const url of CDN_URLS) {
      await loadScript(url);
    }
  })();
  return loadPromise;
}

interface VegaChartProps {
  spec: Record<string, unknown>;
}

export function VegaChart({ spec }: VegaChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(!!window.vegaEmbed);

  useEffect(() => {
    let cancelled = false;
    loadVega()
      .then(() => { if (!cancelled) setReady(true); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !el.current || !window.vegaEmbed) return;
    const darkSpec = {
      ...spec,
      config: {
        ...(spec.config as Record<string, unknown> || {}),
        background: "transparent",
        axis: { labelColor: "#c9d1d9", titleColor: "#c9d1d9", gridColor: "#30363d" },
        legend: { labelColor: "#c9d1d9", titleColor: "#c9d1d9" },
        title: { color: "#c9d1d9" },
      },
    };
    window.vegaEmbed(el.current, darkSpec, { actions: false, renderer: "svg" });
  }, [ready, spec]);

  if (error) return <div style={{ color: "var(--text-dim)", padding: "12px" }}>Error: {error}</div>;
  if (!ready) return <div style={{ color: "var(--text-dim)", padding: "12px" }}>Loading Vega...</div>;
  return <div ref={el} />;
}
