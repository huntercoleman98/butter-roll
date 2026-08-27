import { GiCog, GiSheikahEye, GiSightDisabled } from "react-icons/gi";

export type PlayerTab = "sheet" | "dice" | "notes";

const TABS: { id: PlayerTab; label: string }[] = [
  { id: "sheet", label: "Sheet" },
  { id: "dice", label: "Dice" },
  { id: "notes", label: "Notes" },
];

interface Props {
  tab: PlayerTab;
  onSelect: (tab: PlayerTab) => void;
  ready: boolean;
  isPrivate: boolean;
  onTogglePrivate: () => void;
  onEditProfile: () => void;
}

// The player window's tab strip: the Sheet/Dice/Notes tablist plus the
// private-roll toggle and profile-edit buttons. Extracted from <Player> so the
// page stays thin as tabs accrue (the tablist is the part that grows).
export default function PlayerTabRow({
  tab,
  onSelect,
  ready,
  isPrivate,
  onTogglePrivate,
  onEditProfile,
}: Props) {
  return (
    <div className="player-tab-row">
      <menu role="tablist">
        {TABS.map(({ id, label }) => (
          <li key={id} aria-selected={tab === id}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onSelect(id);
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </menu>
      <div className="player-tab-row-actions">
        <button
          disabled={!ready}
          onClick={onTogglePrivate}
          title={isPrivate ? "Private (in the tower)" : "Public"}
          className="icon-btn"
        >
          {isPrivate ? <GiSightDisabled /> : <GiSheikahEye />}
        </button>
        <button
          className="icon-btn"
          title="Change name / color"
          onClick={onEditProfile}
        >
          <GiCog />
        </button>
      </div>
    </div>
  );
}
