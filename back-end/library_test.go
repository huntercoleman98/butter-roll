package main

import (
	"os"
	"path/filepath"
	"testing"
)

// writeTokenFiles creates empty files in dir and returns the dir.
func writeTokenFiles(t *testing.T, names ...string) string {
	t.Helper()
	dir := t.TempDir()
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0644); err != nil {
			t.Fatalf("write %s: %v", n, err)
		}
	}
	return dir
}

func tokenByURL(lib TokenLibrary, url string) (LibraryToken, bool) {
	for _, tk := range lib.Tokens {
		if tk.URL == url {
			return tk, true
		}
	}
	return LibraryToken{}, false
}

func TestReconcileAddsNewFilesAtRoot(t *testing.T) {
	dir := writeTokenFiles(t, "a.png", "b.png")
	lib := reconcileLibrary(emptyLibrary(), dir, "/p/")

	if len(lib.Tokens) != 2 {
		t.Fatalf("want 2 tokens, got %d", len(lib.Tokens))
	}
	for _, url := range []string{"/p/a.png", "/p/b.png"} {
		tk, ok := tokenByURL(lib, url)
		if !ok {
			t.Fatalf("missing token %s", url)
		}
		if tk.FolderID != "" {
			t.Errorf("%s should be at root, got folderId %q", url, tk.FolderID)
		}
	}
	// Name is derived from the filename without extension.
	if tk, _ := tokenByURL(lib, "/p/a.png"); tk.Name != "a" {
		t.Errorf("want derived name %q, got %q", "a", tk.Name)
	}
}

func TestReconcileDropsPhantomTokens(t *testing.T) {
	dir := writeTokenFiles(t, "a.png")
	lib := reconcileLibrary(TokenLibrary{
		Tokens: []LibraryToken{
			{URL: "/p/a.png", Name: "A", FolderID: ""},
			{URL: "/p/gone.png", Name: "Ghost", FolderID: ""},
		},
	}, dir, "/p/")

	if _, ok := tokenByURL(lib, "/p/gone.png"); ok {
		t.Error("token with no file on disk should be dropped")
	}
	if _, ok := tokenByURL(lib, "/p/a.png"); !ok {
		t.Error("token with a file on disk should be kept")
	}
}

func TestReconcileRepairsDanglingFolderIDs(t *testing.T) {
	dir := writeTokenFiles(t, "a.png")
	lib := reconcileLibrary(TokenLibrary{
		Folders: []LibraryFolder{{ID: "f1", Name: "Real", ParentID: "ghost"}},
		Tokens: []LibraryToken{
			{URL: "/p/a.png", Name: "A", FolderID: "missing"},
		},
	}, dir, "/p/")

	if tk, _ := tokenByURL(lib, "/p/a.png"); tk.FolderID != "" {
		t.Errorf("dangling token folderId should reset to root, got %q", tk.FolderID)
	}
	if lib.Folders[0].ParentID != "" {
		t.Errorf("dangling folder parentId should reset to root, got %q", lib.Folders[0].ParentID)
	}
}

func TestReconcilePreservesValidPlacement(t *testing.T) {
	dir := writeTokenFiles(t, "a.png")
	lib := reconcileLibrary(TokenLibrary{
		Folders: []LibraryFolder{{ID: "f1", Name: "Goblins", ParentID: ""}},
		Tokens: []LibraryToken{
			{URL: "/p/a.png", Name: "Grunt", FolderID: "f1"},
		},
	}, dir, "/p/")

	tk, ok := tokenByURL(lib, "/p/a.png")
	if !ok || tk.FolderID != "f1" || tk.Name != "Grunt" {
		t.Errorf("valid placement not preserved: %+v", tk)
	}
}
