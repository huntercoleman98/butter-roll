package main

import (
	"testing"

	pb "butter-roll/server/gen/butterroll/v1"
)

func partyAddMsg(id, name string, qty, slots int32) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartyItemAdd{
		PartyItemAdd: &pb.PartyItemAdd{
			Item: &pb.PartyItem{Id: id, Name: name, Qty: qty, SlotsEach: slots},
		},
	}})
	if !ok {
		panic("marshal party_item_add")
	}
	return out
}

func partyUpdateMsg(id string, qty int32) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartyItemUpdate{
		PartyItemUpdate: &pb.PartyItemUpdate{Id: id, Qty: &qty},
	}})
	if !ok {
		panic("marshal party_item_update")
	}
	return out
}

func partyReorderMsg(ids ...string) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartyItemReorder{
		PartyItemReorder: &pb.PartyItemReorder{Ids: ids},
	}})
	if !ok {
		panic("marshal party_item_reorder")
	}
	return out
}

func partyRemoveMsg(id string) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartyItemRemove{
		PartyItemRemove: &pb.PartyItemRemove{Id: id},
	}})
	if !ok {
		panic("marshal party_item_remove")
	}
	return out
}

func partyIDs(s *Session) []string {
	ids := make([]string, len(s.PartyInventory))
	for i, it := range s.PartyInventory {
		ids[i] = it.Id
	}
	return ids
}

// TestPartyInventoryLifecycle walks a party item through add → update → reorder →
// remove, the full set of shared-inventory ops.
func TestPartyInventoryLifecycle(t *testing.T) {
	s := NewSession()

	if _, ok := s.Apply(partyAddMsg("i1", "Rope", 1, 1)); !ok {
		t.Fatal("party_item_add was not broadcast")
	}
	s.Apply(partyAddMsg("i2", "Torch", 5, 1))
	if got := partyIDs(s); len(got) != 2 || got[0] != "i1" || got[1] != "i2" {
		t.Fatalf("after adds, order = %v, want [i1 i2]", got)
	}

	// Update merges a single field, leaving the rest intact.
	if _, ok := s.Apply(partyUpdateMsg("i2", 6)); !ok {
		t.Fatal("party_item_update was not broadcast")
	}
	if s.PartyInventory[1].Qty != 6 || s.PartyInventory[1].Name != "Torch" {
		t.Errorf("update clobbered fields: %+v", s.PartyInventory[1])
	}

	// Reorder puts i2 first; unknown ids are ignored.
	s.Apply(partyReorderMsg("i2", "i1", "ghost"))
	if got := partyIDs(s); len(got) != 2 || got[0] != "i2" || got[1] != "i1" {
		t.Fatalf("after reorder, order = %v, want [i2 i1]", got)
	}

	// A reorder that omits a current item still keeps it (racing add safety).
	s.Apply(partyReorderMsg("i1"))
	if got := partyIDs(s); len(got) != 2 || got[0] != "i1" || got[1] != "i2" {
		t.Fatalf("omitted item dropped: order = %v, want [i1 i2]", got)
	}

	if _, ok := s.Apply(partyRemoveMsg("i1")); !ok {
		t.Fatal("party_item_remove was not broadcast")
	}
	if got := partyIDs(s); len(got) != 1 || got[0] != "i2" {
		t.Fatalf("after remove, order = %v, want [i2]", got)
	}
}

func TestPartyInventoryRejectsInvalid(t *testing.T) {
	s := NewSession()
	if _, ok := s.Apply(partyAddMsg("", "Rope", 1, 1)); ok {
		t.Error("add with empty id should be rejected")
	}
	if _, ok := s.Apply(partyUpdateMsg("nope", 3)); ok {
		t.Error("update of unknown id should be rejected")
	}
	if _, ok := s.Apply(partyRemoveMsg("nope")); ok {
		t.Error("remove of unknown id should be rejected")
	}
}

func partySectionAddMsg(id, name string) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartySectionAdd{
		PartySectionAdd: &pb.PartySectionAdd{Section: &pb.PartySection{Id: id, Name: name}},
	}})
	if !ok {
		panic("marshal party_section_add")
	}
	return out
}

func partyItemSectionMsg(id, sectionID string) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartyItemUpdate{
		PartyItemUpdate: &pb.PartyItemUpdate{Id: id, SectionId: &sectionID},
	}})
	if !ok {
		panic("marshal party_item_update section")
	}
	return out
}

func sectionIDs(s *Session) []string {
	ids := make([]string, len(s.PartySections))
	for i, sec := range s.PartySections {
		ids[i] = sec.Id
	}
	return ids
}

func itemByID(s *Session, id string) *pb.PartyItem {
	for _, it := range s.PartyInventory {
		if it.Id == id {
			return it
		}
	}
	return nil
}

