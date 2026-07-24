import { useState } from "react";

export type PanelId = "initiative" | "dice" | "monsters";

// The floating panels are mutually stacked: exactly one is "on top" (z-index
// 151) at a time and the rest sit at 150. Toggling or focusing a panel brings
// it to the top. This hook owns that open/stack bookkeeping for all panels.
export function usePanels(initialTop: PanelId = "dice") {
  const [open, setOpen] = useState<Record<PanelId, boolean>>({
    initiative: false,
    dice: false,
    monsters: false,
  });
  const [top, setTop] = useState<PanelId>(initialTop);

  function panel(id: PanelId) {
    return {
      open: open[id],
      zIndex: top === id ? 151 : 150,
      toggle: () => {
        setOpen((o) => ({ ...o, [id]: !o[id] }));
        setTop(id);
      },
      close: () => setOpen((o) => ({ ...o, [id]: false })),
      focus: () => setTop(id),
    };
  }

  return {
    initiative: panel("initiative"),
    dice: panel("dice"),
    monsters: panel("monsters"),
  };
}
