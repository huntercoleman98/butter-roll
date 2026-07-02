package main

import (
	"encoding/json"
	"log"
	"math"
)

// Token mirrors the frontend TokenData shape.
// X and Y are float64 to match JavaScript numbers exactly.
type Token struct {
	ID          string  `json:"id"`
	URL         string  `json:"url"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Color       string  `json:"color,omitempty"`
	BorderWidth int     `json:"borderWidth,omitempty"`
}

// FogRect is one revealed rectangle cut out of the fog overlay.
type FogRect struct {
	ID     string  `json:"id"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// Page holds the state for a single map scene.
type Page struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	MapURL    string             `json:"mapUrl"`
	MapWidth  int                `json:"mapWidth"`
	MapHeight int                `json:"mapHeight"`
	Tokens    map[string]Token   `json:"tokens"`
	FogRects  map[string]FogRect `json:"fogRects"`
}

// Session holds the authoritative room state.
// It is only ever read or written from hub.Run(), so no mutex is needed.
type Session struct {
	Pages           map[string]*Page
	PageOrder       []string // ordered list of page IDs for display
	PresentedPageID string   // which page /view shows
}

func NewSession() *Session {
	const defaultID = "page-1"
	p := &Page{
		ID:       defaultID,
		Name:     "Page 1",
		Tokens:   make(map[string]Token),
		FogRects: make(map[string]FogRect),
	}
	return &Session{
		Pages:           map[string]*Page{defaultID: p},
		PageOrder:       []string{defaultID},
		PresentedPageID: defaultID,
	}
}

// snapshotPageData is the wire format for a single page in a snapshot.
type snapshotPageData struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	MapURL    string    `json:"mapUrl"`
	MapWidth  int       `json:"mapWidth"`
	MapHeight int       `json:"mapHeight"`
	Tokens    []Token   `json:"tokens"`
	FogRects  []FogRect `json:"fogRects"`
}

type snapshotMsg struct {
	Type            string             `json:"type"`
	PresentedPageID string             `json:"presentedPageId"`
	Pages           []snapshotPageData `json:"pages"`
}

// Snapshot serialises the full current state as a JSON "snapshot" message.
func (s *Session) Snapshot() []byte {
	pages := make([]snapshotPageData, 0, len(s.PageOrder))
	for _, id := range s.PageOrder {
		p, ok := s.Pages[id]
		if !ok {
			continue
		}
		tokens := make([]Token, 0, len(p.Tokens))
		for _, t := range p.Tokens {
			tokens = append(tokens, t)
		}
		fogRects := make([]FogRect, 0, len(p.FogRects))
		for _, r := range p.FogRects {
			fogRects = append(fogRects, r)
		}
		pages = append(pages, snapshotPageData{
			ID:        p.ID,
			Name:      p.Name,
			MapURL:    p.MapURL,
			MapWidth:  p.MapWidth,
			MapHeight: p.MapHeight,
			Tokens:    tokens,
			FogRects:  fogRects,
		})
	}
	msg := snapshotMsg{
		Type:            "snapshot",
		PresentedPageID: s.PresentedPageID,
		Pages:           pages,
	}
	b, err := json.Marshal(msg)
	if err != nil {
		log.Printf("snapshot marshal error: %v", err)
		return nil
	}
	return b
}

// rawMsg is used to dispatch on "type" and route by "pageId" before full decode.
type rawMsg struct {
	Type   string `json:"type"`
	PageID string `json:"pageId"`
}

