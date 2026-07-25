package main

import (
	"testing"

	pb "butter-roll/server/gen/butterroll/v1"

	"google.golang.org/protobuf/encoding/protojson"
)

// joinMsg builds a protojson player_join envelope as the frontend would send it.
func joinMsg(playerID, name, color, url, pageID string) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PlayerJoin{
		PlayerJoin: &pb.PlayerJoin{
			PlayerId: playerID, Name: name, Color: color, TokenUrl: url, PageId: pageID,
		},
	}})
	if !ok {
		panic("marshal join")
	}
	return out
}

// playerTokensOf returns the character tokens on a page owned by playerID.
func playerTokensOf(p *Page, playerID string) []*pb.Token {
	var out []*pb.Token
	for _, t := range p.Tokens {
		if t.Player && t.GetOwnerPlayerId() == playerID {
			out = append(out, t)
		}
	}
	return out
}

func TestPlayerJoinCreatesOneTokenAndIsIdempotent(t *testing.T) {
	s := NewSession()
	s.Pages["page-1"].MapWidth = 200
	s.Pages["page-1"].MapHeight = 100

	// First join creates a public, named, player-owned token at the page center.
	out, ok := s.Apply(joinMsg("p1", "Alice", "#ff0000", "/a.png", "page-1"))
	if !ok {
		t.Fatal("first join was not broadcast")
	}
	toks := playerTokensOf(s.Pages["page-1"], "p1")
	if len(toks) != 1 {
		t.Fatalf("after join: %d owned tokens, want 1", len(toks))
	}
	tok := toks[0]
	if !tok.Player || tok.GetOwnerPlayerId() != "p1" || tok.Name != "Alice" ||
		tok.GetColor() != "#ff0000" || !tok.Public || !tok.ShowName {
		t.Errorf("unexpected token: %+v", tok)
	}
	if tok.X != 100 || tok.Y != 50 {
		t.Errorf("token at (%v,%v), want page center (100,50)", tok.X, tok.Y)
	}
	// The broadcast is a tokenAdd carrying the new token.
	if got := mustEnvelope(t, out).GetTokenAdd(); got == nil || got.Token.Id != tok.Id {
		t.Errorf("first join broadcast = %T, want tokenAdd for %s", mustEnvelope(t, out).Payload, tok.Id)
	}

	// Re-join with identical data is a no-op (no duplicate, nothing broadcast).
	if _, ok := s.Apply(joinMsg("p1", "Alice", "#ff0000", "/a.png", "page-1")); ok {
		t.Error("identical re-join should be a no-op (not broadcast)")
	}
	if n := len(playerTokensOf(s.Pages["page-1"], "p1")); n != 1 {
		t.Fatalf("after re-join: %d owned tokens, want 1 (no duplicate)", n)
	}

	// Re-join with a new name/color adopts the same token via a tokenUpdate.
	out, ok = s.Apply(joinMsg("p1", "Alice the Bold", "#00ff00", "/a.png", "page-1"))
	if !ok {
		t.Fatal("name/color change should broadcast")
	}
	if n := len(playerTokensOf(s.Pages["page-1"], "p1")); n != 1 {
		t.Fatalf("after rename: %d owned tokens, want 1", n)
	}
	tu := mustEnvelope(t, out).GetTokenUpdate()
	if tu == nil || tu.GetName() != "Alice the Bold" || tu.GetColor() != "#00ff00" {
		t.Errorf("adopt broadcast = %+v, want tokenUpdate with new name/color", tu)
	}
	if adopted := playerTokensOf(s.Pages["page-1"], "p1")[0]; adopted.Name != "Alice the Bold" {
		t.Errorf("adopted token name = %q, want updated", adopted.Name)
	}
}

func TestPlayerJoinIsPerPage(t *testing.T) {
	s := NewSession()
	s.Apply([]byte(`{"pageAdd":{"id":"page-2","name":"Cave"}}`))

	s.Apply(joinMsg("p1", "Alice", "#fff", "/a.png", "page-1"))
	s.Apply(joinMsg("p1", "Alice", "#fff", "/a.png", "page-2"))

	// Same player gets one token on EACH page (singleton is per-page).
	if n := len(playerTokensOf(s.Pages["page-1"], "p1")); n != 1 {
		t.Errorf("page-1: %d owned tokens, want 1", n)
	}
	if n := len(playerTokensOf(s.Pages["page-2"], "p1")); n != 1 {
		t.Errorf("page-2: %d owned tokens, want 1", n)
	}
}

