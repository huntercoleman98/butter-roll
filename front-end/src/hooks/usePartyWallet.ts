import type { OutgoingPayload, PartyWallet } from "./useGameSocket";

// Emitter for the shared party wallet. A standalone pool: onChange sends the new
// absolute totals (last-write-wins), following the same live-sync pattern as the
// party inventory (bind inputs to synced state, send on change, apply on the
// echo). Kept out of Player.tsx to hold that page component thin.

interface Args {
  partyWallet: PartyWallet;
  send: (payload: OutgoingPayload) => void;
}

export function usePartyWallet({ partyWallet, send }: Args) {
  function onChange(patch: Partial<PartyWallet>) {
    send({ case: "partyWallet", value: { ...partyWallet, ...patch } });
  }
  return { wallet: partyWallet, onChange };
}
