//go:build !dev

package main

import (
	"embed"
	"io/fs"
)

//go:embed dist
var frontendFS embed.FS

func getFrontendFS() (fs.FS, error) {
	return fs.Sub(frontendFS, "dist")
}
