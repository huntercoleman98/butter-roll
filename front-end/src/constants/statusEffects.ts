import type { IconType } from "react-icons";
import {
  GiDeathSkull,
  GiBlood,
  GiPoison,
  GiBlindfold,
  GiFlame,
  GiDroplets,
  GiSpikedHalo,
  GiBeveledStar,
  GiKnockout,
  GiElectric,
  GiCharm,
  GiScreaming,
} from "react-icons/gi";

export interface StatusEffect {
  id: string;
  label: string;
  Icon: IconType;
  badgeColor: string;
}

export const STATUS_EFFECTS: StatusEffect[] = [
  { id: "dead", label: "Dead", Icon: GiDeathSkull, badgeColor: "#374151" },
  {
    id: "bloodied",
    label: "Bloodied",
    Icon: GiBlood,
    badgeColor: "#991b1b",
  },
  { id: "poisoned", label: "Poisoned", Icon: GiPoison, badgeColor: "#14532d" },
  { id: "blinded", label: "Blinded", Icon: GiBlindfold, badgeColor: "#1e3a5f" },
  { id: "burning", label: "Burning", Icon: GiFlame, badgeColor: "#7f1d1d" },
  { id: "frozen", label: "Frozen", Icon: GiBeveledStar, badgeColor: "#1e3a8a" },
  {
    id: "unconscious",
    label: "Unconscious",
    Icon: GiKnockout,
    badgeColor: "#4b5563",
  },
  { id: "wet", label: "Wet", Icon: GiDroplets, badgeColor: "#0c4a6e" },
  {
    id: "blessed",
    label: "Blessed",
    Icon: GiSpikedHalo,
    badgeColor: "#78350f",
  },
  {
    id: "paralyzed",
    label: "Paralyzed",
    Icon: GiElectric,
    badgeColor: "#98a82e",
  },
  { id: "charmed", label: "Charmed", Icon: GiCharm, badgeColor: "#831843" },
  {
    id: "frightened",
    label: "Frightened",
    Icon: GiScreaming,
    badgeColor: "#7c2d12",
  },
];

export const STATUS_EFFECT_MAP = new Map(STATUS_EFFECTS.map((e) => [e.id, e]));
