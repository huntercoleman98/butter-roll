import { useEffect, useRef, useState, memo } from "react";

const ValueInput = memo(function ValueInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));

  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setLocal(String(value));
  }

  return (
    <input
      type="number"
      className="initiative-value"
      value={local}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = Number(local);
        if (!isNaN(n)) onChange(n);
        else setLocal(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
});

export interface InitiativeEntry {
  entryId: string;
  tokenId: string;
  name: string;
  url: string;
  value: number;
}

interface Props {
  entries: InitiativeEntry[];
  currentId: string | null;
  onCurrentChange: (id: string | null) => void;
  onValueChange: (entryId: string, value: number) => void;
  onRemove: (entryId: string) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
  focusView: boolean;
  onFocusViewChange: (on: boolean) => void;
}

export default function InitiativePanel({
  entries,
  currentId,
  onCurrentChange,
  onValueChange,
  onRemove,
  onClose,
  zIndex = 150,
  onFocus,
  focusView,
  onFocusViewChange,
}: Props) {
  const [pos, setPos] = useState(() => ({ x: window.innerWidth - 260, y: 120 }));
  const activeRowRef = useRef<HTMLDivElement>(null);

  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const currentDisplayIndex = sorted.findIndex((e) => e.entryId === currentId);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentId]);

  function handleTitleBarDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const startX = e.clientX - pos.x;
    const startY = e.clientY - pos.y;
    function onMouseMove(ev: MouseEvent) {
      setPos({ x: ev.clientX - startX, y: ev.clientY - startY });
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function step(dir: 1 | -1) {
    const count = sorted.length;
    if (count === 0) return;
    const next =
      currentDisplayIndex === -1
        ? dir === 1 ? 0 : count - 1
        : ((currentDisplayIndex + dir) + count) % count;
    onCurrentChange(sorted[next].entryId);
  }

  return (
    <div
      className="window initiative-window"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex }}
      onMouseDown={onFocus}
    >
      <div
        className="title-bar"
        style={{ cursor: "move" }}
        onMouseDown={handleTitleBarDrag}
      >
        <div className="title-bar-text">Initiative</div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body initiative-body">
        <div className="initiative-focus-row">
          <input
            type="checkbox"
            id="init-focus-view"
            checked={focusView}
            onChange={(e) => onFocusViewChange(e.target.checked)}
          />
          <label htmlFor="init-focus-view" style={{ cursor: "pointer" }}>
            Focus view
          </label>
          <button
            className="initiative-clear"
            onClick={() => onCurrentChange(null)}
            disabled={currentId === null}
          >
            Clear initiative
          </button>
        </div>
        <div className="initiative-table">
          {sorted.length === 0 ? (
            <div className="initiative-empty">
              Right-click a token to add it.
            </div>
          ) : (
            sorted.map((entry) => {
              const isActive = entry.entryId === currentId;
              return (
                <div
                  key={entry.entryId}
                  ref={isActive ? activeRowRef : null}
                  className={`initiative-row${isActive ? " initiative-row-active" : ""}`}
                  onClick={() => onCurrentChange(entry.entryId)}
                >
                  <ValueInput
                    value={entry.value}
                    onChange={(v) => onValueChange(entry.entryId, v)}
                  />
                  <div className="initiative-icon">
                    <img src={entry.url} alt="" />
                  </div>
                  <div className="initiative-name">{entry.name || "—"}</div>
                  <button
                    className="icon-btn initiative-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(entry.entryId);
                    }}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="initiative-footer">
          <button onClick={() => step(-1)} disabled={sorted.length === 0}>▲</button>
          <button onClick={() => step(1)} disabled={sorted.length === 0}>▼</button>
        </div>
      </div>
    </div>
  );
}
