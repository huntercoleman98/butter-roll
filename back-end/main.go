package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed dist
var frontendFS embed.FS

func main() {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "."
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Fatalf("cannot create data dir: %v", err)
	}

	assetsDir := filepath.Join(dataDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		log.Fatalf("cannot create assets dir: %v", err)
	}

	sessionPath := filepath.Join(dataDir, "session.json")
	session, err := LoadSession(sessionPath)
	if err != nil {
		log.Fatalf("cannot load session: %v", err)
	}

	hub := NewHub(session, sessionPath)
	go hub.Run()

	distFS, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		log.Fatalf("cannot create frontend fs: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/ws", cors(allowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		serveWS(hub, w, r)
	}))
	mux.HandleFunc("POST /api/assets", cors(allowedOrigin, uploadAsset(assetsDir)))
	mux.HandleFunc("GET /api/assets/{file}", cors(allowedOrigin, serveAsset(assetsDir)))
	mux.HandleFunc("/", spaHandler(distFS))

	log.Println("butter-roll server listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}

func spaHandler(fsys fs.FS) http.HandlerFunc {
	fileServer := http.FileServerFS(fsys)
	return func(w http.ResponseWriter, r *http.Request) {
		urlPath := strings.TrimPrefix(r.URL.Path, "/")
		if urlPath == "" {
			urlPath = "index.html"
		}
		if _, err := fs.Stat(fsys, urlPath); err != nil {
			http.ServeFileFS(w, r, fsys, "index.html")
			return
		}
		fileServer.ServeHTTP(w, r)
	}
}

func cors(origin string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next(w, r)
	}
}