package main

import (
	"testing"

	pb "butter-roll/server/gen/butterroll/v1"

	"google.golang.org/protobuf/encoding/protojson"
)

// TestWireCompatProtobufEs guards cross-language protojson compatibility. The
// input string was produced by the frontend's protobuf-es toJsonString, so this
// pins the exact shape the Go server must accept:
//   - a singular scalar left at its default (x=0) is omitted on the wire and
//     must decode back to 0
//   - an `optional` scalar explicitly set to 0 (borderWidth) IS present and must
//     decode as a set pointer, not nil
//   - optional hp is carried through
func TestWireCompatProtobufEs(t *testing.T) {
	const tsEncoded = `{"tokenAdd":{"pageId":"page-1","token":{"id":"t1","url":"/x.png","y":12.5,"borderWidth":0,"statusEffects":["poisoned"],"hp":39}}}`

	s := NewSession()
	if _, ok := s.Apply([]byte(tsEncoded)); !ok {
		t.Fatal("Apply rejected protobuf-es message")
	}
	tok := s.Pages["page-1"].Tokens["t1"]
	if tok == nil {
		t.Fatal("token not stored")
	}
	if tok.X != 0 {
		t.Errorf("x = %v, want 0 (omitted singular round-trips to 0)", tok.X)
	}
	if tok.BorderWidth == nil || *tok.BorderWidth != 0 {
		t.Errorf("borderWidth = %v, want explicit 0", tok.BorderWidth)
	}
	if tok.Hp == nil || *tok.Hp != 39 {
		t.Errorf("hp = %v, want 39", tok.Hp)
	}
	if len(tok.StatusEffects) != 1 || tok.StatusEffects[0] != "poisoned" {
		t.Errorf("statusEffects = %v", tok.StatusEffects)
	}

	// The snapshot the server emits must itself be valid protojson that decodes
	// back to the same token (this is what every client parses on connect).
	var env pb.Envelope
	if err := protojson.Unmarshal(s.Snapshot(), &env); err != nil {
		t.Fatalf("snapshot is not valid protojson: %v", err)
	}
	snapTok := env.GetSnapshot().GetPages()[0].GetTokens()[0]
	if snapTok.GetY() != 12.5 || snapTok.GetBorderWidth() != 0 || snapTok.GetHp() != 39 {
		t.Errorf("snapshot token round-trip mismatch: %+v", snapTok)
	}
}
