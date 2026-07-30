package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// listMonsters returns a handler that aggregates every *.json file in
// monstersDir (one monster per file) into a single array sorted by name.
// Files that fail to parse are skipped so one bad file can't break the list.
func listMonsters(monstersDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		entries, err := os.ReadDir(monstersDir)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		type namedMonster struct {
			name string
			raw  json.RawMessage
		}
		monsters := make([]namedMonster, 0, len(entries))
		for _, e := range entries {
			if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".json") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(monstersDir, e.Name()))
			if err != nil {
				log.Printf("monsters: cannot read %s: %v", e.Name(), err)
				continue
			}
			// One monster per file: must be a JSON object with a name.
			var probe struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(data, &probe); err != nil || probe.Name == "" {
				log.Printf("monsters: skipping %s: not a single-monster JSON object", e.Name())
				continue
			}
			monsters = append(monsters, namedMonster{name: probe.Name, raw: json.RawMessage(data)})
		}
		sort.Slice(monsters, func(i, j int) bool { return monsters[i].name < monsters[j].name })
		out := make([]json.RawMessage, len(monsters))
		for i, m := range monsters {
			out[i] = m.raw
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(out)
	}
}
