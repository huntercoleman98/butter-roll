package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxUploadBytes = 32 << 20 // 32 MB

// uploadAsset returns a handler that accepts a multipart image upload,
// stores it under assetsDir, and returns the public URL as JSON.
func uploadAsset(assetsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
		if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
			http.Error(w, "bad multipart form", http.StatusBadRequest)
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "missing 'file' field", http.StatusBadRequest)
			return
		}
		defer file.Close()

		ext := strings.ToLower(filepath.Ext(header.Filename))
		if ext == "" {
			ext = ".bin"
		}

		allowed := map[string]bool{
			".jpg": true, ".jpeg": true, ".png": true,
			".gif": true, ".webp": true, ".svg": true,
		}
		if !allowed[ext] {
			http.Error(w, "unsupported file type", http.StatusBadRequest)
			return
		}

		id, err := newUUID()
		if err != nil {
			log.Printf("assets: generate uuid: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		filename := id + ext
		dst := filepath.Join(assetsDir, filename)

		out, err := os.Create(dst)
		if err != nil {
			log.Printf("assets: create file: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		defer out.Close()

		if _, err = io.Copy(out, file); err != nil {
			log.Printf("assets: write file: %v", err)
			os.Remove(dst)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		publicURL := "/api/assets/" + filename
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"url": publicURL})
	}
}

// serveAsset returns a handler that serves files from assetsDir.
// filepath.Base prevents path traversal attacks.
func serveAsset(assetsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := filepath.Base(r.PathValue("file"))
		if name == "." || name == string(filepath.Separator) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.ServeFile(w, r, filepath.Join(assetsDir, name))
	}
}

// newUUID returns a random UUID v4 string using crypto/rand.
func newUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return "", fmt.Errorf("newUUID: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant bits
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}