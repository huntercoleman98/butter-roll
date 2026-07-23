package main

import (
	"errors"
	"log"
	"math"
	"os"

	pb "butter-roll/server/gen/butterroll/v1"

	"google.golang.org/protobuf/encoding/protojson"
)

// Page holds the state for a single map scene. Tokens and FogPolys are kept as
// maps (keyed by id) for O(1) updates; they are flattened to slices only when
// building a wire Snapshot.
type Page struct {
	ID        string
	Name      string
	MapURL    string
	MapWidth  int32
	MapHeight int32
	Tokens    map[string]*pb.Token
	FogPolys  map[string]*pb.FogPoly
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
		Tokens:   make(map[string]*pb.Token),
		FogPolys: make(map[string]*pb.FogPoly),
	}
	return &Session{
		Pages:           map[string]*Page{defaultID: p},
		PageOrder:       []string{defaultID},
		PresentedPageID: defaultID,
	}
}

// marshalOpts keeps the wire format compact and camelCased, matching the JSON
// the protobuf-es client emits/expects.
var marshalOpts = protojson.MarshalOptions{}

// snapshotEnvelope builds the full-state Snapshot as an Envelope.
func (s *Session) snapshotEnvelope() *pb.Envelope {
	pages := make([]*pb.Page, 0, len(s.PageOrder))
	for _, id := range s.PageOrder {
		p, ok := s.Pages[id]
		if !ok {
			continue
		}
		tokens := make([]*pb.Token, 0, len(p.Tokens))
		for _, t := range p.Tokens {
			tokens = append(tokens, t)
		}
		fogPolys := make([]*pb.FogPoly, 0, len(p.FogPolys))
		for _, f := range p.FogPolys {
			fogPolys = append(fogPolys, f)
		}
		pages = append(pages, &pb.Page{
			Id:        p.ID,
			Name:      p.Name,
			MapUrl:    p.MapURL,
			MapWidth:  p.MapWidth,
			MapHeight: p.MapHeight,
			Tokens:    tokens,
			FogPolys:  fogPolys,
		})
	}
	return &pb.Envelope{Payload: &pb.Envelope_Snapshot{Snapshot: &pb.Snapshot{
		PresentedPageId: s.PresentedPageID,
		Pages:           pages,
	}}}
}

// Snapshot serialises the full current state as a protojson "snapshot" Envelope.
func (s *Session) Snapshot() []byte {
	b, err := marshalOpts.Marshal(s.snapshotEnvelope())
	if err != nil {
		log.Printf("snapshot marshal error: %v", err)
		return nil
	}
	return b
}

// HelloMessage builds the per-connection hello Envelope carrying the client id.
func HelloMessage(clientID string) []byte {
	b, err := marshalOpts.Marshal(&pb.Envelope{
		Payload: &pb.Envelope_Hello{Hello: &pb.Hello{ClientId: clientID}},
	})
	if err != nil {
		log.Printf("hello marshal error: %v", err)
		return nil
	}
	return b
}

