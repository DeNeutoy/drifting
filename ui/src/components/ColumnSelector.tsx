import { useState, useEffect, useRef } from "preact/hooks";

interface ColumnSelectorProps {
  allColumns: string[];
  visibleColumns: Set<string>;
  onToggle: (col: string) => void;
}

export function ColumnSelector({ allColumns, visibleColumns, onToggle }: ColumnSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div class="popover-anchor" ref={ref}>
      <button class={`control-btn ${open ? "active" : ""}`} onClick={() => setOpen(!open)}>
        Columns
      </button>
      {open && (
        <div class="popover">
          {allColumns.map((col) => (
            <label class="popover-item" key={col}>
              <input
                type="checkbox"
                checked={visibleColumns.has(col)}
                onChange={() => onToggle(col)}
              />
              {col}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