func TestPlayerJoinScattersMultiplePlayers(t *testing.T) {
	s := NewSession()
	s.Apply(joinMsg("p1", "Alice", "#fff", "/a.png", "page-1"))
	s.Apply(joinMsg("p2", "Bob", "#000", "/b.png", "page-1"))

	a := playerTokensOf(s.Pages["page-1"], "p1")[0]
	b := playerTokensOf(s.Pages["page-1"], "p2")[0]
	if a.X == b.X && a.Y == b.Y {
		t.Errorf("two joiners overlap exactly at (%v,%v)", a.X, a.Y)
	}
}

func TestPlayerJoinRejectsInvalid(t *testing.T) {
	s := NewSession()
	if _, ok := s.Apply(joinMsg("", "Alice", "#fff", "/a.png", "page-1")); ok {
		t.Error("join with empty playerId should be rejected")
	}
	if _, ok := s.Apply(joinMsg("p1", "Alice", "#fff", "", "page-1")); ok {
		t.Error("join with empty tokenUrl should be rejected")
	}
}

// addTokenMsg builds a protojson token_add envelope with an optional player
// association, as the DM's copy/paste sends.
func addTokenMsg(pageID, id, url, ownerID string, player bool) []byte {
	tok := &pb.Token{Id: id, Url: url, Player: player}
	if ownerID != "" {
		tok.OwnerPlayerId = &ownerID
	}
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_TokenAdd{
		TokenAdd: &pb.TokenAdd{PageId: pageID, Token: tok},
	}})
	if !ok {
		panic("marshal token_add")
	}
	return out
}

func TestTokenAddStripsDuplicatePlayerAssociation(t *testing.T) {
	s := NewSession()
	// The player already has a character token on the page (via join).
	s.Apply(joinMsg("p1", "Alice", "#fff", "/a.png", "page-1"))

	// Pasting a copy that claims the same owner on the same page: association is
	// stripped and the broadcast carries the corrected (unassociated) token.
	out, ok := s.Apply(addTokenMsg("page-1", "copy1", "/a.png", "p1", true))
	if !ok {
		t.Fatal("token_add was rejected")
	}
	copyTok := s.Pages["page-1"].Tokens["copy1"]
	if copyTok == nil {
		t.Fatal("copy not stored")
	}
	if copyTok.Player || copyTok.GetOwnerPlayerId() != "" {
		t.Errorf("copy kept association: player=%v owner=%q", copyTok.Player, copyTok.GetOwnerPlayerId())
	}
	if n := len(playerTokensOf(s.Pages["page-1"], "p1")); n != 1 {
		t.Errorf("page-1 has %d owned tokens, want 1 (no duplicate)", n)
	}
	// The rewritten broadcast must reflect the strip so clients don't desync.
	bcast := mustEnvelope(t, out).GetTokenAdd()
	if bcast == nil || bcast.Token.Player || bcast.Token.GetOwnerPlayerId() != "" {
		t.Errorf("broadcast kept association: %+v", bcast.GetToken())
	}
}

func TestTokenAddKeepsAssociationWithoutConflict(t *testing.T) {
	s := NewSession()
	s.Apply([]byte(`{"pageAdd":{"id":"page-2","name":"Cave"}}`))
	s.Apply(joinMsg("p1", "Alice", "#fff", "/a.png", "page-1"))

	// Same owner, but a DIFFERENT page with no token yet: association is kept and
	// the original message is rebroadcast (out == nil).
	out, ok := s.Apply(addTokenMsg("page-2", "moved1", "/a.png", "p1", true))
	if !ok {
		t.Fatal("token_add was rejected")
	}
	if out != nil {
		t.Errorf("expected original rebroadcast (nil out) when no conflict")
	}
	moved := s.Pages["page-2"].Tokens["moved1"]
	if moved == nil || !moved.Player || moved.GetOwnerPlayerId() != "p1" {
		t.Errorf("association not preserved on conflict-free page: %+v", moved)
	}
}

func mustEnvelope(t *testing.T, b []byte) *pb.Envelope {
	t.Helper()
	var env pb.Envelope
	if err := protojson.Unmarshal(b, &env); err != nil {
		t.Fatalf("broadcast is not valid protojson: %v", err)
	}
	return &env
}
