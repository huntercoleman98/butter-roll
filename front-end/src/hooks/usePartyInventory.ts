import { uuid } from "../utils/uuid";
import type {
  OutgoingPayload,
  PartyInvItem,
  PartySection,
} from "./useGameSocket";
import type { Character, GearItem } from "../components/character";

// Emitters for the shared party inventory. CRUD ops map straight to the granular
// party_item_* / party_section_* wire messages (the server holds the
// authoritative lists and rebroadcasts each). Send/take move one unit at a time
// between a character's gear and the party list, decrementing the source
// (dropping it at zero) and merging into an existing same-named item on the
// destination. Kept out of Player.tsx to hold that page component thin.

interface Args {
  partyInventory: PartyInvItem[];
  send: (payload: OutgoingPayload) => void;
  character: Character;
  onCharacterChange: (patch: Partial<Character>) => void;
}

// Find an item to merge into by (trimmed, non-empty) name, so distinct blank
// rows never collapse together.
function mergeTarget<T extends { name: string }>(
  items: T[],
  name: string,
): T | undefined {
  const key = name.trim();
  return key ? items.find((it) => it.name.trim() === key) : undefined;
}

export function usePartyInventory({
  partyInventory,
  send,
  character,
  onCharacterChange,
}: Args) {
  // ── Items ──────────────────────────────────────────────────────
  function onAdd(sectionId = "") {
    send({
      case: "partyItemAdd",
      value: { item: { id: uuid(), name: "", qty: 1, slotsEach: 1, sectionId } },
    });
  }

  function onChange(id: string, patch: Partial<PartyInvItem>) {
    send({ case: "partyItemUpdate", value: { id, ...patch } });
  }

  function onRemove(id: string) {
    send({ case: "partyItemRemove", value: { id } });
  }

  function onReorder(items: PartyInvItem[]) {
    send({ case: "partyItemReorder", value: { ids: items.map((it) => it.id) } });
  }

  function moveItemToSection(itemId: string, sectionId: string) {
    onChange(itemId, { sectionId });
  }

  // One unit from my gear → the party list (always lands unsorted).
  function onSendToParty(item: GearItem) {
    const gear =
      item.qty > 1
        ? character.gear.map((g) =>
            g.id === item.id ? { ...g, qty: g.qty - 1 } : g,
          )
        : character.gear.filter((g) => g.id !== item.id);
    onCharacterChange({ gear });

    // Merge only into an unsorted same-named item, so sending never silently
    // drops a unit into a section.
    const unsorted = partyInventory.filter((it) => it.sectionId === "");
    const existing = mergeTarget(unsorted, item.name);
    if (existing) {
      onChange(existing.id, { qty: existing.qty + 1 });
    } else {
      send({
        case: "partyItemAdd",
        value: {
          item: {
            id: uuid(),
            name: item.name,
            qty: 1,
            slotsEach: item.slotsEach,
            sectionId: "",
          },
        },
      });
    }
  }

  // One unit from the party list → my gear (the mirror of onSendToParty).
  function onTake(item: GearItem) {
    if (item.qty > 1) {
      onChange(item.id, { qty: item.qty - 1 });
    } else {
      onRemove(item.id);
    }

    const existing = mergeTarget(character.gear, item.name);
    const gear = existing
      ? character.gear.map((g) =>
          g.id === existing.id ? { ...g, qty: g.qty + 1 } : g,
        )
      : [
          ...character.gear,
          { id: uuid(), name: item.name, qty: 1, slotsEach: item.slotsEach },
        ];
    onCharacterChange({ gear });
  }

  // ── Sections ───────────────────────────────────────────────────
  function addSection(name: string) {
    send({
      case: "partySectionAdd",
      value: { section: { id: uuid(), name } },
    });
  }

  function renameSection(id: string, name: string) {
    send({ case: "partySectionRename", value: { id, name } });
  }

  function removeSection(id: string) {
    send({ case: "partySectionRemove", value: { id } });
  }

  function reorderSections(sections: PartySection[]) {
    send({
      case: "partySectionReorder",
      value: { ids: sections.map((sec) => sec.id) },
    });
  }

  return {
    items: partyInventory,
    onAdd,
    onChange,
    onRemove,
    onReorder,
    moveItemToSection,
    onSendToParty,
    onTake,
    addSection,
    renameSection,
    removeSection,
    reorderSections,
  };
}
