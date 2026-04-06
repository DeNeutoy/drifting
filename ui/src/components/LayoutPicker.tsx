import { useState, useRef, useEffect } from "preact/hooks";

export interface ChartLayout {
  cols: number;
  rows: number;
}

interface LayoutPickerProps {
  value: ChartLayout;
  onChange: (layout: ChartLayout) => void;
  compact?: boolean;
}

const MAX_COLS = 3;
const MAX_ROWS = 2;

export function LayoutPicker({ value, onChange, compact }: LayoutPickerProps) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<ChartLayout | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const preview = hover || value;

  return (
    <div class="popover-anchor" ref={ref}>
      <button
        class={`control-btn layout-picker-btn${compact ? " layout-picker-btn-compact" : ""}`}
        onClick={() => setOpen(!open)}
        title="Chart layout"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 2.5A1.5 1.5 0 012.5 1h3A1.5 1.5 0 017 2.5v3A1.5 1.5 0 015.5 7h-3A1.5 1.5 0 011 5.5v-3zm8 0A1.5 1.5 0 0110.5 1h3A1.5 1.5 0 0115 2.5v3A1.5 1.5 0 0113.5 7h-3A1.5 1.5 0 019 5.5v-3zm-8 8A1.5 1.5 0 012.5 9h3A1.5 1.5 0 017 10.5v3A1.5 1.5 0 015.5 15h-3A1.5 1.5 0 011 13.5v-3zm8 0A1.5 1.5 0 0110.5 9h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 019 13.5v-3z"/>
        </svg>
        {!compact && <span>{value.cols}x{value.rows}</span>}
      </button>
      {open && (
        <div class="popover layout-picker-popover">
          <div class="layout-picker-label">{preview.cols} x {preview.rows}</div>
          <div
            class="layout-picker-grid"
            onMouseLeave={() => setHover(null)}
          >
            {Array.from({ length: MAX_ROWS }, (_, r) =>
              Array.from({ length: MAX_COLS }, (_, c) => {
                const col = c + 1;
                const row = r + 1;
                const active = col <= preview.cols && row <= preview.rows;
                return (
                  <div
                    key={`${c}-${r}`}
                    class={`layout-picker-cell${active ? " active" : ""}`}
                    onMouseEnter={() => setHover({ cols: col, rows: row })}
                    onClick={() => { onChange({ cols: col, rows: row }); setOpen(false); }}
                  />
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