// Save atomically persists the session to path as protojson.
func (s *Session) Save(path string) error {
	data := s.Snapshot()
	if data == nil {
		return nil
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// LoadSession reads a previously saved session from path.
// If the file does not exist, or cannot be parsed (e.g. an older format), a
// fresh session is returned so a stale file never blocks startup.
func LoadSession(path string) (*Session, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return NewSession(), nil
		}
		return nil, err
	}
	var env pb.Envelope
	if err := protojson.Unmarshal(data, &env); err != nil {
		log.Printf("LoadSession: cannot parse %s (%v); starting fresh", path, err)
		return NewSession(), nil
	}
	snap := env.GetSnapshot()
	if snap == nil {
		log.Printf("LoadSession: %s is not a snapshot; starting fresh", path)
		return NewSession(), nil
	}
	s := &Session{
		Pages:           make(map[string]*Page, len(snap.Pages)),
		PageOrder:       make([]string, 0, len(snap.Pages)),
		PresentedPageID: snap.PresentedPageId,
	}
	for _, pd := range snap.Pages {
		p := &Page{
			ID:        pd.Id,
			Name:      pd.Name,
			MapURL:    pd.MapUrl,
			MapWidth:  pd.MapWidth,
			MapHeight: pd.MapHeight,
			Tokens:    make(map[string]*pb.Token, len(pd.Tokens)),
			FogPolys:  make(map[string]*pb.FogPoly, len(pd.FogPolys)),
		}
		for _, t := range pd.Tokens {
			p.Tokens[t.Id] = t
		}
		for _, f := range pd.FogPolys {
			p.FogPolys[f.Id] = f
		}
		s.Pages[p.ID] = p
		s.PageOrder = append(s.PageOrder, p.ID)
	}
	if len(s.Pages) == 0 {
		return NewSession(), nil
	}
	return s, nil
}

func finiteFloat(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}

