export interface ParsedDice {
  count: number;
  sides: number;
  modifier: number;
}

// Advantage/disadvantage as chosen in the UI. "normal" is the resting state of
// the toggle; the wire type drops it (undefined) since a normal roll carries no
// mode. The helpers below accept either shape.
export type AdvMode = "advantage" | "disadvantage";
export type AdvModeOrNormal = AdvMode | "normal" | undefined;

export function parseDiceExpression(expr: string): ParsedDice | null {
  const m = /^(\d*)d(\d+)(([+-])(\d+))?$/i.exec(expr.replace(/\s+/g, ""));
  if (!m) return null;
  const count = m[1] ? parseInt(m[1]) : 1;
  const sides = parseInt(m[2]);
  let modifier = 0;
  if (m[3]) {
    modifier = parseInt(m[5]);
    if (m[4] === "-") modifier = -modifier;
  }
  if (count < 1 || count > 20 || sides < 2) return null;
  return { count, sides, modifier };
}

// Advantage/disadvantage only applies to a single d20; every other roll ignores
// the toggle. Centralized so the rule lives in exactly one place.
export function advantageApplies(
  count: number,
  sides: number,
  advMode: AdvModeOrNormal,
): boolean {
  return (
    count === 1 &&
    sides === 20 &&
    (advMode === "advantage" || advMode === "disadvantage")
  );
}

// The "with advantage"/"with disadvantage" note for a roll's label, or undefined
// when the roll is normal.
export function advantageLabel(advMode: AdvModeOrNormal): string | undefined {
  if (advMode === "advantage") return "with advantage";
  if (advMode === "disadvantage") return "with disadvantage";
  return undefined;
}

// The advantage note for a specific roll: present only when adv/disadv actually
// applies (a single d20), else undefined.
export function d20AdvantageLabel(
  count: number,
  sides: number,
  advMode: AdvModeOrNormal,
): string | undefined {
  return advantageApplies(count, sides, advMode)
    ? advantageLabel(advMode)
    : undefined;
}

// Combine already-rolled die values into a total. Under advantage/disadvantage
// (the caller rolls two d20s) keep the better/worse die; otherwise sum every
// die. The flat modifier is always added. `useAdvantage` is the result of
// advantageApplies, threaded in so callers that also branch on it (dice count,
// notation) stay consistent with the total.
export function totalFromValues(
  values: number[],
  modifier: number,
  useAdvantage: boolean,
  advMode: AdvModeOrNormal,
): number {
  if (useAdvantage) {
    const picked =
      advMode === "advantage" ? Math.max(...values) : Math.min(...values);
    return picked + modifier;
  }
  return values.reduce((sum, v) => sum + v, 0) + modifier;
}

// Roll a parsed expression locally, for private rolls resolved without the 3D
// dice box. When advantage/disadvantage applies, rolls two d20s and keeps the
// better/worse; otherwise rolls `count` dice. Returns the raw die values and
// the computed total.
export function rollLocally(
  parsed: ParsedDice,
  advMode: AdvModeOrNormal,
): { rolls: number[]; total: number } {
  const { count, sides, modifier } = parsed;
  const useAdvantage = advantageApplies(count, sides, advMode);
  const n = useAdvantage ? 2 : count;
  const rolls = Array.from(
    { length: n },
    () => Math.floor(Math.random() * sides) + 1,
  );
  const total = totalFromValues(rolls, modifier, useAdvantage, advMode);
  return { rolls, total };
}
