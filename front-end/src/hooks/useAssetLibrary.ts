import { useEffect, useRef, useState } from "react";
import {
  type AssetLibrary as Library,
  type AssetFolder,
  type AssetLibraryApi,
} from "./useGameSocket";
import { uuid } from "../utils/uuid";

export const ROOT = ""; // parentId / folderId sentinel for the top level

const emptyLib: Library = { folders: [], tokens: [] };

// Is `maybeAncestorId` an ancestor of `folderId`? Used to block cyclic moves.
function isAncestor(
  folders: AssetFolder[],
  maybeAncestorId: string,
  folderId: string,
) {
  let cur = folders.find((f) => f.id === folderId);
  while (cur && cur.parentId !== ROOT) {
    if (cur.parentId === maybeAncestorId) return true;
    cur = folders.find((f) => f.id === cur!.parentId);
  }
  return false;
}

// Owns an asset library's data: server load, debounced persistence, and every
// tree mutation. `api` binds it to one store (tokens or maps); UI state
// (expanded/renaming/menu/drag) stays in the component.
export function useAssetLibrary(api: AssetLibraryApi) {
  const [lib, setLib] = useState<Library>(emptyLib);
  const [loading, setLoading] = useState(true);

  // Latest lib for async callers (upload/drop) that fire after a render.
  const libRef = useRef<Library>(lib);
  useEffect(() => {
    libRef.current = lib;
  }, [lib]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the newest api in a ref so the load/flush effect stays one-shot without
  // re-running (and re-fetching) if the caller passes a fresh api object.
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    apiRef.current
      .fetch()
      .then(setLib)
      .catch(console.error)
      .finally(() => setLoading(false));
    return () => {
      // Flush a pending debounced save so quick edits (e.g. creating an empty
      // folder) aren't lost when the component unmounts.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        apiRef.current.save(libRef.current).catch(console.error);
      }
    };
  }, []);

  // Apply a change locally and debounce-persist it to the server.
  function persist(next: Library) {
    setLib(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      apiRef.current.save(next).catch(console.error);
    }, 400);
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  const childFolders = (parentId: string) =>
    lib.folders.filter((f) => f.parentId === parentId);
  const tokensIn = (folderId: string) =>
    lib.tokens.filter((t) => t.folderId === folderId);

  // ── Mutations ────────────────────────────────────────────────────────────────

  // Returns the new folder's id so the caller can expand its parent / start rename.
  function createFolder(parentId: string): string {
    const folder: AssetFolder = { id: uuid(), name: "New folder", parentId };
    persist({ ...lib, folders: [...lib.folders, folder] });
    return folder.id;
  }

  function renameFolder(id: string, name: string) {
    persist({
      ...lib,
      folders: lib.folders.map((f) => (f.id === id ? { ...f, name } : f)),
    });
  }

  // Remove a folder, lifting its child folders and tokens up to its parent.
  function deleteFolder(id: string) {
    const folder = lib.folders.find((f) => f.id === id);
    if (!folder) return;
    const parent = folder.parentId;
    persist({
      folders: lib.folders
        .filter((f) => f.id !== id)
        .map((f) => (f.parentId === id ? { ...f, parentId: parent } : f)),
      tokens: lib.tokens.map((t) =>
        t.folderId === id ? { ...t, folderId: parent } : t,
      ),
    });
  }

  function renameToken(url: string, name: string) {
    persist({
      ...lib,
      tokens: lib.tokens.map((t) => (t.url === url ? { ...t, name } : t)),
    });
  }

  // Remove an asset from the library and delete its image file on the server.
  function deleteToken(url: string) {
    apiRef.current.remove(url).catch(console.error);
    persist({ ...lib, tokens: lib.tokens.filter((t) => t.url !== url) });
  }

  function moveToken(url: string, folderId: string) {
    const t = libRef.current.tokens.find((t) => t.url === url);
    if (!t || t.folderId === folderId) return;
    persist({
      ...libRef.current,
      tokens: libRef.current.tokens.map((t) =>
        t.url === url ? { ...t, folderId } : t,
      ),
    });
  }

  function moveFolder(id: string, newParentId: string) {
    if (id === newParentId) return;
    const folders = libRef.current.folders;
    const folder = folders.find((f) => f.id === id);
    if (!folder || folder.parentId === newParentId) return;
    // Can't drop a folder into itself or one of its own descendants.
    if (newParentId !== ROOT && isAncestor(folders, id, newParentId)) return;
    persist({
      ...libRef.current,
      folders: folders.map((f) =>
        f.id === id ? { ...f, parentId: newParentId } : f,
      ),
    });
  }

  // Upload files and add them to the library under `folderId` (root by default).
  async function uploadFiles(files: File[], folderId: string = ROOT) {
    const added = [];
    for (const file of files) {
      try {
        const url = await apiRef.current.upload(file);
        added.push({ url, name: file.name.replace(/\.[^.]+$/, ""), folderId });
      } catch (err) {
        console.error(err);
      }
    }
    if (added.length) {
      persist({
        ...libRef.current,
        tokens: [...libRef.current.tokens, ...added],
      });
    }
  }

  return {
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
  };
}