type mapSetMsg struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type mapResizeMsg struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type tokenAddMsg struct {
	ID          string  `json:"id"`
	URL         string  `json:"url"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Color       string  `json:"color,omitempty"`
	BorderWidth int     `json:"borderWidth,omitempty"`
}

type tokenMoveMsg struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

type tokenRemoveMsg struct {
	ID string `json:"id"`
}

type tokenUpdateMsg struct {
	ID          string  `json:"id"`
	Color       *string `json:"color"`
	BorderWidth *int    `json:"borderWidth"`
}

type fogAddMsg struct {
	ID     string  `json:"id"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type fogRemoveMsg struct {
	ID string `json:"id"`
}

type pageAddMsg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type pageRemoveMsg struct {
	ID string `json:"id"`
}

type pageRenameMsg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type pagePresentMsg struct {
	ID string `json:"id"`
}

type arrowUpdateMsg struct {
	X1 float64 `json:"x1"`
	Y1 float64 `json:"y1"`
	X2 float64 `json:"x2"`
	Y2 float64 `json:"y2"`
}

type pingMsg struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type radiusUpdateMsg struct {
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	X2 float64 `json:"x2"`
	Y2 float64 `json:"y2"`
}

func finiteFloat(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}

// Apply parses and validates an incoming message, mutates session state, and
// returns true if the message should be broadcast to other clients.
func (s *Session) Apply(msg []byte) bool {
	var raw rawMsg
	if err := json.Unmarshal(msg, &raw); err != nil {
		log.Printf("session.Apply: bad JSON: %v", err)
		return false
	}

	// Page management messages — no pageId needed.
	switch raw.Type {
	case "page_add":
		var m pageAddMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply page_add: %v", err)
			return false
		}
		if m.ID == "" || m.Name == "" {
			log.Printf("session.Apply page_add: invalid payload (id=%q name=%q)", m.ID, m.Name)
			return false
		}
		if _, exists := s.Pages[m.ID]; exists {
			log.Printf("session.Apply page_add: duplicate id %q", m.ID)
			return false
		}
		s.Pages[m.ID] = &Page{
			ID:       m.ID,
			Name:     m.Name,
			Tokens:   make(map[string]Token),
			FogRects: make(map[string]FogRect),
		}
		s.PageOrder = append(s.PageOrder, m.ID)
		return true

	case "page_remove":
		var m pageRemoveMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply page_remove: %v", err)
			return false
		}
		if m.ID == "" {
			log.Printf("session.Apply page_remove: empty id")
			return false
		}
		if len(s.Pages) <= 1 {
			log.Printf("session.Apply page_remove: cannot remove last page")
			return false
		}
		delete(s.Pages, m.ID)
		for i, id := range s.PageOrder {
			if id == m.ID {
				s.PageOrder = append(s.PageOrder[:i], s.PageOrder[i+1:]...)
				break
			}
		}
		if s.PresentedPageID == m.ID {
			s.PresentedPageID = s.PageOrder[0]
		}
		return true

	case "page_rename":
		var m pageRenameMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply page_rename: %v", err)
			return false
		}
		if m.ID == "" || m.Name == "" {
			log.Printf("session.Apply page_rename: invalid payload")
			return false
		}
		p, ok := s.Pages[m.ID]
		if !ok {
			log.Printf("session.Apply page_rename: unknown page %q", m.ID)
			return false
		}
		p.Name = m.Name
		return true

	case "page_present":
		var m pagePresentMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply page_present: %v", err)
			return false
		}
		if m.ID == "" {
			log.Printf("session.Apply page_present: empty id")
			return false
		}
		if _, ok := s.Pages[m.ID]; !ok {
			log.Printf("session.Apply page_present: unknown page %q", m.ID)
			return false
		}
		s.PresentedPageID = m.ID
		return true

	case "arrow_update":
		var m arrowUpdateMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply arrow_update: %v", err)
			return false
		}
		if !finiteFloat(m.X1) || !finiteFloat(m.Y1) || !finiteFloat(m.X2) || !finiteFloat(m.Y2) {
			log.Printf("session.Apply arrow_update: non-finite coordinates")
			return false
		}
		return true // ephemeral: broadcast without mutating session state

	case "arrow_clear":
		return true // ephemeral: broadcast without mutating session state

	case "radius_update":
		var m radiusUpdateMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply radius_update: %v", err)
			return false
		}
		if !finiteFloat(m.X) || !finiteFloat(m.Y) || !finiteFloat(m.X2) || !finiteFloat(m.Y2) {
			log.Printf("session.Apply radius_update: invalid payload")
			return false
		}
		return true // ephemeral: broadcast without mutating session state

	case "radius_clear":
		return true // ephemeral: broadcast without mutating session state

	case "ping":
		var m pingMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply ping: %v", err)
			return false
		}
		if !finiteFloat(m.X) || !finiteFloat(m.Y) {
			log.Printf("session.Apply ping: non-finite coordinates")
			return false
		}
		return true // ephemeral: broadcast without mutating session state
	}

	// All other messages require a valid pageId.
	page, ok := s.Pages[raw.PageID]
	if !ok {
		log.Printf("session.Apply: unknown pageId %q for type %q", raw.PageID, raw.Type)
		return false
	}

	switch raw.Type {
	case "map_set":
		var m mapSetMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply map_set: %v", err)
			return false
		}
		if m.URL == "" || m.Width <= 0 || m.Height <= 0 {
			log.Printf("session.Apply map_set: invalid payload (url=%q w=%d h=%d)", m.URL, m.Width, m.Height)
			return false
		}
		page.MapURL = m.URL
		page.MapWidth = m.Width
		page.MapHeight = m.Height

	case "map_resize":
		var m mapResizeMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply map_resize: %v", err)
			return false
		}
		if m.Width <= 0 || m.Height <= 0 {
			log.Printf("session.Apply map_resize: invalid dimensions (%dx%d)", m.Width, m.Height)
			return false
		}
		page.MapWidth = m.Width
		page.MapHeight = m.Height

	case "token_add":
		var m tokenAddMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply token_add: %v", err)
			return false
		}
		if m.ID == "" || m.URL == "" || !finiteFloat(m.X) || !finiteFloat(m.Y) {
			log.Printf("session.Apply token_add: invalid payload (id=%q url=%q)", m.ID, m.URL)
			return false
		}
		page.Tokens[m.ID] = Token{ID: m.ID, URL: m.URL, X: m.X, Y: m.Y, Color: m.Color, BorderWidth: m.BorderWidth}

	case "token_move":
		var m tokenMoveMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply token_move: %v", err)
			return false
		}
		if m.ID == "" || !finiteFloat(m.X) || !finiteFloat(m.Y) {
			log.Printf("session.Apply token_move: invalid payload (id=%q)", m.ID)
			return false
		}
		t, ok := page.Tokens[m.ID]
		if !ok {
			log.Printf("session.Apply token_move: unknown token %q", m.ID)
			return false
		}
		t.X = m.X
		t.Y = m.Y
		page.Tokens[m.ID] = t

	case "token_remove":
		var m tokenRemoveMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply token_remove: %v", err)
			return false
		}
		if m.ID == "" {
			log.Printf("session.Apply token_remove: empty id")
			return false
		}
		delete(page.Tokens, m.ID)

	case "token_update":
		var m tokenUpdateMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply token_update: %v", err)
			return false
		}
		if m.ID == "" {
			log.Printf("session.Apply token_update: empty id")
			return false
		}
		t, ok := page.Tokens[m.ID]
		if !ok {
			log.Printf("session.Apply token_update: unknown token %q", m.ID)
			return false
		}
		if m.Color != nil {
			t.Color = *m.Color
		}
		if m.BorderWidth != nil {
			t.BorderWidth = *m.BorderWidth
		}
		page.Tokens[m.ID] = t

	case "fog_add":
		var m fogAddMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply fog_add: %v", err)
			return false
		}
		if m.ID == "" || m.Width <= 0 || m.Height <= 0 || !finiteFloat(m.X) || !finiteFloat(m.Y) {
			log.Printf("session.Apply fog_add: invalid payload (id=%q w=%f h=%f)", m.ID, m.Width, m.Height)
			return false
		}
		page.FogRects[m.ID] = FogRect{ID: m.ID, X: m.X, Y: m.Y, Width: m.Width, Height: m.Height}

	case "fog_remove":
		var m fogRemoveMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			log.Printf("session.Apply fog_remove: %v", err)
			return false
		}
		if m.ID == "" {
			log.Printf("session.Apply fog_remove: empty id")
			return false
		}
		delete(page.FogRects, m.ID)

	case "fog_clear":
		page.FogRects = make(map[string]FogRect)

	default:
		log.Printf("session.Apply: unknown type %q", raw.Type)
		return false
	}
	return true
}
