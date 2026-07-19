// Mirrors the schema of the JSON files in back-end/assets/monsters/
// (one monster per file, served aggregated by GET /api/monsters).

export interface Monster {
  name: string;
  type: "monster";
  ac: string;
  hp: string;
  movement: string;
  level: number;
  stats: MonsterStats;
  alignment: "Lawful" | "Neutral" | "Chaotic";
  attacks: MonsterAttack[];
  abilities: MonsterAbility[] | null;
}

export interface MonsterAttack {
  name: string;
  perRound: number;
  range: string | null;
  toHit: number | null;
  /** Free text; [NdN] notation renders as roll buttons, e.g. "[1d8] + curse". */
  damage: string | null;
}

export interface MonsterAbility {
  name: string;
  description: string;
}

export interface MonsterStats {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

/** Filter by name substring (case-insensitive) or exact level number. */
export function filterMonsters(monsters: Monster[], filter: string): Monster[] {
  const f = filter.trim().toLowerCase();
  if (!f) return monsters;
  return monsters.filter(
    (m) => Number(f) === m.level || m.name.toLowerCase().includes(f),
  );
}

/** "39" → 39, "18 (+3 plate mail)" → 18. Fallback 0 for unparseable HP. */
export function parseMaxHp(hp: string): number {
  const n = parseInt(hp, 10);
  return isNaN(n) ? 0 : n;
}