// Apply parses and validates an incoming Envelope, mutates session state, and
// returns (toSend, true) if the message should be broadcast. toSend is nil to
// broadcast the original message bytes, or non-nil bytes to broadcast instead.
func (s *Session) Apply(msg []byte) ([]byte, bool) {
	var env pb.Envelope
	if err := protojson.Unmarshal(msg, &env); err != nil {
		log.Printf("session.Apply: bad protojson: %v", err)
		return nil, false
	}

	// Page-management and ephemeral messages: no pageId lookup required.
	switch p := env.Payload.(type) {
	case *pb.Envelope_PageAdd:
		m := p.PageAdd
		if m.Id == "" || m.Name == "" {
			log.Printf("session.Apply page_add: invalid payload (id=%q name=%q)", m.Id, m.Name)
			return nil, false
		}
		if _, exists := s.Pages[m.Id]; exists {
			log.Printf("session.Apply page_add: duplicate id %q", m.Id)
			return nil, false
		}
		s.Pages[m.Id] = &Page{
			ID:       m.Id,
			Name:     m.Name,
			Tokens:   make(map[string]*pb.Token),
			FogPolys: make(map[string]*pb.FogPoly),
		}
		s.PageOrder = append(s.PageOrder, m.Id)
		return nil, true

	case *pb.Envelope_PageRemove:
		m := p.PageRemove
		if m.Id == "" {
			log.Printf("session.Apply page_remove: empty id")
			return nil, false
		}
		if len(s.Pages) <= 1 {
			log.Printf("session.Apply page_remove: cannot remove last page")
			return nil, false
		}
		delete(s.Pages, m.Id)
		for i, id := range s.PageOrder {
			if id == m.Id {
				s.PageOrder = append(s.PageOrder[:i], s.PageOrder[i+1:]...)
				break
			}
		}
		if s.PresentedPageID == m.Id {
			s.PresentedPageID = s.PageOrder[0]
		}
		return nil, true

	case *pb.Envelope_PageRename:
		m := p.PageRename
		if m.Id == "" || m.Name == "" {
			log.Printf("session.Apply page_rename: invalid payload")
			return nil, false
		}
		page, ok := s.Pages[m.Id]
		if !ok {
			log.Printf("session.Apply page_rename: unknown page %q", m.Id)
			return nil, false
		}
		page.Name = m.Name
		return nil, true

	case *pb.Envelope_PagePresent:
		m := p.PagePresent
		if m.Id == "" {
			log.Printf("session.Apply page_present: empty id")
			return nil, false
		}
		if _, ok := s.Pages[m.Id]; !ok {
			log.Printf("session.Apply page_present: unknown page %q", m.Id)
			return nil, false
		}
		s.PresentedPageID = m.Id
		return nil, true

	case *pb.Envelope_ArrowUpdate:
		m := p.ArrowUpdate
		if !finiteFloat(m.X1) || !finiteFloat(m.Y1) || !finiteFloat(m.X2) || !finiteFloat(m.Y2) {
			log.Printf("session.Apply arrow_update: non-finite coordinates")
			return nil, false
		}
		return nil, true // ephemeral

	case *pb.Envelope_ArrowClear:
		return nil, true // ephemeral

	case *pb.Envelope_RadiusUpdate:
		m := p.RadiusUpdate
		if !finiteFloat(m.X) || !finiteFloat(m.Y) || !finiteFloat(m.X2) || !finiteFloat(m.Y2) {
			log.Printf("session.Apply radius_update: invalid payload")
			return nil, false
		}
		return nil, true // ephemeral

	case *pb.Envelope_RadiusClear:
		return nil, true // ephemeral

	case *pb.Envelope_Ping:
		m := p.Ping
		if !finiteFloat(m.X) || !finiteFloat(m.Y) {
			log.Printf("session.Apply ping: non-finite coordinates")
			return nil, false
		}
		return nil, true // ephemeral

	case *pb.Envelope_ViewportSync:
		m := p.ViewportSync
		if !finiteFloat(m.WorldCenterX) || !finiteFloat(m.WorldCenterY) || !finiteFloat(m.Scale) || m.Scale <= 0 {
			log.Printf("session.Apply viewport_sync: invalid payload")
			return nil, false
		}
		return nil, true // ephemeral

	case *pb.Envelope_DiceRollRequest:
		if p.DiceRollRequest.Expression == "" {
			return nil, false
		}
		return nil, true // ephemeral

	case *pb.Envelope_DiceRollResult:
		m := p.DiceRollResult
		if m.Expression == "" || m.Sides == 0 || len(m.Rolls) == 0 {
			log.Printf("session.Apply dice_roll_result: invalid payload")
			return nil, false
		}
		return nil, true // ephemeral
	}

	// All remaining messages target a specific page. Resolve it once.
	pageID, ok := pageIDOf(&env)
	if !ok {
		log.Printf("session.Apply: unhandled message type %T", env.Payload)
		return nil, false
	}
	page, ok := s.Pages[pageID]
	if !ok {
		log.Printf("session.Apply: unknown pageId %q for %T", pageID, env.Payload)
		return nil, false
	}

	switch p := env.Payload.(type) {
	case *pb.Envelope_MapSet:
		m := p.MapSet
		if m.Url == "" || m.Width <= 0 || m.Height <= 0 {
			log.Printf("session.Apply map_set: invalid payload (url=%q w=%d h=%d)", m.Url, m.Width, m.Height)
			return nil, false
		}
		page.MapURL = m.Url
		page.MapWidth = m.Width
		page.MapHeight = m.Height

	case *pb.Envelope_MapResize:
		m := p.MapResize
		if m.Width <= 0 || m.Height <= 0 {
			log.Printf("session.Apply map_resize: invalid dimensions (%dx%d)", m.Width, m.Height)
			return nil, false
		}
		page.MapWidth = m.Width
		page.MapHeight = m.Height

	case *pb.Envelope_TokenAdd:
		t := p.TokenAdd.Token
		if t == nil || t.Id == "" || t.Url == "" || !finiteFloat(t.X) || !finiteFloat(t.Y) {
			log.Printf("session.Apply token_add: invalid payload")
			return nil, false
		}
		page.Tokens[t.Id] = t

	case *pb.Envelope_TokenMove:
		m := p.TokenMove
		if m.Id == "" || !finiteFloat(m.X) || !finiteFloat(m.Y) {
			log.Printf("session.Apply token_move: invalid payload (id=%q)", m.Id)
			return nil, false
		}
		t, ok := page.Tokens[m.Id]
		if !ok {
			log.Printf("session.Apply token_move: unknown token %q", m.Id)
			return nil, false
		}
		t.X = m.X
		t.Y = m.Y

	case *pb.Envelope_TokenRemove:
		m := p.TokenRemove
		if m.Id == "" {
			log.Printf("session.Apply token_remove: empty id")
			return nil, false
		}
		delete(page.Tokens, m.Id)

	case *pb.Envelope_TokenUpdate:
		m := p.TokenUpdate
		if m.Id == "" {
			log.Printf("session.Apply token_update: empty id")
			return nil, false
		}
		t, ok := page.Tokens[m.Id]
		if !ok {
			log.Printf("session.Apply token_update: unknown token %q", m.Id)
			return nil, false
		}
		if m.Color != nil {
			t.Color = m.Color
		}
		if m.BorderWidth != nil {
			t.BorderWidth = m.BorderWidth
		}
		if m.Name != nil {
			t.Name = *m.Name
		}
		if m.ShowName != nil {
			t.ShowName = *m.ShowName
		}
		if m.Public != nil {
			t.Public = *m.Public
		}
		if m.Hp != nil {
			t.Hp = m.Hp
		}
		if m.Wounds != nil {
			t.Wounds = m.Wounds
		}
		if m.Monster != nil {
			t.Monster = *m.Monster
			// Unlinking clears the HP tracker.
			if t.Monster == "" {
				t.Hp = nil
				t.Wounds = nil
			}
		}

	case *pb.Envelope_TokenStatus:
		m := p.TokenStatus
		if m.Id == "" {
			log.Printf("session.Apply token_status: empty id")
			return nil, false
		}
		t, ok := page.Tokens[m.Id]
		if !ok {
			log.Printf("session.Apply token_status: unknown token %q", m.Id)
			return nil, false
		}
		t.StatusEffects = m.StatusEffects

	case *pb.Envelope_FogAdd:
		m := p.FogAdd
		if m.Id == "" || len(m.Points) < 6 || len(m.Points)%2 != 0 {
			log.Printf("session.Apply fog_add: invalid payload (id=%q npts=%d)", m.Id, len(m.Points))
			return nil, false
		}
		for _, v := range m.Points {
			if !finiteFloat(v) {
				log.Printf("session.Apply fog_add: non-finite vertex (id=%q)", m.Id)
				return nil, false
			}
		}
		page.FogPolys[m.Id] = &pb.FogPoly{Id: m.Id, Points: m.Points}

	case *pb.Envelope_FogRemove:
		m := p.FogRemove
		if m.Id == "" {
			log.Printf("session.Apply fog_remove: empty id")
			return nil, false
		}
		delete(page.FogPolys, m.Id)

	case *pb.Envelope_FogClear:
		page.FogPolys = make(map[string]*pb.FogPoly)

	default:
		log.Printf("session.Apply: unhandled message type %T", env.Payload)
		return nil, false
	}
	return nil, true
}

// pageIDOf returns the pageId of a page-scoped message, or ("", false) if the
// message type is not page-scoped.
func pageIDOf(env *pb.Envelope) (string, bool) {
	switch p := env.Payload.(type) {
	case *pb.Envelope_MapSet:
		return p.MapSet.PageId, true
	case *pb.Envelope_MapResize:
		return p.MapResize.PageId, true
	case *pb.Envelope_TokenAdd:
		return p.TokenAdd.PageId, true
	case *pb.Envelope_TokenMove:
		return p.TokenMove.PageId, true
	case *pb.Envelope_TokenRemove:
		return p.TokenRemove.PageId, true
	case *pb.Envelope_TokenUpdate:
		return p.TokenUpdate.PageId, true
	case *pb.Envelope_TokenStatus:
		return p.TokenStatus.PageId, true
	case *pb.Envelope_FogAdd:
		return p.FogAdd.PageId, true
	case *pb.Envelope_FogRemove:
		return p.FogRemove.PageId, true
	case *pb.Envelope_FogClear:
		return p.FogClear.PageId, true
	}
	return "", false
}
