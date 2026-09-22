import { GiTwoCoins } from "react-icons/gi";

// A GP/SP/CP coin row. Shared by the character sheet's Gear section and the party
// tab's Party Wallet so the two render identically; they differ only in where the
// edits go (a character blob vs the shared party wallet), supplied via onChange.

function num(value: string, fallback = 0): number {
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

interface Props {
  gp: number;
  sp: number;
  cp: number;
  readOnly?: boolean;
  onChange: (patch: { gp?: number; sp?: number; cp?: number }) => void;
}

export default function CoinsRow({ gp, sp, cp, readOnly = false, onChange }: Props) {
  return (
    <div className="sheet-coins">
      <GiTwoCoins className="sheet-coins-icon" />
      <label>
        GP
        <input
          type="number"
          disabled={readOnly}
          value={gp}
          onChange={(e) => onChange({ gp: num(e.target.value) })}
        />
      </label>
      <label>
        SP
        <input
          type="number"
          disabled={readOnly}
          value={sp}
          onChange={(e) => onChange({ sp: num(e.target.value) })}
        />
      </label>
      <label>
        CP
        <input
          type="number"
          disabled={readOnly}
          value={cp}
          onChange={(e) => onChange({ cp: num(e.target.value) })}
        />
      </label>
    </div>
  );
}
