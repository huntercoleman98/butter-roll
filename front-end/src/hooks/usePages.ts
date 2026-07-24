import { useEffect, useRef, useState } from "react";
import { uuid } from "../utils/uuid";
import { useOutsideClick } from "./useOutsideClick";
import type { Page, OutgoingPayload } from "./useGameSocket";

export type PageContextMenu = { pageId: string; x: number; y: number };

// Owns page management: which page is active, the Pages dropdown + its
// rename-in-place and right-click context menu, and the add/present/delete/
// rename actions. `onPageSwitch` lets the caller react to a page change (the DM
// clears its token selection).
export function usePages({
  pages,
  presentedPageId,
  send,
  onPageSwitch,
}: {
  pages: Page[];
  presentedPageId: string | null;
  send: (payload: OutgoingPayload) => void;
  onPageSwitch: () => void;
}) {
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [pagesMenuOpen, setPagesMenuOpen] = useState(false);
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pageContextMenu, setPageContextMenu] =
    useState<PageContextMenu | null>(null);
  const pagesMenuRef = useRef<HTMLDivElement>(null);

  useOutsideClick(
    pagesMenuRef,
    () => {
      setPagesMenuOpen(false);
      setRenamingPageId(null);
    },
    pagesMenuOpen,
  );

  // On first snapshot, initialize active page to the presented page.
  useEffect(() => {
    if (activePageId === null && pages.length > 0) {
      setActivePageId(presentedPageId ?? pages[0].id);
    }
  }, [pages, presentedPageId, activePageId]);

  // If the active page is deleted remotely, fall back to the first page.
  useEffect(() => {
    if (
      activePageId &&
      pages.length > 0 &&
      !pages.find((p) => p.id === activePageId)
    ) {
      setActivePageId(pages[0].id);
    }
  }, [pages, activePageId]);

  const activePage =
    pages.find((p) => p.id === activePageId) ?? pages[0] ?? null;
  const activeId = activePage?.id ?? "";

  function switchToPage(pageId: string) {
    setActivePageId(pageId);
    onPageSwitch();
    setPagesMenuOpen(false);
    setRenamingPageId(null);
  }

  function handleAddPage() {
    const id = uuid();
    const name = `Page ${pages.length + 1}`;
    send({ case: "pageAdd", value: { id, name } });
    setActivePageId(id);
    setPagesMenuOpen(false);
  }

  function handlePresentPage(id: string) {
    send({ case: "pagePresent", value: { id } });
    setPagesMenuOpen(false);
  }

  function handleDeletePage(id: string) {
    setPageContextMenu(null);
    if (id === activeId) {
      const other = pages.find((p) => p.id !== id);
      if (other) setActivePageId(other.id);
    }
    send({ case: "pageRemove", value: { id } });
  }

  function startRename(page: { id: string; name: string }) {
    setPageContextMenu(null);
    setRenamingPageId(page.id);
    setRenameValue(page.name);
    if (!pagesMenuOpen) setPagesMenuOpen(true);
  }

  function commitRename(pageId: string, currentName: string) {
    const name = renameValue.trim() || currentName;
    send({ case: "pageRename", value: { id: pageId, name } });
    setRenamingPageId(null);
  }

  return {
    activePage,
    activeId,
    pagesMenuRef,
    pagesMenuOpen,
    setPagesMenuOpen,
    renamingPageId,
    setRenamingPageId,
    renameValue,
    setRenameValue,
    pageContextMenu,
    setPageContextMenu,
    switchToPage,
    handleAddPage,
    handlePresentPage,
    handleDeletePage,
    startRename,
    commitRename,
  };
}
