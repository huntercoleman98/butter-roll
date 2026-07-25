package main

import (
	"errors"
	"log"
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

	// Characters holds each player's sheet as an opaque JSON blob keyed by their
	// durable player_id. The server stores/relays it (for the DM view and cross-
	// restart persistence) without interpreting it.
	Characters map[string]string

	// cfg holds the room's behavior rules, evaluated in Apply. May be nil (no
	// rules) — e.g. in tests that construct a Session directly.
	cfg *Config

	// followups holds extra messages produced by rule side effects during the
	// current Apply (e.g. a tokenStatus when a rule changes a token's statuses).
	// The hub broadcasts these right after the triggering message. Reset at the
	// start of every Apply; only touched from the single-threaded hub loop.
	followups [][]byte
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
		Characters:      make(map[string]string),
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
	characters := make([]*pb.Character, 0, len(s.Characters))
	for pid, data := range s.Characters {
		characters = append(characters, &pb.Character{PlayerId: pid, Data: data})
	}
	return &pb.Envelope{Payload: &pb.Envelope_Snapshot{Snapshot: &pb.Snapshot{
		PresentedPageId: s.PresentedPageID,
		Pages:           pages,
		Characters:      characters,
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
		Characters:      make(map[string]string, len(snap.Characters)),
	}
	for _, ch := range snap.Characters {
		s.Characters[ch.PlayerId] = ch.Data
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
