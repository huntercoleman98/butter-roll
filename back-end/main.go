package main

import (
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

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

	tokensDir := filepath.Join(assetsDir, "tokens")
	if err := os.MkdirAll(tokensDir, 0755); err != nil {
		log.Fatalf("cannot create tokens dir: %v", err)
	}

	monstersDir := filepath.Join(assetsDir, "monsters")
	if err := os.MkdirAll(monstersDir, 0755); err != nil {
		log.Fatalf("cannot create monsters dir: %v", err)
	}

	mapsDir := filepath.Join(assetsDir, "maps")
	if err := os.MkdirAll(mapsDir, 0755); err != nil {
		log.Fatalf("cannot create maps dir: %v", err)
	}

	libraryPath := filepath.Join(assetsDir, "token-library.json")
	mapLibraryPath := filepath.Join(assetsDir, "map-library.json")

	sessionPath := filepath.Join(dataDir, "session.json")
	session, err := LoadSession(sessionPath)
	if err != nil {
		log.Fatalf("cannot load session: %v", err)
	}

	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = filepath.Join(dataDir, "config.json")
	}
	cfg, err := LoadConfig(configPath)
	if err != nil {
		log.Fatalf("cannot load config: %v", err)
	}
	session.cfg = cfg

	hub := NewHub(session, sessionPath)
	go hub.Run()

	distFS, err := getFrontendFS()
	if err != nil {
		log.Fatalf("cannot create frontend fs: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/ws", cors(allowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		serveWS(hub, w, r)
	}))
	mux.HandleFunc("POST /api/assets", cors(allowedOrigin, uploadAsset(assetsDir, "/api/assets/")))
	mux.HandleFunc("GET /api/assets/{file}", cors(allowedOrigin, serveAsset(assetsDir)))
	mux.HandleFunc("POST /api/assets/tokens", cors(allowedOrigin, uploadAsset(tokensDir, "/api/assets/tokens/")))
	mux.HandleFunc("GET /api/assets/tokens", cors(allowedOrigin, listAssets(tokensDir, "/api/assets/tokens/")))
	mux.HandleFunc("GET /api/assets/tokens/library", cors(allowedOrigin, getAssetLibrary(tokensDir, libraryPath, "/api/assets/tokens/")))
	mux.HandleFunc("POST /api/assets/tokens/library", cors(allowedOrigin, saveAssetLibrary(tokensDir, libraryPath, "/api/assets/tokens/")))
	mux.HandleFunc("POST /api/assets/tokens/delete", cors(allowedOrigin, deleteAsset(tokensDir)))
	mux.HandleFunc("GET /api/assets/tokens/{file}", cors(allowedOrigin, serveAsset(tokensDir)))
	mux.HandleFunc("POST /api/assets/maps", cors(allowedOrigin, uploadAsset(mapsDir, "/api/assets/maps/")))
	mux.HandleFunc("GET /api/assets/maps/library", cors(allowedOrigin, getAssetLibrary(mapsDir, mapLibraryPath, "/api/assets/maps/")))
	mux.HandleFunc("POST /api/assets/maps/library", cors(allowedOrigin, saveAssetLibrary(mapsDir, mapLibraryPath, "/api/assets/maps/")))
	mux.HandleFunc("POST /api/assets/maps/delete", cors(allowedOrigin, deleteAsset(mapsDir)))
	mux.HandleFunc("GET /api/assets/maps/{file}", cors(allowedOrigin, serveAsset(mapsDir)))
	mux.HandleFunc("GET /api/monsters", cors(allowedOrigin, listMonsters(monstersDir)))
	mux.HandleFunc("GET /api/config", cors(allowedOrigin, serveConfig(cfg)))
	mux.HandleFunc("/", spaHandler(distFS))

	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("butter-roll server listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
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
