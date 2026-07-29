package main

import (
	"testing"

	pb "butter-roll/server/gen/butterroll/v1"

	"google.golang.org/protobuf/encoding/protojson"
)

// joinMsg builds a protojson player_join envelope as the frontend would send it.
func joinMsg(playerID, charID, name, color, url, pageID string) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PlayerJoin{
		PlayerJoin: &pb.PlayerJoin{
			PlayerId: playerID, CharacterId: charID, Name: name, Color: color, TokenUrl: url, PageId: pageID,
		},
	}})
	if !ok {
		panic("marshal join")
	}
	return out
}

// charUpdateMsg builds a protojson character_update envelope as a player's sheet
// push (or an archive-on-switch) would send it.
func charUpdateMsg(playerID, charID, data string, archived bool) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_CharacterUpdate{
		CharacterUpdate: &pb.Character{
			PlayerId: playerID, CharacterId: charID, Data: data, Archived: archived,
		},
	}})
	if !ok {
		panic("marshal character_update")
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

	// First join registers the active character's identity and broadcasts it as a
	// characterUpdate — but places no token on any page.
	out, ok := s.Apply(joinMsg("p1", "c1", "Alice", "#ff0000", "/a.png", "page-1"))
	if !ok {
		t.Fatal("first join was not broadcast")
	}
	if n := len(playerTokensOf(s.Pages["page-1"], "p1")); n != 0 {
		t.Fatalf("join placed %d tokens, want 0 (DM adds them by clicking)", n)
	}
	ch := s.Characters["c1"]
	if ch == nil || ch.PlayerId != "p1" || ch.Name != "Alice" || ch.TokenUrl != "/a.png" || ch.Color != "#ff0000" {
		t.Errorf("unexpected character identity: %+v", ch)
	}
	cu := mustEnvelope(t, out).GetCharacterUpdate()
	if cu == nil || cu.PlayerId != "p1" || cu.CharacterId != "c1" || cu.Name != "Alice" {
		t.Errorf("first join broadcast = %+v, want characterUpdate for p1/c1", cu)
	}

	// Re-join with identical data is a no-op (nothing changed, nothing broadcast).
	if _, ok := s.Apply(joinMsg("p1", "c1", "Alice", "#ff0000", "/a.png", "page-1")); ok {
		t.Error("identical re-join should be a no-op (not broadcast)")
	}

	// Re-join with a new name/color updates the identity via a characterUpdate.
	out, ok = s.Apply(joinMsg("p1", "c1", "Alice the Bold", "#00ff00", "/a.png", "page-1"))
	if !ok {
		t.Fatal("name/color change should broadcast")
	}
	cu = mustEnvelope(t, out).GetCharacterUpdate()
	if cu == nil || cu.Name != "Alice the Bold" || cu.Color != "#00ff00" {
		t.Errorf("update broadcast = %+v, want characterUpdate with new name/color", cu)
	}
	if s.Characters["c1"].Name != "Alice the Bold" {
		t.Errorf("identity name = %q, want updated", s.Characters["c1"].Name)
	}
}

func TestPlayerJoinRejectsInvalid(t *testing.T) {
	s := NewSession()
	if _, ok := s.Apply(joinMsg("", "c1", "Alice", "#fff", "/a.png", "page-1")); ok {
		t.Error("join with empty playerId should be rejected")
	}
	if _, ok := s.Apply(joinMsg("p1", "", "Alice", "#fff", "/a.png", "page-1")); ok {
		t.Error("join with empty characterId should be rejected")
	}
	if _, ok := s.Apply(joinMsg("p1", "c1", "Alice", "#fff", "", "page-1")); ok {
		t.Error("join with empty tokenUrl should be rejected")
	}
}