// TestPartySectionLifecycle covers add → move item in → rename → reorder →
// remove, where remove orphans the section's items back to unsorted.
func TestPartySectionLifecycle(t *testing.T) {
	s := NewSession()
	s.Apply(partyAddMsg("i1", "Tent", 1, 2))
	if _, ok := s.Apply(partySectionAddMsg("s1", "Wagon")); !ok {
		t.Fatal("party_section_add was not broadcast")
	}
	s.Apply(partySectionAddMsg("s2", "House"))
	if got := sectionIDs(s); len(got) != 2 || got[0] != "s1" || got[1] != "s2" {
		t.Fatalf("sections = %v, want [s1 s2]", got)
	}

	// Move the item into Wagon via a partyItemUpdate.
	if _, ok := s.Apply(partyItemSectionMsg("i1", "s1")); !ok {
		t.Fatal("item section update was not broadcast")
	}
	if it := itemByID(s, "i1"); it == nil || it.SectionId != "s1" {
		t.Fatalf("item section = %q, want s1", itemByID(s, "i1").GetSectionId())
	}

	// Rename + reorder.
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartySectionRename{
		PartySectionRename: &pb.PartySectionRename{Id: "s1", Name: "The Wagon"},
	}})
	if !ok {
		t.Fatal("marshal rename")
	}
	s.Apply(out)
	if s.PartySections[0].Name != "The Wagon" {
		t.Errorf("rename failed: %+v", s.PartySections[0])
	}
	reorder, _ := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartySectionReorder{
		PartySectionReorder: &pb.PartySectionReorder{Ids: []string{"s2", "s1"}},
	}})
	s.Apply(reorder)
	if got := sectionIDs(s); got[0] != "s2" || got[1] != "s1" {
		t.Fatalf("after reorder sections = %v, want [s2 s1]", got)
	}

	// Removing Wagon orphans its item back to unsorted (item survives).
	remove, _ := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartySectionRemove{
		PartySectionRemove: &pb.PartySectionRemove{Id: "s1"},
	}})
	if _, ok := s.Apply(remove); !ok {
		t.Fatal("party_section_remove was not broadcast")
	}
	if got := sectionIDs(s); len(got) != 1 || got[0] != "s2" {
		t.Fatalf("after remove sections = %v, want [s2]", got)
	}
	if it := itemByID(s, "i1"); it == nil || it.SectionId != "" {
		t.Fatalf("removed section's item not orphaned to unsorted: %+v", itemByID(s, "i1"))
	}
}

func partyWalletMsg(gp, sp, cp int32) []byte {
	out, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_PartyWallet{
		PartyWallet: &pb.PartyWallet{Gp: gp, Sp: sp, Cp: cp},
	}})
	if !ok {
		panic("marshal party_wallet")
	}
	return out
}

// TestPartyWalletSetAndClamp covers the shared coin pool: absolute set,
// last-write-wins, with negatives clamped to zero.
func TestPartyWalletSetAndClamp(t *testing.T) {
	s := NewSession()
	if _, ok := s.Apply(partyWalletMsg(300, 50, 0)); !ok {
		t.Fatal("party_wallet was not broadcast")
	}
	if w := s.PartyWallet; w == nil || w.Gp != 300 || w.Sp != 50 || w.Cp != 0 {
		t.Fatalf("wallet = %+v, want 300/50/0", s.PartyWallet)
	}
	// A later edit replaces the totals wholesale (last-write-wins).
	s.Apply(partyWalletMsg(250, 0, 99))
	if w := s.PartyWallet; w.Gp != 250 || w.Sp != 0 || w.Cp != 99 {
		t.Fatalf("wallet = %+v, want 250/0/99", s.PartyWallet)
	}
	// Negatives are clamped to zero.
	s.Apply(partyWalletMsg(-5, 10, -1))
	if w := s.PartyWallet; w.Gp != 0 || w.Sp != 10 || w.Cp != 0 {
		t.Fatalf("wallet = %+v, want 0/10/0 (negatives clamped)", s.PartyWallet)
	}
}

// TestPartyInventoryPersists confirms the list survives a snapshot/load round
// trip (the cross-restart persistence path).
func TestPartyInventoryPersists(t *testing.T) {
	s := NewSession()
	s.Apply(partyAddMsg("i1", "Rope", 1, 1))
	s.Apply(partyAddMsg("i2", "Torch", 5, 1))
	s.Apply(partyWalletMsg(300, 50, 7))
	s.Apply(partySectionAddMsg("s1", "Wagon"))
	s.Apply(partyItemSectionMsg("i2", "s1"))

	dir := t.TempDir()
	path := dir + "/session.json"
	if err := s.Save(path); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := LoadSession(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := partyIDs(loaded); len(got) != 2 || got[0] != "i1" || got[1] != "i2" {
		t.Fatalf("loaded order = %v, want [i1 i2]", got)
	}
	if w := loaded.PartyWallet; w == nil || w.Gp != 300 || w.Sp != 50 || w.Cp != 7 {
		t.Fatalf("loaded wallet = %+v, want 300/50/7", loaded.PartyWallet)
	}
	if got := sectionIDs(loaded); len(got) != 1 || got[0] != "s1" {
		t.Fatalf("loaded sections = %v, want [s1]", got)
	}
	if it := itemByID(loaded, "i2"); it == nil || it.SectionId != "s1" {
		t.Fatalf("loaded item section = %q, want s1", itemByID(loaded, "i2").GetSectionId())
	}
}
