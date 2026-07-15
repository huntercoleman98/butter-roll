//go:build dev

package main

import (
	"io/fs"
	"log"
)

// In dev mode the frontend is served by Vite; return an empty filesystem.
func getFrontendFS() (fs.FS, error) {
	log.Println("dev mode: frontend served by Vite, not embedded")
	return emptyFS{}, nil
}

type emptyFS struct{}

func (emptyFS) Open(name string) (fs.File, error) {
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}
