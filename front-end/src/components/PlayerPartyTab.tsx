import { type CSSProperties, useRef } from "react";
import PartyInventorySections from "./PartyInventorySections";
import CoinsRow from "./CoinsRow";
import { readableTextColor } from "./character";
import type { usePartyInventory } from "../hooks/usePartyInventory";
import type { PartySection, PartyWallet } from "../hooks/useGameSocket";

// The Party tab: shared, per-room content every player can read and write. The
// Party Inventory section holds the sectioned item list (Wagon/House/Unsorted)
// plus the shared coin wallet, all tinted with the player's own color like the
// character sheet. Wiring flows in from usePartyInventory / usePartyWallet.
interface Props {
  party: ReturnType<typeof usePartyInventory>;
  sections: PartySection[];
  wallet: PartyWallet;
  onWalletChange: (patch: Partial<PartyWallet>) => void;
  // The player's chosen color, used to tint the section legend (matches the
  // sheet). Omitted falls back to the plain, untinted sheet styling.
  accentColor?: string;
}

export default function PlayerPartyTab({
  party,
  sections,
  wallet,
  onWalletChange,
  accentColor,
}: Props) {
  // The scrolling ancestor, so cross-section drag can auto-scroll to reach an
  // off-screen section.
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="player-party-tab" ref={scrollRef}>
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
        <fieldset>
          <legend>Party Inventory</legend>
          <PartyInventorySections
            items={party.items}
            sections={sections}
            scrollRef={scrollRef}
            onChange={party.onChange}
            onRemove={party.onRemove}
            onReorder={party.onReorder}
            onAdd={party.onAdd}
            moveItemToSection={party.moveItemToSection}
            onTake={party.onTake}
            addSection={party.addSection}
            renameSection={party.renameSection}
            removeSection={party.removeSection}
            reorderSections={party.reorderSections}
          />
          <CoinsRow
            gp={wallet.gp}
            sp={wallet.sp}
            cp={wallet.cp}
            onChange={onWalletChange}
          />
        </fieldset>
      </div>
    </div>
  );
}
