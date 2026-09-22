import { type RefObject, useState } from "react";
import { GiOpenFolder, GiFullFolder, GiPlainArrow } from "react-icons/gi";
import { MdDragIndicator } from "react-icons/md";
import InventoryRow, { type RowAction } from "./InventoryRow";
import { useDragReorder } from "../hooks/useDragReorder";
import { usePartyItemDrag } from "../hooks/usePartyItemDrag";
import type { PartyInvItem, PartySection } from "../hooks/useGameSocket";

// The sectioned party inventory, styled as a folder tree to match the DM's
// token/map library (same twisty + folder-icon idiom). Unsorted items sit loose
// at the top; each section is a collapsible folder that items drag into (via
// usePartyItemDrag) and that reorders among its peers (via useDragReorder).

interface Props {
  items: PartyInvItem[];
  sections: PartySection[];
  scrollRef: RefObject<HTMLElement | null>;
  onChange: (id: string, patch: Partial<PartyInvItem>) => void;
  onRemove: (id: string) => void;
  onReorder: (items: PartyInvItem[]) => void;
  onAdd: (sectionId?: string) => void;
  moveItemToSection: (itemId: string, sectionId: string) => void;
  onTake: (item: PartyInvItem) => void;
  addSection: (name: string) => void;
  renameSection: (id: string, name: string) => void;
  removeSection: (id: string) => void;
  reorderSections: (sections: PartySection[]) => void;
}

const slotsOf = (items: PartyInvItem[]) =>
  items.reduce((sum, it) => sum + (it.qty || 0) * (it.slotsEach || 0), 0);

export default function PartyInventorySections(props: Props) {
  const { items, sections, scrollRef, onChange, onRemove, onAdd } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const itemDrag = usePartyItemDrag({
    items,
    scrollRef,
    moveItemToSection: props.moveItemToSection,
    onReorder: props.onReorder,
  });
  const sectionDrag = useDragReorder(sections, props.reorderSections);

  const takeAction: RowAction = {
    icon: <GiPlainArrow />,
    title: "Take from party inventory",
    className: "sheet-take-party",
    onClick: (it) => props.onTake(it as PartyInvItem),
  };

  const groupItems = (sectionId: string) =>
    items.filter((it) => it.sectionId === sectionId);

  return (
    <>
      <div className="party-add-row">
        <button className="sheet-add" onClick={() => onAdd("")}>
          + Add item
        </button>
        <button
          className="sheet-add"
          onClick={() => props.addSection("New section")}
        >
          + Add section
        </button>
      </div>
      {/* One column header for everything. Qty/Slots/× are right-anchored, so it
          lines up with both flush and folder-indented rows. */}
      <div className="sheet-gear-head">
        <span />
        <span />
        <span>Item</span>
        <span>Qty</span>
        <span>Slots</span>
        <span />
      </div>
      <Group
        items={groupItems("")}
        sectionId=""
        itemDrag={itemDrag}
        takeAction={takeAction}
        onChange={onChange}
        onRemove={onRemove}
      />
      {sections.map((sec, i) => (
        <Group
          key={sec.id}
          section={sec}
          items={groupItems(sec.id)}
          sectionId={sec.id}
          itemDrag={itemDrag}
          takeAction={takeAction}
          onChange={onChange}
          onRemove={onRemove}
          open={!collapsed.has(sec.id)}
          onToggle={() => toggle(sec.id)}
          sectionHandleProps={sectionDrag.handleProps(i)}
          reordering={sectionDrag.draggingIndex === i}
          reorderTarget={sectionDrag.overIndex === i}
          onRename={props.renameSection}
          onRemoveSection={props.removeSection}
        />
      ))}
    </>
  );
}

interface GroupProps {
  section?: PartySection; // absent = Unsorted
  sectionId: string;
  items: PartyInvItem[];
  itemDrag: ReturnType<typeof usePartyItemDrag>;
  takeAction: RowAction;
  onChange: (id: string, patch: Partial<PartyInvItem>) => void;
  onRemove: (id: string) => void;
  open?: boolean;
  onToggle?: () => void;
  sectionHandleProps?: Record<string, unknown>;
  reordering?: boolean;
  reorderTarget?: boolean;
  onRename?: (id: string, name: string) => void;
  onRemoveSection?: (id: string) => void;
}

function Group({
  section,
  sectionId,
  items,
  itemDrag,
  takeAction,
  onChange,
  onRemove,
  open = true,
  onToggle,
  sectionHandleProps,
  reordering,
  reorderTarget,
  onRename,
  onRemoveSection,
}: GroupProps) {
  const drop = itemDrag.drop;
  const dropInto = drop?.sectionId === sectionId && drop?.beforeId === null;

  return (
    <div
      className={
        "party-section" +
        (reordering ? " is-dragging" : "") +
        (reorderTarget ? " is-drop-target" : "") +
        (dropInto ? " is-drop-into" : "")
      }
      // data-reorder-row makes real sections draggable among each other; the
      // dropzone attrs let usePartyItemDrag target this section for item drops.
      {...(section ? { "data-reorder-row": "" } : {})}
      data-section-dropzone=""
      data-section-id={sectionId}
    >
      {section && (
        <div className="token-lib-folder party-folder" onClick={onToggle}>
          <span
            className="sheet-drag-handle"
            title="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
            {...sectionHandleProps}
          >
            <MdDragIndicator />
          </span>
          <span className="token-lib-twisty" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="token-lib-folder-icon">
            {open ? <GiOpenFolder /> : <GiFullFolder />}
          </span>
          <input
            className="party-section-name"
            value={section.name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onRename?.(section.id, e.target.value)}
          />
          <span className="party-section-slots">{slotsOf(items)} slots</span>
          <button
            className="sheet-remove"
            title="Remove section (items move to Unsorted)"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveSection?.(section.id);
            }}
          >
            ×
          </button>
        </div>
      )}

      {open && (
        <div className={section ? "party-section-items sheet-list" : "sheet-list"}>
          {items.map((it) => (
            <InventoryRow
              key={it.id}
              item={it}
              onChange={onChange}
              onRemove={onRemove}
              action={takeAction}
              className={
                (itemDrag.draggingId === it.id ? "is-dragging" : "") +
                (drop?.beforeId === it.id ? " is-drop-target" : "")
              }
              rowProps={itemDrag.rowProps(it)}
              handleProps={itemDrag.handleProps(it.id)}
            />
          ))}
          {/* An empty group is zero-height and can't be dropped onto (folders
              have their header as a target; Unsorted has none). While a drag is
              in progress, show a hittable drop zone so items can be pulled out
              into an empty group. */}
          {itemDrag.draggingId && items.length === 0 && (
            <div className="party-drop-empty">
              {section ? "Drop here" : "Drop here to unsort"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
