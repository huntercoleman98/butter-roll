import { type ReactNode } from "react";
import { MdDragIndicator } from "react-icons/md";
import type { GearItem } from "./character";

// One gear/inventory row: drag handle, an optional action button, and the
// name/qty/slots inputs with a remove button. Drag-system-agnostic — the caller
// supplies `rowProps`/`handleProps` (spread onto the row and the handle) and a
// `className` for drag/drop styling — so it's shared by InventoryList's
// single-list reorder (character sheet) and the party tab's cross-section drag.

function num(value: string, fallback = 0): number {
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

function fnum(value: string, fallback = 0): number {
  const n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}

export interface RowAction {
  icon: ReactNode;
  title: string;
  className: string;
  onClick: (item: GearItem) => void;
}

interface Props {
  item: GearItem;
  readOnly?: boolean;
  onChange: (id: string, patch: Partial<GearItem>) => void;
  onRemove: (id: string) => void;
  action?: RowAction;
  // Extra classes for the row (drag/drop-target state).
  className?: string;
  // Spread onto the row element (e.g. data-* attrs the drag hook hit-tests).
  rowProps?: Record<string, unknown>;
  // Spread onto the drag-handle span (the pointer handlers).
  handleProps?: Record<string, unknown>;
}

export default function InventoryRow({
  item: g,
  readOnly = false,
  onChange,
  onRemove,
  action,
  className,
  rowProps,
  handleProps,
}: Props) {
  return (
    <div
      className={"sheet-gear-row" + (className ? " " + className : "")}
      {...rowProps}
    >
      {readOnly ? (
        <span />
      ) : (
        <span
          className="sheet-drag-handle"
          title="Drag to move"
          {...handleProps}
        >
          <MdDragIndicator />
        </span>
      )}
      {action && !readOnly ? (
        <button
          className={action.className}
          title={action.title}
          onClick={() => action.onClick(g)}
        >
          {action.icon}
        </button>
      ) : (
        <span />
      )}
      <input
        type="text"
        disabled={readOnly}
        value={g.name}
        onChange={(e) => onChange(g.id, { name: e.target.value })}
      />
      <input
        className="sheet-gear-num"
        type="number"
        min={0}
        disabled={readOnly}
        value={g.qty}
        onChange={(e) => onChange(g.id, { qty: num(e.target.value) })}
      />
      <input
        className="sheet-gear-num"
        type="number"
        min={0}
        step={0.01}
        disabled={readOnly}
        value={g.slotsEach}
        onChange={(e) => onChange(g.id, { slotsEach: fnum(e.target.value) })}
      />
      {!readOnly && (
        <button
          className="sheet-remove"
          title="Remove"
          onClick={() => onRemove(g.id)}
        >
          ×
        </button>
      )}
    </div>
  );
}
