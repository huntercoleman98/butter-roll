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

// Session holds the authoritative room state.
// It is only ever read or written from hub.Run(), so no mutex is needed.
type Session struct {
	MapURL    string
	MapWidth  int
	MapHeight int
	Tokens    map[string]Token   // keyed by Token.ID
	FogRects  map[string]FogRect // keyed by FogRect.ID
}

func NewSession() *Session {
	return &Session{
		Tokens:   make(map[string]Token),
		FogRects: make(map[string]FogRect),
	}
}

type snapshotMsg struct {
	Type      string    `json:"type"`
	MapURL    string    `json:"mapUrl"`
	MapWidth  int       `json:"mapWidth"`
	MapHeight int       `json:"mapHeight"`
	Tokens    []Token   `json:"tokens"`
	FogRects  []FogRect `json:"fogRects"`
}

// Snapshot serialises the full current state as a JSON "snapshot" message.
func (s *Session) Snapshot() []byte {
	tokens := make([]Token, 0, len(s.Tokens))
	for _, t := range s.Tokens {
		tokens = append(tokens, t)
	}
	fogRects := make([]FogRect, 0, len(s.FogRects))
	for _, r := range s.FogRects {
		fogRects = append(fogRects, r)
	}
	msg := snapshotMsg{
		Type:      "snapshot",
		MapURL:    s.MapURL,
		MapWidth:  s.MapWidth,
		MapHeight: s.MapHeight,
		Tokens:    tokens,
		FogRects:  fogRects,
	}
	b, err := json.Marshal(msg)
	if err != nil {
		log.Printf("snapshot marshal error: %v", err)
		return nil
	}
	return b
}

// rawMsg is used to dispatch on "type" before full decode.
type rawMsg struct {
	Type string `json:"type"`
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
	ID  string  `json:"id"`
	URL string  `json:"url"`
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
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
		s.MapURL = m.URL
		s.MapWidth = m.Width
		s.MapHeight = m.Height

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
		s.MapWidth = m.Width
		s.MapHeight = m.Height

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
		s.Tokens[m.ID] = Token{ID: m.ID, URL: m.URL, X: m.X, Y: m.Y}

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
		t, ok := s.Tokens[m.ID]
		if !ok {
			log.Printf("session.Apply token_move: unknown token %q", m.ID)
			return false
		}
		t.X = m.X
		t.Y = m.Y
		s.Tokens[m.ID] = t

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
		delete(s.Tokens, m.ID)

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
		t, ok := s.Tokens[m.ID]
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
		s.Tokens[m.ID] = t

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
		s.FogRects[m.ID] = FogRect{ID: m.ID, X: m.X, Y: m.Y, Width: m.Width, Height: m.Height}

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
		delete(s.FogRects, m.ID)

	case "fog_clear":
		s.FogRects = make(map[string]FogRect)

	default:
		log.Printf("session.Apply: unknown type %q", raw.Type)
		return false
	}
	return true
}