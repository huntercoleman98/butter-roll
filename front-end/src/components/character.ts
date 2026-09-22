// The character-sheet data model, shared by the editable sheet (CharacterSheet),
// the player page, and the DM's read-only view. Kept in a plain module so it can
// export non-component values without tripping react-refresh.

export const ABILITY_NAMES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type AbilityName = (typeof ABILITY_NAMES)[number];

export interface Attack {
  id: string;
  name: string;
  range: string;
  bonus: number;
  damage: string;
}

export interface Talent {
  id: string;
  text: string;
}

export interface Spell {
  id: string;
  name: string;
  tier: number;
  duration: string;
  ready: boolean;
}

export interface GearItem {
  id: string;
  name: string;
  qty: number;
  slotsEach: number;
}

export interface Character {
  ancestry: string;
  className: string;
  level: number;
  title: string;
  alignment: string;
  background: string;
  deity: string;
  xp: number;
  abilities: Record<AbilityName, number>;
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
  // Count of luck tokens the player currently holds (0 to many), spent during play.
  luck: number;
  attacks: Attack[];
  talents: Talent[];
  // Player-controlled toggle (see the /player settings screen). When false, the
  // Spells section is hidden from the sheet — for non-casters who don't want the
  // clutter. Defaults true so existing casters keep their spell list.
  spellcastingEnabled: boolean;
  spellcastingAbility: AbilityName | "";
  spells: Spell[];
  gear: GearItem[];
  gp: number;
  sp: number;
  cp: number;
  languages: string;
  // Free-form player notes (markdown), edited in the Notes tab. Rides along in
  // the sheet blob so it persists and survives restarts via the same sync path;
  // not rendered on the DM's read-only sheet, so it stays a player scratchpad.
  notes: string;
}

// Pick black or white text for a #rrggbb background so a label stays legible
// whatever color the player chose. Uses perceived (sRGB-weighted) luminance.
// Shared by the accented character sheet and the party tab.
export function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000" : "#fff";
}

// A blank character. Abilities default to 10 (neutral) and the level to 1;
// everything else starts empty.
export function emptyCharacter(): Character {
  return {
    ancestry: "",
    className: "",
    level: 1,
    title: "",
    alignment: "",
    background: "",
    deity: "",
    xp: 0,
    abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    hp: 0,
    maxHp: 0,
    tempHp: 0,
    ac: 0,
    luck: 0,
    attacks: [],
    talents: [],
    spellcastingEnabled: true,
    spellcastingAbility: "",
    spells: [],
    gear: [],
    gp: 0,
    sp: 0,
    cp: 0,
    languages: "",
    notes: "",
  };
}

// normalizeCharacter merges a parsed (possibly partial or legacy) object onto a
// blank character, so missing keys get defaults and old gear ({ slots }) is
// migrated to { qty, slotsEach }. Used when loading from localStorage or a
// backend blob.
export function normalizeCharacter(parsed: unknown): Character {
  const merged = { ...emptyCharacter(), ...(parsed as Partial<Character>) };
  merged.gear = (merged.gear ?? []).map((g) => {
    const legacy = g as GearItem & { slots?: number };
    return legacy.slotsEach === undefined
      ? { id: g.id, name: g.name, qty: 1, slotsEach: legacy.slots ?? 1 }
      : g;
  });
  return merged;
}
