package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// An asset library is an organizational layer over a flat asset store (used for
// both the token store and the map store). Image files stay flat in assetsDir
// with stable URLs (so assets already referenced on a map never break); this
// sidecar only records the folder tree and each asset's folder + display name.
// It is reconciled against the files on disk on every read, so uploads appear
// automatically and deletions clean themselves up.
//
// The Go type/field names below are historically token-flavored (TokenLibrary,
// LibraryToken, Tokens) and the on-disk JSON keeps the "tokens" key for
// backward compatibility; a map library reuses the same shape and handlers,
// pointed at a different directory and sidecar file.

type LibraryFolder struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ParentID string `json:"parentId"` // "" = root
}

type LibraryToken struct {
	URL      string `json:"url"`
	Name     string `json:"name"`
	FolderID string `json:"folderId"` // "" = root / unfiled
}

type TokenLibrary struct {
	Folders []LibraryFolder `json:"folders"`
	Tokens  []LibraryToken  `json:"tokens"`
}

// libraryMu guards read/modify/write of the single library file against
// concurrent HTTP handlers (the hub's single-goroutine model doesn't cover it).
var libraryMu sync.Mutex

func emptyLibrary() TokenLibrary {
	return TokenLibrary{Folders: []LibraryFolder{}, Tokens: []LibraryToken{}}
}

func readLibraryFile(path string) TokenLibrary {
	data, err := os.ReadFile(path)
	if err != nil {
		return emptyLibrary()
	}
	lib := emptyLibrary()
	if err := json.Unmarshal(data, &lib); err != nil {
		log.Printf("library: cannot parse %s (%v); starting fresh", path, err)
		return emptyLibrary()
	}
	if lib.Folders == nil {
		lib.Folders = []LibraryFolder{}
	}
	if lib.Tokens == nil {
		lib.Tokens = []LibraryToken{}
	}
	return lib
}

func writeLibraryFile(path string, lib TokenLibrary) error {
	data, err := json.MarshalIndent(lib, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// reconcileLibrary merges the persisted index with the files actually present in
// tokensDir: entries whose file is gone are dropped, files with no entry are
// appended at the root, and folder references that point at a missing folder are
// reset to the root.
func reconcileLibrary(lib TokenLibrary, tokensDir, urlPrefix string) TokenLibrary { //nolint:gocyclo // sequential reconcile phases sharing lookup maps; clearer inline than split apart
	entries, err := os.ReadDir(tokensDir)
	if err != nil {
		log.Printf("library: read tokens dir: %v", err)
	}
	onDisk := make(map[string]bool)
	var filenames []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasSuffix(name, ".tmp") {
			continue
		}
		onDisk[urlPrefix+name] = true
		filenames = append(filenames, name)
	}

	folderExists := make(map[string]bool, len(lib.Folders))
	for _, f := range lib.Folders {
		folderExists[f.ID] = true
	}

	// Keep only tokens whose file still exists; repair dangling folderIds.
	kept := make([]LibraryToken, 0, len(lib.Tokens))
	seen := make(map[string]bool, len(lib.Tokens))
	for _, t := range lib.Tokens {
		if !onDisk[t.URL] || seen[t.URL] {
			continue
		}
		if t.FolderID != "" && !folderExists[t.FolderID] {
			t.FolderID = ""
		}
		if t.Name == "" {
			t.Name = defaultTokenName(t.URL)
		}
		kept = append(kept, t)
		seen[t.URL] = true
	}

	// Append any new files (uploaded outside the library flow) at the root.
	sort.Strings(filenames)
	for _, name := range filenames {
		url := urlPrefix + name
		if seen[url] {
			continue
		}
		kept = append(kept, LibraryToken{URL: url, Name: defaultTokenName(url), FolderID: ""})
	}
	lib.Tokens = kept

	// Repair dangling parent references.
	for i, f := range lib.Folders {
		if f.ParentID != "" && !folderExists[f.ParentID] {
			lib.Folders[i].ParentID = ""
		}
	}
	if lib.Folders == nil {
		lib.Folders = []LibraryFolder{}
	}
	return lib
}

// defaultTokenName derives a display name from an asset URL: the filename
// without its directory or extension (UUID names fall through unchanged).
func defaultTokenName(url string) string {
	base := filepath.Base(url)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

// deleteAsset removes an asset image file. The library sidecar isn't touched —
// reconcileLibrary drops entries whose file is gone on the next read. POST (not
// DELETE) with a plain body to stay a CORS "simple request".
func deleteAsset(tokensDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		var body struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.URL == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		name := filepath.Base(body.URL) // guards against path traversal
		if name == "." || name == string(filepath.Separator) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err := os.Remove(filepath.Join(tokensDir, name)); err != nil &&
			!errors.Is(err, os.ErrNotExist) {
			log.Printf("assets: delete token %q: %v", name, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// getAssetLibrary returns the reconciled folder tree + assets as JSON.
func getAssetLibrary(tokensDir, libraryPath, urlPrefix string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		libraryMu.Lock()
		lib := reconcileLibrary(readLibraryFile(libraryPath), tokensDir, urlPrefix)
		libraryMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(lib)
	}
}

// saveAssetLibrary persists a client-supplied library, reconciled against disk
// first so phantom assets are never written. Sent as a POST with a plain body
// to stay a CORS "simple request" (no preflight), matching the upload flow.
func saveAssetLibrary(tokensDir, libraryPath, urlPrefix string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		var lib TokenLibrary
		if err := json.NewDecoder(r.Body).Decode(&lib); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		if lib.Folders == nil {
			lib.Folders = []LibraryFolder{}
		}
		if lib.Tokens == nil {
			lib.Tokens = []LibraryToken{}
		}
		libraryMu.Lock()
		lib = reconcileLibrary(lib, tokensDir, urlPrefix)
		err := writeLibraryFile(libraryPath, lib)
		libraryMu.Unlock()
		if err != nil {
			log.Printf("library: save: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(lib)
	}
}
