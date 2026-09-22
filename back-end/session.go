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
	Tags      []string
	Tokens    map[string]*pb.Token
	FogPolys  map[string]*pb.FogPoly
	HexGrid   *pb.HexGrid
}

// Session holds the authoritative room state.
// It is only ever read or written from hub.Run(), so no mutex is needed.
type Session struct {
	Pages           map[string]*Page
	PageOrder       []string // ordered list of page IDs for display
	PresentedPageID string   // which page /view shows

	// Characters holds every character record (opaque sheet blob plus display
	// name and token image) keyed by its durable character_id. A player
	// (player_id) may own several — one active (archived == false) plus retired
	// sheets. The server stores/relays them (for the DM view and cross-restart
	// persistence) without interpreting the sheet blob.
	Characters map[string]*pb.Character

	// PartyInventory is the room's shared inventory: a single ordered list every
	// player can read and write, owned by no individual player. Kept as a slice
	// (not an id-keyed map like Tokens) because its order is user-controlled via
	// PartyItemReorder. Mutated only from the single-threaded hub loop.
	PartyInventory []*pb.PartyItem

	// PartyWallet is the room's shared coin pool (GP/SP/CP). Nil means all zero.
	// A standalone, freely-editable pool: last-write-wins, no linkage to any
	// character's personal coins.
	PartyWallet *pb.PartyWallet

	// PartySections are the flat (non-nestable) buckets the party inventory can be
	// organized into ("Wagon", "House"). An ordered slice, like PartyInventory;
	// items reference a section by id via PartyItem.SectionId.
	PartySections []*pb.PartySection

	// cfg holds the room's behavior rules, evaluated in Apply. May be nil (no
	// rules) — e.g. in tests that construct a Session directly.
	cfg *Config

	// followups holds extra messages produced by rule side effects during the
	// current Apply (e.g. a tokenStatus when a rule changes a token's statuses).
	// The hub broadcasts these right after the triggering message. Reset at the
	// start of every Apply; only touched from the single-threaded hub loop.
	followups [][]byte

	// outbound holds webhook requests a webhook() action fired during the current
	// Apply. The hub hands them to the dispatcher (async HTTP) after broadcasting.
	// Reset at the start of every Apply; only touched from the hub loop.
	outbound []outboundRequest
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
		Characters:      make(map[string]*pb.Character),
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
			Tags:      p.Tags,
			Tokens:    tokens,
			FogPolys:  fogPolys,
			HexGrid:   p.HexGrid,
		})
	}
	characters := make([]*pb.Character, 0, len(s.Characters))
	for _, ch := range s.Characters {
		characters = append(characters, ch)
	}
	return &pb.Envelope{Payload: &pb.Envelope_Snapshot{Snapshot: &pb.Snapshot{
		PresentedPageId: s.PresentedPageID,
		Pages:           pages,
		Characters:      characters,
		PartyInventory:  s.PartyInventory,
		PartyWallet:     s.PartyWallet,
		PartySections:   s.PartySections,
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
		Characters:      make(map[string]*pb.Character, len(snap.Characters)),
		PartyInventory:  snap.PartyInventory,
		PartyWallet:     snap.PartyWallet,
		PartySections:   snap.PartySections,
	}
	for _, ch := range snap.Characters {
		// Migrate pre-roster snapshots: characters saved before character_id
		// existed were keyed by player_id and are the player's one (active)
		// sheet. Mint an id (reuse player_id, which is unique per active
		// character) so they re-key cleanly and stay active.
		if ch.CharacterId == "" {
			ch.CharacterId = ch.PlayerId
		}
		s.Characters[ch.CharacterId] = ch
	}
	for _, pd := range snap.Pages {
		p := &Page{
			ID:        pd.Id,
			Name:      pd.Name,
			MapURL:    pd.MapUrl,
			MapWidth:  pd.MapWidth,
			MapHeight: pd.MapHeight,
			Tags:      pd.Tags,
			Tokens:    make(map[string]*pb.Token, len(pd.Tokens)),
			FogPolys:  make(map[string]*pb.FogPoly, len(pd.FogPolys)),
			HexGrid:   pd.HexGrid,
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
