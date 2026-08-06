import { type CSSProperties } from "react";
import { GiDiceTwentyFacesTwenty, GiTwoCoins } from "react-icons/gi";
import { uuid } from "../utils/uuid";
import { ABILITY_NAMES, type AbilityName, type Character } from "./character";

// The sheet is a controlled component: the parent owns the Character and
// receives patches via onChange. The player's copy lives in localStorage and is
// pushed to the backend (see Player.tsx); the DM renders it read-only. The data
// model + helpers live in ./character.

// ── Helpers ───────────────────────────────────────────────────────

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function modStr(score: number): string {
  const m = abilityMod(score);
  return m >= 0 ? `+${m}` : `${m}`;
}

function num(value: string, fallback = 0): number {
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

function fnum(value: string, fallback = 0): number {
  const n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}

function updateItem<T extends { id: string }>(
  list: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return list.map((it) => (it.id === id ? { ...it, ...patch } : it));
}

// Pick black or white text for a #rrggbb background so the label stays legible
// whatever color the player chose. Uses perceived (sRGB-weighted) luminance.
function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000" : "#fff";
}

// ── Props ─────────────────────────────────────────────────────────

interface Props {
  // The character's name, owned by the player profile (see Player.tsx) and shown
  // read-only here — edited on the setup screen, not the sheet.
  name: string;
  character: Character;
  // Called with a partial patch when the player edits a field. Omitted in
  // read-only mode (the DM's view of another player's sheet).
  onChange?: (patch: Partial<Character>) => void;
  // Read-only disables every input and hides add/remove controls; roll buttons
  // stay so the DM can still roll from a player's sheet.
  readOnly?: boolean;
  ready: boolean;
  // A d20 check that respects the current advantage/disadvantage toggle.
  onRollCheck: (mod: number, label: string) => void;
  // An arbitrary expression roll (damage, hit dice, …), no adv/disadv.
  onRoll: (expression: string, label?: string) => void;
  // The player's chosen color. When set, the section legends are tinted with it
  // (matching the player's identity). Omitted in the DM's read-only view.
  accentColor?: string;
}

