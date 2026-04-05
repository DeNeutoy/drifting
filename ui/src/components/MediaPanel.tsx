import { useState, useEffect, useMemo } from "preact/hooks";
import { PlotlyChart } from "./PlotlyChart";
import { VegaChart } from "./VegaChart";
import type { MediaItem } from "../types";

interface MediaPanelProps {
  runId: string;
  media: MediaItem[];
}

function MediaCard({ runId, items }: { runId: string; items: MediaItem[] }) {
  const [idx, setIdx] = useState(items.length - 1);
  const item = items[idx];

  const isImage = item.media_type.startsWith("image/");
  const isPlotly = item.media_type === "application/vnd.plotly.v1+json";
  const isVega = item.media_type === "application/vnd.vegalite.v5+json";

  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    setSpec(null);
    if (!isPlotly && !isVega) return;
    fetch(`/api/runs/${runId}/media/${item.id}`)
      .then((r) => r.json())
      .then(setSpec)
      .catch(() => {});
  }, [runId, item.id, isPlotly, isVega]);

  const caption = (item.metadata as Record<string, unknown>)?.caption as string | undefined;
  const title = (item.metadata as Record<string, unknown>)?.title as string | undefined;

  const w = item.width ?? (isPlotly ? 500 : isVega ? 400 : undefined);

  return (
    <div class="media-card" style={w ? { width: w + 28 } : undefined}>
      <div class="media-card-header">
        <span class="media-card-step">step {item.step}</span>
        {(caption || title) && <span class="media-card-caption">{caption || title}</span>}
      </div>
      <div class="media-card-body">
        {isImage && (
          <img
            src={`/api/runs/${runId}/media/${item.id}`}
            alt={`${item.key} step ${item.step}`}
            loading="lazy"
            style={{
              ...(item.width ? { width: item.width, maxWidth: "100%" } : { maxWidth: "100%" }),
              ...(item.height ? { height: item.height } : {}),
            }}
          />
        )}
        {isPlotly && spec && <PlotlyChart spec={spec as { data?: unknown[]; layout?: Record<string, unknown> }} />}
        {isVega && spec && <VegaChart spec={spec} />}
        {!isImage && !isPlotly && !isVega && (
          <div style={{ padding: "16px", color: "var(--text-dim)" }}>
            <a href={`/api/runs/${runId}/media/${item.id}`} target="_blank" rel="noopener">
              Download ({item.media_type})
            </a>
          </div>
        )}
      </div>
      {items.length > 1 && (
        <div class="media-card-slider">
          <input
            type="range"
            min={0}
            max={items.length - 1}
            value={idx}
            onInput={(e) => setIdx(Number((e.target as HTMLInputElement).value))}
          />
          <span class="media-card-slider-label">
            {idx + 1} / {items.length}
          </span>
        </div>
      )}
    </div>
  );
}

export function MediaPanel({ runId, media }: MediaPanelProps) {
  const grouped = useMemo(() => {
    const groups: Record<string, MediaItem[]> = {};
    media.forEach((m) => {
      if (!groups[m.key]) groups[m.key] = [];
      groups[m.key].push(m);
    });
    return groups;
  }, [media]);

  if (media.length === 0) {
    return (
      <div style={{ padding: "40px", color: "var(--text-dim)", textAlign: "center" }}>
        No media logged for this run
      </div>
    );
  }

  return (
    <div>
      {Object.entries(grouped).map(([key, items]) => (
        <div key={key}>
          <div class="media-section-title">{key}</div>
          <div class="media-grid">
            <MediaCard key={key} runId={runId} items={items} />
          </div>
        </div>
      ))}
    </div>
  );
}
