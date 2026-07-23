package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestListMonstersAggregatesSortedByName(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("zzz.json", `{"name":"Aboleth","level":8}`)
	write("aaa.json", `{"name":"Goblin","level":1}`)
	write("bad.json", `[{"name":"ArrayNotSupported"}]`)
	write("junk.json", `not json`)
	write("notes.txt", `ignored`)

	rec := httptest.NewRecorder()
	listMonsters(dir)(rec, httptest.NewRequest("GET", "/api/monsters", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q", cc)
	}
	var got []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d monsters, want 2 (array and junk files skipped)", len(got))
	}
	// Sorted by monster name, not filename.
	if got[0].Name != "Aboleth" || got[1].Name != "Goblin" {
		t.Errorf("got order %q, %q", got[0].Name, got[1].Name)
	}
}

func TestListMonstersEmptyDir(t *testing.T) {
	rec := httptest.NewRecorder()
	listMonsters(t.TempDir())(rec, httptest.NewRequest("GET", "/api/monsters", nil))
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "[]\n" {
		t.Errorf("body = %q, want empty array", body)
	}
}

func TestTokenUpdateMonsterFields(t *testing.T) {
	s := NewSession()
	apply := func(msg string) {
		t.Helper()
		if _, ok := s.Apply([]byte(msg)); !ok {
			t.Fatalf("apply failed: %s", msg)
		}
	}
	apply(`{"tokenAdd":{"pageId":"page-1","token":{"id":"t1","url":"/x.png","x":1,"y":2}}}`)
	apply(`{"tokenUpdate":{"pageId":"page-1","id":"t1","monster":"Goblin","hp":39,"wounds":0}}`)

	tok := s.Pages["page-1"].Tokens["t1"]
	if tok.Monster != "Goblin" || tok.Hp == nil || *tok.Hp != 39 || tok.Wounds == nil || *tok.Wounds != 0 {
		t.Fatalf("after link: %+v", tok)
	}

	apply(`{"tokenUpdate":{"pageId":"page-1","id":"t1","wounds":12}}`)
	tok = s.Pages["page-1"].Tokens["t1"]
	if *tok.Wounds != 12 || *tok.Hp != 39 {
		t.Fatalf("after wound: %+v", tok)
	}

	// Unlink clears the HP tracker.
	apply(`{"tokenUpdate":{"pageId":"page-1","id":"t1","monster":""}}`)
	tok = s.Pages["page-1"].Tokens["t1"]
	if tok.Monster != "" || tok.Hp != nil || tok.Wounds != nil {
		t.Fatalf("after unlink: %+v", tok)
	}
}
