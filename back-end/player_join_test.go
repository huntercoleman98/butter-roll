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

func TestPlayerJoinRegistersIdentityAndPlacesNoToken(t *testing.T) {
	s := NewSession()

	// First join registers the player's Character identity and broadcasts it as a
	// characterUpdate — but places no token on any page.
	out, ok := s.Apply(joinMsg("p1", "Alice", "#ff0000", "/a.png", "page-1"))
	if !ok {
		t.Fatal("first join was not broadcast")
	}
	if n := len(playerTokensOf(s.Pages["page-1"], "p1")); n != 0 {
		t.Fatalf("join placed %d tokens, want 0 (DM adds them by clicking)", n)
	}
	ch := s.Characters["p1"]
	if ch == nil || ch.Name != "Alice" || ch.TokenUrl != "/a.png" || ch.Color != "#ff0000" {
		t.Errorf("unexpected character identity: %+v", ch)
	}
	cu := mustEnvelope(t, out).GetCharacterUpdate()
	if cu == nil || cu.PlayerId != "p1" || cu.Name != "Alice" {
		t.Errorf("first join broadcast = %+v, want characterUpdate for p1", cu)
	}

	// Re-join with identical data is a no-op (nothing changed, nothing broadcast).
	if _, ok := s.Apply(joinMsg("p1", "Alice", "#ff0000", "/a.png", "page-1")); ok {
		t.Error("identical re-join should be a no-op (not broadcast)")
	}

	// Re-join with a new name/color updates the identity via a characterUpdate.
	out, ok = s.Apply(joinMsg("p1", "Alice the Bold", "#00ff00", "/a.png", "page-1"))
	if !ok {
		t.Fatal("name/color change should broadcast")
	}
	cu = mustEnvelope(t, out).GetCharacterUpdate()
	if cu == nil || cu.Name != "Alice the Bold" || cu.Color != "#00ff00" {
		t.Errorf("update broadcast = %+v, want characterUpdate with new name/color", cu)
	}
	if s.Characters["p1"].Name != "Alice the Bold" {
		t.Errorf("identity name = %q, want updated", s.Characters["p1"].Name)
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
	// The player already has a character token on the page.
	s.Apply(addTokenMsg("page-1", "orig1", "/a.png", "p1", true))

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
	s.Apply(addTokenMsg("page-1", "orig1", "/a.png", "p1", true))

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
