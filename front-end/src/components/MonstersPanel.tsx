import { useState } from "react";
import { filterMonsters, type Monster } from "../types/monster";
import MonsterStatBlock from "./MonsterStatBlock";

interface Props {
  monsters: Monster[];
  onRoll: (expression: string, label?: string) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

export default function MonstersPanel({
  monsters,
  onRoll,
  onClose,
  zIndex = 150,
  onFocus,
}: Props) {
  const [pos, setPos] = useState(() => ({ x: window.innerWidth - 500, y: 60 }));
  const [filter, setFilter] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const selected = monsters.find((m) => m.name === selectedName) ?? null;
  const filtered = filterMonsters(monsters, filter);

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

  return (
    <div
      className="window monsters-window"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex }}
      onMouseDown={onFocus}
    >
      <div
        className="title-bar"
        style={{ cursor: "move" }}
        onMouseDown={handleTitleBarDrag}
      >
        <div className="title-bar-text">Monsters</div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body monsters-body">
        {selected ? (
          <>
            <div className="monsters-detail-header">
              <button onClick={() => setSelectedName(null)}>← Back</button>
              <strong>{selected.name}</strong>
            </div>
            <div className="monsters-scroll">
              <MonsterStatBlock monster={selected} onRoll={onRoll} />
            </div>
          </>
        ) : (
          <>
            <input
              type="text"
              className="monsters-filter"
              placeholder="Filter by name or level…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="monsters-scroll">
              {monsters.length === 0 ? (
                <div className="monsters-empty">
                  No monsters found — add one-monster JSON files to
                  back-end/assets/monsters/.
                </div>
              ) : filtered.length === 0 ? (
                <div className="monsters-empty">No matches.</div>
              ) : (
                filtered.map((m) => (
                  <div
                    key={m.name}
                    className="monsters-row"
                    onClick={() => setSelectedName(m.name)}
                  >
                    <span className="monsters-row-name">{m.name}</span>
                    <span className="monsters-row-level">LV {m.level}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
