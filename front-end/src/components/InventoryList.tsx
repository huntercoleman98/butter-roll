import { useDragReorder } from "../hooks/useDragReorder";
import InventoryRow, { type RowAction } from "./InventoryRow";
import type { GearItem } from "./character";

// A single flat, drag-reorderable inventory table (header + rows + "+ Add item").
// Used by the character sheet's Gear section. The party tab uses the sectioned
// variant (PartyInventorySections) instead, but both share InventoryRow.

interface Props {
  items: GearItem[];
  readOnly?: boolean;
  onChange: (id: string, patch: Partial<GearItem>) => void;
  onRemove: (id: string) => void;
  onReorder: (items: GearItem[]) => void;
  onAdd: () => void;
  action?: RowAction;
}

export default function InventoryList({
  items,
  readOnly = false,
  onChange,
  onRemove,
  onReorder,
  onAdd,
  action,
}: Props) {
  const drag = useDragReorder(items, onReorder);

  return (
    <>
      <div className="sheet-list">
        <div className="sheet-gear-head">
          <span />
          <span />
          <span>Item</span>
          <span>Qty</span>
          <span>Slots</span>
          <span />
        </div>
        {items.map((g, i) => (
          <InventoryRow
            key={g.id}
            item={g}
            readOnly={readOnly}
            onChange={onChange}
            onRemove={onRemove}
            action={action}
            className={
              (drag.draggingIndex === i ? "is-dragging" : "") +
              (drag.overIndex === i ? " is-drop-target" : "")
            }
            rowProps={drag.rowProps()}
            handleProps={drag.handleProps(i)}
          />
        ))}
      </div>
      {!readOnly && (
        <button className="sheet-add" onClick={onAdd}>
          + Add item
        </button>
      )}
    </>
  );
}
