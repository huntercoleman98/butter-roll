package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
)

const allowedOrigin = "http://localhost:5173"

func main() {
	assetsDir := filepath.Join(".", "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		log.Fatalf("cannot create assets dir: %v", err)
	}

	session := NewSession()
	hub := NewHub(session)
	go hub.Run()

	mux := http.NewServeMux()

	mux.HandleFunc("GET /ws", cors(func(w http.ResponseWriter, r *http.Request) {
		serveWS(hub, w, r)
	}))
	mux.HandleFunc("POST /assets", cors(uploadAsset(assetsDir)))
	mux.HandleFunc("GET /assets/{file}", cors(serveAsset(assetsDir)))

	log.Println("butter-roll server listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}

func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}