// TestCharacterSwitchArchivesOldSheet covers a player switching characters: the
// old sheet is archived (kept, not deleted) and a fresh active one takes over.
func TestCharacterSwitchArchivesOldSheet(t *testing.T) {
	s := NewSession()
	s.Apply(joinMsg("p1", "c1", "Thantos", "#ff0000", "/t.png", "page-1"))
	s.Apply(charUpdateMsg("p1", "c1", `{"hp":10}`, false))

	// Switch: archive the old character, then register the new active one.
	s.Apply(charUpdateMsg("p1", "c1", `{"hp":10}`, true))
	s.Apply(joinMsg("p1", "c2", "Reborn", "#00ff00", "/r.png", "page-1"))
	s.Apply(charUpdateMsg("p1", "c2", `{"hp":8}`, false))

	old := s.Characters["c1"]
	if old == nil || !old.Archived || old.Data != `{"hp":10}` {
		t.Errorf("old character not archived-but-kept: %+v", old)
	}
	cur := s.Characters["c2"]
	if cur == nil || cur.Archived || cur.Name != "Reborn" || cur.Data != `{"hp":8}` {
		t.Errorf("new active character wrong: %+v", cur)
	}
	// The retired character is unassociated (shared graveyard); the new active one
	// is still owned by the player.
	if old.PlayerId != "" {
		t.Errorf("retired character should be unassociated, got owner %q", old.PlayerId)
	}
	if cur.PlayerId != "p1" {
		t.Errorf("active character owner = %q, want p1", cur.PlayerId)
	}
}

// TestPlayerRemoveKeepsGraveyard confirms evicting a player drops their active
// characters but leaves retired (unassociated) sheets in the shared graveyard.
func TestPlayerRemoveKeepsGraveyard(t *testing.T) {
	s := NewSession()
	s.Apply(charUpdateMsg("p1", "c1", `{}`, true))  // p1 retired -> unassociated
	s.Apply(charUpdateMsg("p1", "c2", `{}`, false)) // p1 active
	s.Apply(charUpdateMsg("p2", "c3", `{}`, false)) // another player

	rm, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PlayerRemove{
		PlayerRemove: &pb.PlayerRemove{PlayerId: "p1"},
	}})
	if !ok {
		t.Fatal("marshal player_remove")
	}
	s.Apply(rm)

	if _, ok := s.Characters["c1"]; !ok {
		t.Error("retired character should survive player removal (shared graveyard)")
	}
	if _, ok := s.Characters["c2"]; ok {
		t.Error("active character not removed")
	}
	if _, ok := s.Characters["c3"]; !ok {
		t.Error("other player's character wrongly removed")
	}
}

// addTokenMsg builds a protojson token_add envelope with an optional player
// association (owner + character), as the DM's copy/paste and chip-place send.
func addTokenMsg(pageID, id, url, ownerID, charID string, player bool) []byte {
	tok := &pb.Token{Id: id, Url: url, Player: player, CharacterId: charID}
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
	// The character already has a token on the page.
	s.Apply(addTokenMsg("page-1", "orig1", "/a.png", "p1", "cA", true))

	// Pasting a copy of the same character onto the same page: association is
	// stripped and the broadcast carries the corrected (unassociated) token.
	out, ok := s.Apply(addTokenMsg("page-1", "copy1", "/a.png", "p1", "cA", true))
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

// TestTokenAddAllowsDifferentCharacterSameOwner covers the switch case: a
// player's new active character can be placed while a retired character's
// leftover token (same owner, different character) is still on the page.
func TestTokenAddAllowsDifferentCharacterSameOwner(t *testing.T) {
	s := NewSession()
	s.Apply(addTokenMsg("page-1", "retired1", "/old.png", "p1", "cOld", true))

	out, ok := s.Apply(addTokenMsg("page-1", "active1", "/new.png", "p1", "cNew", true))
	if !ok {
		t.Fatal("token_add was rejected")
	}
	if out != nil {
		t.Errorf("expected original rebroadcast (nil out) — different character, no conflict")
	}
	active := s.Pages["page-1"].Tokens["active1"]
	if active == nil || !active.Player || active.GetOwnerPlayerId() != "p1" || active.CharacterId != "cNew" {
		t.Errorf("new active token lost its association: %+v", active)
	}
}

func TestTokenAddKeepsAssociationWithoutConflict(t *testing.T) {
	s := NewSession()
	s.Apply([]byte(`{"pageAdd":{"id":"page-2","name":"Cave"}}`))
	s.Apply(addTokenMsg("page-1", "orig1", "/a.png", "p1", "cA", true))

	// Same character, but a DIFFERENT page with no token yet: association is kept
	// and the original message is rebroadcast (out == nil).
	out, ok := s.Apply(addTokenMsg("page-2", "moved1", "/a.png", "p1", "cA", true))
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