export default function CharacterSheet({
  name,
  character: c,
  onChange,
  readOnly = false,
  ready,
  onRollCheck,
  onRoll,
  accentColor,
}: Props) {
  const set = (patch: Partial<Character>) => onChange?.(patch);

  const strScore = c.abilities.STR;
  const totalSlots = Math.max(strScore, 10);
  const coinSlots = Math.floor((c.gp + c.sp + c.cp) / 100);
  const gearSlots = c.gear.reduce(
    (sum, g) => sum + (g.qty || 0) * (g.slotsEach || 0),
    0,
  );
  const usedSlots = gearSlots + coinSlots;
  const spellMod =
    c.spellcastingAbility === ""
      ? 0
      : abilityMod(c.abilities[c.spellcastingAbility]);

  return (
    <div
      className={accentColor ? "sheet sheet--accented" : "sheet"}
      style={
        accentColor
          ? ({
              "--sheet-accent": accentColor,
              "--sheet-accent-fg": readableTextColor(accentColor),
            } as CSSProperties)
          : undefined
      }
    >
      {/* ── Bio ─────────────────────────────────────────────── */}
      <fieldset className="sheet-bio">
        <div className="sheet-name">
          <span className="sheet-name-text">
            {name || "Unnamed character"}
          </span>
        </div>
        <div className="sheet-bio-grid">
          <Field label="Ancestry">
            <input
              type="text"
              disabled={readOnly}
              value={c.ancestry}
              onChange={(e) => set({ ancestry: e.target.value })}
            />
          </Field>
          <Field label="Class">
            <input
              type="text"
              disabled={readOnly}
              value={c.className}
              onChange={(e) => set({ className: e.target.value })}
            />
          </Field>
          <Field label="Level">
            <input
              type="number"
              disabled={readOnly}
              value={c.level}
              onChange={(e) => set({ level: num(e.target.value) })}
            />
          </Field>
          <Field label="Title">
            <input
              type="text"
              disabled={readOnly}
              value={c.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>
          <Field label="Alignment">
            <select
              disabled={readOnly}
              value={c.alignment}
              onChange={(e) => set({ alignment: e.target.value })}
            >
              <option value="">—</option>
              <option>Lawful</option>
              <option>Neutral</option>
              <option>Chaotic</option>
            </select>
          </Field>
          <Field label="Deity">
            <input
              type="text"
              disabled={readOnly}
              value={c.deity}
              onChange={(e) => set({ deity: e.target.value })}
            />
          </Field>
          <Field label="Background">
            <input
              type="text"
              disabled={readOnly}
              value={c.background}
              onChange={(e) => set({ background: e.target.value })}
            />
          </Field>
          <Field label="XP">
            <div className="sheet-xp">
              <input
                type="number"
                disabled={readOnly}
                value={c.xp}
                onChange={(e) => set({ xp: num(e.target.value) })}
              />
              <span className="sheet-xp-next">/ {c.level * 10} to level</span>
            </div>
          </Field>
        </div>
      </fieldset>

      {/* ── Abilities ───────────────────────────────────────── */}
      <fieldset>
        <legend>Abilities</legend>
        <div className="sheet-abilities">
          {ABILITY_NAMES.map((a) => (
            <div key={a} className="sheet-ability">
              <div className="sheet-ability-name">{a}</div>
              <div className="sheet-ability-mod">{modStr(c.abilities[a])}</div>
              <input
                className="sheet-ability-score"
                type="number"
                disabled={readOnly}
                value={c.abilities[a]}
                onChange={(e) =>
                  set({
                    abilities: {
                      ...c.abilities,
                      [a]: Math.min(30, Math.max(1, num(e.target.value, 10))),
                    },
                  })
                }
              />
              <button
                className="sheet-roll-btn"
                disabled={!ready}
                title={`Roll ${a} check`}
                onClick={() => onRollCheck(abilityMod(c.abilities[a]), a)}
              >
                <GiDiceTwentyFacesTwenty />
              </button>
            </div>
          ))}
        </div>
      </fieldset>

      {/* ── Combat ──────────────────────────────────────────── */}
      <fieldset>
        <legend>Combat</legend>
        <div className="sheet-combat">
          <Field label="HP">
            <div className="sheet-hp">
              <input
                type="number"
                disabled={readOnly}
                value={c.hp}
                onChange={(e) => set({ hp: num(e.target.value) })}
              />
              <span>/</span>
              <input
                type="number"
                disabled={readOnly}
                value={c.maxHp}
                onChange={(e) => set({ maxHp: num(e.target.value) })}
              />
            </div>
          </Field>
          <Field label="Temp">
            <input
              type="number"
              disabled={readOnly}
              value={c.tempHp}
              onChange={(e) => set({ tempHp: num(e.target.value) })}
            />
          </Field>
          <Field label="AC">
            <input
              type="number"
              disabled={readOnly}
              value={c.ac}
              onChange={(e) => set({ ac: num(e.target.value) })}
            />
          </Field>
          <Field label="Luck">
            <input
              type="number"
              min={0}
              disabled={readOnly}
              value={c.luck}
              onChange={(e) => set({ luck: num(e.target.value) })}
            />
          </Field>
        </div>
      </fieldset>

      {/* ── Attacks ─────────────────────────────────────────── */}
      <fieldset>
        <legend>Attacks</legend>
        <div className="sheet-list">
          {c.attacks.map((atk) => (
            <div key={atk.id} className="sheet-attack">
              <div className="sheet-attack-top">
                <input
                  className="sheet-attack-name"
                  type="text"
                  placeholder="Attack name"
                  disabled={readOnly}
                  value={atk.name}
                  onChange={(e) =>
                    set({
                      attacks: updateItem(c.attacks, atk.id, {
                        name: e.target.value,
                      }),
                    })
                  }
                />
                {!readOnly && (
                  <button
                    className="sheet-remove"
                    title="Remove"
                    onClick={() =>
                      set({ attacks: c.attacks.filter((a) => a.id !== atk.id) })
                    }
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="sheet-attack-fields">
                <label className="sheet-field">
                  <span className="sheet-field-label">Range</span>
                  <select
                    disabled={readOnly}
                    value={atk.range}
                    onChange={(e) =>
                      set({
                        attacks: updateItem(c.attacks, atk.id, {
                          range: e.target.value,
                        }),
                      })
                    }
                  >
                    <option>Close</option>
                    <option>Near</option>
                    <option>Far</option>
                  </select>
                </label>
                <label className="sheet-field">
                  <span className="sheet-field-label">To Hit</span>
                  <div className="sheet-attack-input-roll">
                    <input
                      type="number"
                      disabled={readOnly}
                      value={atk.bonus}
                      onChange={(e) =>
                        set({
                          attacks: updateItem(c.attacks, atk.id, {
                            bonus: num(e.target.value),
                          }),
                        })
                      }
                    />
                    <button
                      className="sheet-roll-btn"
                      disabled={!ready}
                      title="Roll attack"
                      onClick={() =>
                        onRollCheck(atk.bonus, `${atk.name} attack`)
                      }
                    >
                      <GiDiceTwentyFacesTwenty />
                    </button>
                  </div>
                </label>
                <label className="sheet-field">
                  <span className="sheet-field-label">Dmg</span>
                  <div className="sheet-attack-input-roll">
                    <input
                      type="text"
                      placeholder="1d8+3"
                      disabled={readOnly}
                      value={atk.damage}
                      onChange={(e) =>
                        set({
                          attacks: updateItem(c.attacks, atk.id, {
                            damage: e.target.value,
                          }),
                        })
                      }
                    />
                    <button
                      className="sheet-roll-btn"
                      disabled={!ready || !atk.damage.trim()}
                      title="Roll damage"
                      onClick={() => onRoll(atk.damage, `${atk.name} damage`)}
                    >
                      <GiDiceTwentyFacesTwenty />
                    </button>
                  </div>
                </label>
              </div>
            </div>
          ))}
        </div>
        {!readOnly && (
          <button
            className="sheet-add"
            onClick={() =>
              set({
                attacks: [
                  ...c.attacks,
                  { id: uuid(), name: "", range: "Close", bonus: 0, damage: "" },
                ],
              })
            }
          >
            + Add attack
          </button>
        )}
      </fieldset>

      {/* ── Talents & Features ──────────────────────────────── */}
      <fieldset>
        <legend>Talents &amp; Features</legend>
        <div className="sheet-list">
          {c.talents.map((t) => (
            <div key={t.id} className="sheet-text-row">
              <textarea
                rows={2}
                disabled={readOnly}
                value={t.text}
                onChange={(e) =>
                  set({
                    talents: updateItem(c.talents, t.id, {
                      text: e.target.value,
                    }),
                  })
                }
              />
              {!readOnly && (
                <button
                  className="sheet-remove"
                  title="Remove"
                  onClick={() =>
                    set({ talents: c.talents.filter((x) => x.id !== t.id) })
                  }
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <button
            className="sheet-add"
            onClick={() =>
              set({ talents: [...c.talents, { id: uuid(), text: "" }] })
            }
          >
            + Add talent
          </button>
        )}
      </fieldset>

      {/* ── Spells ──────────────────────────────────────────── */}
      {/* Hidden entirely when the player disables spellcasting in settings. */}
      {c.spellcastingEnabled && (
      <fieldset>
        <legend>Spells</legend>
        <Field label="Spellcasting">
          <select
            disabled={readOnly}
            value={c.spellcastingAbility}
            onChange={(e) =>
              set({ spellcastingAbility: e.target.value as AbilityName | "" })
            }
          >
            <option value="">— (non-caster)</option>
            {ABILITY_NAMES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
        <div className="sheet-list">
          <div className="sheet-spell-head">
            <span>Ready</span>
            <span>Tier</span>
            <span>Name</span>
            <span>Duration</span>
            <span />
            <span />
          </div>
          {c.spells.map((s) => (
            <div key={s.id} className="sheet-spell-row">
              <div className="sheet-spell-ready">
                <input
                  type="checkbox"
                  id={`spell-ready-${s.id}`}
                  disabled={readOnly}
                  checked={s.ready}
                  onChange={(e) =>
                    set({
                      spells: updateItem(c.spells, s.id, {
                        ready: e.target.checked,
                      }),
                    })
                  }
                />
                <label htmlFor={`spell-ready-${s.id}`} title="Ready to cast" />
              </div>
              <input
                className="sheet-spell-tier"
                type="number"
                disabled={readOnly}
                value={s.tier}
                onChange={(e) =>
                  set({
                    spells: updateItem(c.spells, s.id, {
                      tier: num(e.target.value, 1),
                    }),
                  })
                }
              />
              <input
                type="text"
                disabled={readOnly}
                value={s.name}
                onChange={(e) =>
                  set({
                    spells: updateItem(c.spells, s.id, { name: e.target.value }),
                  })
                }
              />
              <input
                type="text"
                disabled={readOnly}
                value={s.duration}
                onChange={(e) =>
                  set({
                    spells: updateItem(c.spells, s.id, {
                      duration: e.target.value,
                    }),
                  })
                }
              />
              <button
                className="sheet-inline-roll"
                disabled={!ready || c.spellcastingAbility === "" || !s.ready}
                title={s.ready ? `Cast (DC ${10 + s.tier})` : "Spell not ready"}
                onClick={() =>
                  onRollCheck(spellMod, `Cast ${s.name} (DC ${10 + s.tier})`)
                }
              >
                Cast
              </button>
              {!readOnly && (
                <button
                  className="sheet-remove"
                  title="Remove"
                  onClick={() =>
                    set({ spells: c.spells.filter((x) => x.id !== s.id) })
                  }
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <button
            className="sheet-add"
            onClick={() =>
              set({
                spells: [
                  ...c.spells,
                  { id: uuid(), name: "", tier: 1, duration: "", ready: true },
                ],
              })
            }
          >
            + Add spell
          </button>
        )}
      </fieldset>
      )}

      {/* ── Gear ────────────────────────────────────────────── */}
      <fieldset>
        <legend>
          Gear —{" "}
          <span
            className={usedSlots > totalSlots ? "sheet-slots-over" : undefined}
          >
            {usedSlots.toFixed(2)}/{totalSlots} slots
          </span>
        </legend>
        <div className="sheet-list">
          <div className="sheet-gear-head">
            <span>Item</span>
            <span>Qty</span>
            <span>Slots ea.</span>
            <span />
          </div>
          {c.gear.map((g) => (
            <div key={g.id} className="sheet-gear-row">
              <input
                type="text"
                disabled={readOnly}
                value={g.name}
                onChange={(e) =>
                  set({
                    gear: updateItem(c.gear, g.id, { name: e.target.value }),
                  })
                }
              />
              <input
                className="sheet-gear-num"
                type="number"
                min={0}
                disabled={readOnly}
                value={g.qty}
                onChange={(e) =>
                  set({
                    gear: updateItem(c.gear, g.id, { qty: num(e.target.value) }),
                  })
                }
              />
              <input
                className="sheet-gear-num"
                type="number"
                min={0}
                step={0.01}
                disabled={readOnly}
                value={g.slotsEach}
                onChange={(e) =>
                  set({
                    gear: updateItem(c.gear, g.id, {
                      slotsEach: fnum(e.target.value),
                    }),
                  })
                }
              />
              {!readOnly && (
                <button
                  className="sheet-remove"
                  title="Remove"
                  onClick={() =>
                    set({ gear: c.gear.filter((x) => x.id !== g.id) })
                  }
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <button
            className="sheet-add"
            onClick={() =>
              set({
                gear: [...c.gear, { id: uuid(), name: "", qty: 1, slotsEach: 1 }],
              })
            }
          >
            + Add item
          </button>
        )}

        <div className="sheet-coins">
          <GiTwoCoins className="sheet-coins-icon" />
          <label>
            GP
            <input
              type="number"
              disabled={readOnly}
              value={c.gp}
              onChange={(e) => set({ gp: num(e.target.value) })}
            />
          </label>
          <label>
            SP
            <input
              type="number"
              disabled={readOnly}
              value={c.sp}
              onChange={(e) => set({ sp: num(e.target.value) })}
            />
          </label>
          <label>
            CP
            <input
              type="number"
              disabled={readOnly}
              value={c.cp}
              onChange={(e) => set({ cp: num(e.target.value) })}
            />
          </label>
        </div>
      </fieldset>

      {/* ── Languages ───────────────────────────────────────── */}
      <fieldset>
        <legend>Languages</legend>
        <textarea
          className="sheet-languages"
          rows={2}
          disabled={readOnly}
          value={c.languages}
          onChange={(e) => set({ languages: e.target.value })}
        />
      </fieldset>
    </div>
  );
}

// ── Small presentational helper ───────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="sheet-field">
      <span className="sheet-field-label">{label}</span>
      {children}
    </label>
  );
}
