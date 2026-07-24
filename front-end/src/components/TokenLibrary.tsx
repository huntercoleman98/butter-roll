import { useRef, useState } from "react";
import { GiOpenFolder, GiFullFolder } from "react-icons/gi";
import type { TokenFolder, TokenAsset } from "../hooks/useGameSocket";
import { useTokenLibrary, ROOT } from "../hooks/useTokenLibrary";
import { ContextMenu } from "./ContextMenu";

const TOKEN_MIME = "application/x-token-url";
const FOLDER_MIME = "application/x-folder-id";

type ItemKind = "folder" | "token";

interface TokenLibraryProps {
  onPlaceToken: (url: string) => void;
}

export default function TokenLibrary({ onPlaceToken }: TokenLibraryProps) {
  const {
    lib,
    loading,
    childFolders,
    tokensIn,
    createFolder,
    renameFolder,
    deleteFolder,
    renameToken,
    deleteToken,
    moveToken,
    moveFolder,
    uploadFiles,
  } = useTokenLibrary();

  // UI-only state (the data layer lives in useTokenLibrary).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ kind: ItemKind; id: string } | null>(
    null,
  );
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    kind: ItemKind;
    id: string;
  } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Key of the item currently being dragged ("folder:<id>" | "token:<url>"),
  // used to dim the source so it reads as "lifted" rather than duplicated.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const isRenaming = (kind: ItemKind, id: string) =>
    renaming?.kind === kind && renaming.id === id;

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Create a folder, then expand its parent and start renaming it (UI concerns).
  function newFolder(parentId: string) {
    const id = createFolder(parentId);
    setExpanded((prev) => new Set(prev).add(parentId));
    setRenaming({ kind: "folder", id });
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  function openMenu(kind: ItemKind, id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, kind, id });
  }

  function menuRename() {
    if (menu) setRenaming({ kind: menu.kind, id: menu.id });
    setMenu(null);
  }

  function menuDelete() {
    if (!menu) return;
    if (menu.kind === "folder") deleteFolder(menu.id);
    else deleteToken(menu.id);
    setMenu(null);
  }

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  function onDropInto(folderId: string, e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Clear drag state here rather than relying on onDragEnd: the dropped item
    // re-renders into a new parent list, so its source node unmounts before
    // dragEnd fires and would otherwise stay dimmed.
    endDrag();
    const url = e.dataTransfer.getData(TOKEN_MIME);
    if (url) {
      moveToken(url, folderId);
      return;
    }
    const fid = e.dataTransfer.getData(FOLDER_MIME);
    if (fid) moveFolder(fid, folderId);
  }

  // Highlight this drop target. Rows stop propagation so the enclosing body
  // doesn't also claim the hover (which would fight the row's highlight).
  function onDragOverTarget(id: string, e: React.DragEvent, isRow: boolean) {
    e.preventDefault();
    if (isRow) e.stopPropagation();
    if (dragOverId !== id) setDragOverId(id);
  }

  // Only clear the highlight when the pointer truly leaves this element — not
  // when it merely moves onto a child, which is what caused the flicker.
  function onDragLeaveTarget(id: string, e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragOverId((cur) => (cur === id ? null : cur));
    }
  }

  function endDrag() {
    setDraggingKey(null);
    setDragOverId(null);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    await uploadFiles(files);
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  function renderToken(token: TokenAsset, depth: number) {
    const editing = isRenaming("token", token.url);
    return (
      <div
        key={token.url}
        className={`token-lib-item${
          draggingKey === `token:${token.url}` ? " dragging" : ""
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={!editing}
        onClick={editing ? undefined : () => onPlaceToken(token.url)}
        onDragStart={(e) => {
          e.dataTransfer.setData(TOKEN_MIME, token.url);
          e.dataTransfer.effectAllowed = "move";
          setDraggingKey(`token:${token.url}`);
        }}
        onDragEnd={endDrag}
        onContextMenu={(e) => openMenu("token", token.url, e)}
      >
        <img className="token-lib-thumb" src={token.url} alt="" title={token.name} />
        {editing ? (
          <input
            className="token-lib-rename"
            autoFocus
            defaultValue={token.name}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              renameToken(token.url, e.target.value.trim() || token.name);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <span className="token-lib-item-name" title={token.name}>
            {token.name}
          </span>
        )}
      </div>
    );
  }

  function renderFolder(folder: TokenFolder, depth: number) {
    const isOpen = expanded.has(folder.id);
    const isDragOver = dragOverId === folder.id;
    const editing = isRenaming("folder", folder.id);
    return (
      <div key={folder.id}>
        <div
          className={`token-lib-folder${isDragOver ? " drag-over" : ""}${
            draggingKey === `folder:${folder.id}` ? " dragging" : ""
          }`}
          style={{ paddingLeft: 4 + depth * 14 }}
          draggable={!editing}
          onClick={() => toggleExpand(folder.id)}
          onContextMenu={(e) => openMenu("folder", folder.id, e)}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData(FOLDER_MIME, folder.id);
            e.dataTransfer.effectAllowed = "move";
            setDraggingKey(`folder:${folder.id}`);
          }}
          onDragEnd={endDrag}
          onDragOver={(e) => onDragOverTarget(folder.id, e, true)}
          onDragLeave={(e) => onDragLeaveTarget(folder.id, e)}
          onDrop={(e) => onDropInto(folder.id, e)}
        >
          <span className="token-lib-twisty" aria-hidden="true">
            {isOpen ? "▾" : "▸"}
          </span>
          <span className="token-lib-folder-icon">
            {isOpen ? <GiOpenFolder /> : <GiFullFolder />}
          </span>
          {editing ? (
            <input
              className="token-lib-rename"
              autoFocus
              defaultValue={folder.name}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                renameFolder(folder.id, e.target.value.trim() || "Untitled");
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span className="token-lib-folder-name">{folder.name}</span>
          )}
          <span className="token-lib-folder-actions">
            <button
              title="New subfolder"
              onClick={(e) => {
                e.stopPropagation();
                newFolder(folder.id);
              }}
            >
              +
            </button>
          </span>
        </div>
        {isOpen && (
          <div>
            {childFolders(folder.id).map((f) => renderFolder(f, depth + 1))}
            {tokensIn(folder.id).map((t) => renderToken(t, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  const rootDragOver = dragOverId === ROOT;

  return (
    <div className="token-lib">
      <div className="token-lib-header">
        <button onClick={() => uploadRef.current?.click()}>Upload…</button>
        <button onClick={() => newFolder(ROOT)}>New folder</button>
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={handleUpload}
        />
      </div>
      <div
        className={`token-lib-body${rootDragOver ? " drag-over" : ""}`}
        onDragOver={(e) => onDragOverTarget(ROOT, e, false)}
        onDragLeave={(e) => onDragLeaveTarget(ROOT, e)}
        onDrop={(e) => onDropInto(ROOT, e)}
      >
        {loading ? (
          <div className="token-lib-empty">Loading…</div>
        ) : lib.folders.length === 0 && lib.tokens.length === 0 ? (
          <div className="token-lib-empty">No tokens yet. Upload some above.</div>
        ) : (
          <>
            {childFolders(ROOT).map((f) => renderFolder(f, 0))}
            {tokensIn(ROOT).map((t) => renderToken(t, 0))}
          </>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.kind === "folder" ? "Folder" : "Token"}
          onClose={() => setMenu(null)}
        >
          <li onClick={menuRename}>Rename</li>
          <li onClick={menuDelete}>Delete</li>
        </ContextMenu>
      )}
    </div>
  );
}
