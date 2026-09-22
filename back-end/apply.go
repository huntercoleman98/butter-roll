package main

import (
	"log"
	"math"

	pb "butter-roll/server/gen/butterroll/v1"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func finiteFloat(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}

// Apply parses and validates an incoming Envelope, dispatches it to the handler
// for its message type, and returns (toSend, true) if the message should be
// broadcast. toSend is nil to broadcast the original message bytes, or non-nil
// bytes to broadcast instead.
//
// Handlers fall into three groups: pure validators for ephemeral messages
// (which mutate nothing), Session methods for page-management, and Page methods
// for page-scoped mutations.
func (s *Session) Apply(msg []byte) ([]byte, bool) { //nolint:gocyclo,funlen // flat message-type dispatch
	s.followups = s.followups[:0]
	s.outbound = s.outbound[:0]

	var env pb.Envelope
	if err := protojson.Unmarshal(msg, &env); err != nil {
		log.Printf("session.Apply: bad protojson: %v", err)
		return nil, false
	}

	// Page-management and ephemeral messages: no pageId lookup required.
	switch p := env.Payload.(type) {
	case *pb.Envelope_PageAdd:
		return nil, s.applyPageAdd(p.PageAdd)
	case *pb.Envelope_PageRemove:
		return nil, s.applyPageRemove(p.PageRemove)
	case *pb.Envelope_PageRename:
		return nil, s.applyPageRename(p.PageRename)
	case *pb.Envelope_PagePresent:
		return nil, s.applyPagePresent(p.PagePresent)
	case *pb.Envelope_PageTags:
		return nil, s.applyPageTags(p.PageTags)
	case *pb.Envelope_ArrowUpdate:
		return nil, validateArrowUpdate(p.ArrowUpdate)
	case *pb.Envelope_ArrowClear:
		return nil, true // ephemeral
	case *pb.Envelope_RadiusUpdate:
		return nil, validateRadiusUpdate(p.RadiusUpdate)
	case *pb.Envelope_RadiusClear:
		return nil, true // ephemeral
	case *pb.Envelope_Ping:
		return nil, validatePing(p.Ping)
	case *pb.Envelope_ViewportSync:
		return nil, validateViewportSync(p.ViewportSync)
	case *pb.Envelope_DiceRollRequest:
		return nil, s.applyDiceRollRequest(p.DiceRollRequest)
	case *pb.Envelope_DiceRollResult:
		if !validateDiceRollResult(p.DiceRollResult) {
			return nil, false
		}
		s.runRules(nil, "diceRollResult", diceSubject{res: p.DiceRollResult})
		return nil, true
	case *pb.Envelope_InitiativeStart:
		return nil, s.applyInitiativeStart()
	case *pb.Envelope_InitiativeEnd:
		return nil, s.applyInitiativeEnd()
	case *pb.Envelope_CharacterUpdate:
		return nil, s.applyCharacterUpdate(p.CharacterUpdate)
	case *pb.Envelope_PlayerRemove:
		return nil, s.applyPlayerRemove(p.PlayerRemove)
	case *pb.Envelope_PlayerJoin:
		return s.applyPlayerJoin(p.PlayerJoin)
	case *pb.Envelope_PartyItemAdd:
		return nil, s.applyPartyItemAdd(p.PartyItemAdd)
	case *pb.Envelope_PartyItemUpdate:
		return nil, s.applyPartyItemUpdate(p.PartyItemUpdate)
	case *pb.Envelope_PartyItemRemove:
		return nil, s.applyPartyItemRemove(p.PartyItemRemove)
	case *pb.Envelope_PartyItemReorder:
		return nil, s.applyPartyItemReorder(p.PartyItemReorder)
	case *pb.Envelope_PartyWallet:
		return nil, s.applyPartyWallet(p.PartyWallet)
	case *pb.Envelope_PartySectionAdd:
		return nil, s.applyPartySectionAdd(p.PartySectionAdd)
	case *pb.Envelope_PartySectionRename:
		return nil, s.applyPartySectionRename(p.PartySectionRename)
	case *pb.Envelope_PartySectionRemove:
		return nil, s.applyPartySectionRemove(p.PartySectionRemove)
	case *pb.Envelope_PartySectionReorder:
		return nil, s.applyPartySectionReorder(p.PartySectionReorder)
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
		return nil, page.applyMapSet(p.MapSet)
	case *pb.Envelope_MapResize:
		return nil, page.applyMapResize(p.MapResize)
	case *pb.Envelope_TokenAdd:
		return page.applyTokenAdd(p.TokenAdd)
	case *pb.Envelope_TokenMove:
		return nil, page.applyTokenMove(p.TokenMove)
	case *pb.Envelope_TokenMoveBatch:
		return nil, page.applyTokenMoveBatch(p.TokenMoveBatch)
	case *pb.Envelope_TokenRemove:
		return nil, page.applyTokenRemove(p.TokenRemove)
	case *pb.Envelope_TokenUpdate:
		return nil, s.applyTokenUpdateWithRules(page, p.TokenUpdate)
	case *pb.Envelope_TokenStatus:
		return nil, page.applyTokenStatus(p.TokenStatus)
	case *pb.Envelope_TokenTags:
		return nil, page.applyTokenTags(p.TokenTags)
	case *pb.Envelope_FogAdd:
		return nil, page.applyFogAdd(p.FogAdd)
	case *pb.Envelope_FogRemove:
		return nil, page.applyFogRemove(p.FogRemove)
	case *pb.Envelope_FogClear:
		return nil, page.applyFogClear(p.FogClear)
	case *pb.Envelope_HexGridSet:
		return nil, page.applyHexGridSet(p.HexGridSet)
	case *pb.Envelope_HexGridRemove:
		return nil, page.applyHexGridRemove()
	default:
		log.Printf("session.Apply: unhandled message type %T", env.Payload)
		return nil, false
	}
}

// applyCharacterUpdate stores a character's sheet blob keyed by its
// character_id, preserving the name/token_url/color set at join (the player's
// sheet pushes carry only Data + ids). It also carries the archived flag, so a
// player switching characters archives the old one with a single update. The
// original message is rebroadcast (return true) so every client — the DM in
// particular — gets the update live.
func (s *Session) applyCharacterUpdate(m *pb.Character) bool {
	if m.PlayerId == "" || m.CharacterId == "" {
		log.Printf("session.Apply character_update: missing ids (playerId=%q characterId=%q)", m.PlayerId, m.CharacterId)
		return false
	}
	if s.Characters == nil {
		s.Characters = make(map[string]*pb.Character)
	}
	ch := s.Characters[m.CharacterId]
	if ch == nil {
		ch = &pb.Character{CharacterId: m.CharacterId}
		s.Characters[m.CharacterId] = ch
	}
	ch.Data = m.Data
	ch.Archived = m.Archived
	// A retired character belongs to no individual player: it lives in a shared
	// graveyard, so evicting a player leaves it intact. An active one is owned by
	// the player that pushed it.
	if m.Archived {
		ch.PlayerId = ""
	} else {
		ch.PlayerId = m.PlayerId
	}
	if m.TokenUrl != "" {
		ch.TokenUrl = m.TokenUrl
	}
	if m.Name != "" {
		ch.Name = m.Name
	}
	if m.Color != "" {
		ch.Color = m.Color
	}
	return true
}

// characterIdentityUpdate records a character's display name and token image on
// its Character (creating it if the sheet hasn't been pushed yet) so clients —
// the DM's player bar in particular — learn the identity even on pages where the
// player has no token. Returns the marshaled characterUpdate to broadcast, or
// nil when nothing changed. Called from the PlayerJoin path, the moment
// name/token are chosen.
func (s *Session) characterIdentityUpdate(playerID, characterID, name, tokenURL, color string) []byte {
	if playerID == "" || characterID == "" {
		return nil
	}
	if s.Characters == nil {
		s.Characters = make(map[string]*pb.Character)
	}
	ch := s.Characters[characterID]
	if ch == nil {
		ch = &pb.Character{PlayerId: playerID, CharacterId: characterID}
		s.Characters[characterID] = ch
	}
	changed := false
	if name != "" && ch.Name != name {
		ch.Name = name
		changed = true
	}
	if tokenURL != "" && ch.TokenUrl != tokenURL {
		ch.TokenUrl = tokenURL
		changed = true
	}
	if color != "" && ch.Color != color {
		ch.Color = color
		changed = true
	}
	if !changed {
		return nil
	}
	b, ok := marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_CharacterUpdate{
		CharacterUpdate: ch,
	}})
	if !ok {
		return nil
	}
	return b
}

// applyPlayerJoin registers a player's active-character identity (name, color,
// token image) so the DM's player bar can show them. It places no token — the DM
// adds a player's token by clicking their (grayed) chip in the bar. Returns the
// characterUpdate to broadcast, or (nil,false) when the payload is invalid or
// nothing changed.
func (s *Session) applyPlayerJoin(m *pb.PlayerJoin) ([]byte, bool) {
	if m.PlayerId == "" || m.CharacterId == "" || m.TokenUrl == "" {
		log.Printf("session.Apply player_join: invalid payload (playerId=%q characterId=%q url=%q)", m.PlayerId, m.CharacterId, m.TokenUrl)
		return nil, false
	}
	identity := s.characterIdentityUpdate(m.PlayerId, m.CharacterId, m.Name, m.TokenUrl, m.Color)
	if identity == nil {
		return nil, false
	}
	return identity, true
}

// applyPlayerRemove evicts a player: drops their entire character roster and
// every token they own across all pages. The original message is rebroadcast
// (return true) so every client removes the player's tokens and sheets live.
func (s *Session) applyPlayerRemove(m *pb.PlayerRemove) bool {
	if m.PlayerId == "" {
		log.Printf("session.Apply player_remove: empty playerId")
		return false
	}
	for id, ch := range s.Characters {
		if ch.PlayerId == m.PlayerId {
			delete(s.Characters, id)
		}
	}
	for _, page := range s.Pages {
		for id, t := range page.Tokens {
			if t.GetOwnerPlayerId() == m.PlayerId {
				delete(page.Tokens, id)
			}
		}
	}
	return true
}

// ── Party inventory handlers ─────────────────────────────────────────────────
// The shared, per-room inventory. Each op mutates the authoritative ordered list
// and the original message is rebroadcast (return true) so every client applies
// the same change. No owner check — any player (or, later, the DM) may edit.

func (s *Session) applyPartyItemAdd(m *pb.PartyItemAdd) bool {
	if m.Item == nil || m.Item.Id == "" {
		log.Printf("session.Apply party_item_add: invalid payload")
		return false
	}
	s.PartyInventory = append(s.PartyInventory, m.Item)
	return true
}

func (s *Session) applyPartyItemUpdate(m *pb.PartyItemUpdate) bool {
	if m.Id == "" {
		log.Printf("session.Apply party_item_update: empty id")
		return false
	}
	for _, it := range s.PartyInventory {
		if it.Id != m.Id {
			continue
		}
		if m.Name != nil {
			it.Name = *m.Name
		}
		if m.Qty != nil {
			it.Qty = *m.Qty
		}
		if m.SlotsEach != nil {
			it.SlotsEach = *m.SlotsEach
		}
		if m.SectionId != nil {
			it.SectionId = *m.SectionId
		}
		return true
	}
	log.Printf("session.Apply party_item_update: unknown id %q", m.Id)
	return false
}

func (s *Session) applyPartyItemRemove(m *pb.PartyItemRemove) bool {
	if m.Id == "" {
		log.Printf("session.Apply party_item_remove: empty id")
		return false
	}
	for i, it := range s.PartyInventory {
		if it.Id == m.Id {
			s.PartyInventory = append(s.PartyInventory[:i], s.PartyInventory[i+1:]...)
			return true
		}
	}
	log.Printf("session.Apply party_item_remove: unknown id %q", m.Id)
	return false
}

// applyPartyItemReorder rebuilds the list in the id order given, keeping only ids
// that currently exist and appending any current items the message omitted (so a
// racing add is never dropped).
func (s *Session) applyPartyItemReorder(m *pb.PartyItemReorder) bool {
	byID := make(map[string]*pb.PartyItem, len(s.PartyInventory))
	for _, it := range s.PartyInventory {
		byID[it.Id] = it
	}
	next := make([]*pb.PartyItem, 0, len(s.PartyInventory))
	seen := make(map[string]bool, len(m.Ids))
	for _, id := range m.Ids {
		if it, ok := byID[id]; ok && !seen[id] {
			next = append(next, it)
			seen[id] = true
		}
	}
	for _, it := range s.PartyInventory {
		if !seen[it.Id] {
			next = append(next, it)
		}
	}
	s.PartyInventory = next
	return true
}

// applyPartyWallet stores the shared coin pool's new absolute totals (clamping
// negatives to zero) and rebroadcasts the original message. Standalone,
// last-write-wins — the client sends the full new totals.
func (s *Session) applyPartyWallet(m *pb.PartyWallet) bool {
	if m == nil {
		return false
	}
	s.PartyWallet = &pb.PartyWallet{
		Gp: max(0, m.Gp),
		Sp: max(0, m.Sp),
		Cp: max(0, m.Cp),
	}
	return true
}

// ── Party section handlers ───────────────────────────────────────────────────
// Flat, non-nestable buckets. Mirror the party-item ops; each rebroadcasts.

func (s *Session) applyPartySectionAdd(m *pb.PartySectionAdd) bool {
	if m.Section == nil || m.Section.Id == "" {
		log.Printf("session.Apply party_section_add: invalid payload")
		return false
	}
	s.PartySections = append(s.PartySections, m.Section)
	return true
}

func (s *Session) applyPartySectionRename(m *pb.PartySectionRename) bool {
	if m.Id == "" {
		log.Printf("session.Apply party_section_rename: empty id")
		return false
	}
	for _, sec := range s.PartySections {
		if sec.Id == m.Id {
			sec.Name = m.Name
			return true
		}
	}
	log.Printf("session.Apply party_section_rename: unknown id %q", m.Id)
	return false
}

// applyPartySectionRemove drops the section and orphans its items to unsorted
// (clears their SectionId) rather than deleting them.
func (s *Session) applyPartySectionRemove(m *pb.PartySectionRemove) bool {
	if m.Id == "" {
		log.Printf("session.Apply party_section_remove: empty id")
		return false
	}
	for i, sec := range s.PartySections {
		if sec.Id == m.Id {
			s.PartySections = append(s.PartySections[:i], s.PartySections[i+1:]...)
			for _, it := range s.PartyInventory {
				if it.SectionId == m.Id {
					it.SectionId = ""
				}
			}
			return true
		}
	}
	log.Printf("session.Apply party_section_remove: unknown id %q", m.Id)
	return false
}

// applyPartySectionReorder rebuilds the section list in the id order given,
// keeping only ids that exist and appending any current section the message
// omitted (racing-add safety) — same shape as applyPartyItemReorder.
func (s *Session) applyPartySectionReorder(m *pb.PartySectionReorder) bool {
	byID := make(map[string]*pb.PartySection, len(s.PartySections))
	for _, sec := range s.PartySections {
		byID[sec.Id] = sec
	}
	next := make([]*pb.PartySection, 0, len(s.PartySections))
	seen := make(map[string]bool, len(m.Ids))
	for _, id := range m.Ids {
		if sec, ok := byID[id]; ok && !seen[id] {
			next = append(next, sec)
			seen[id] = true
		}
	}
	for _, sec := range s.PartySections {
		if !seen[sec.Id] {
			next = append(next, sec)
		}
	}
	s.PartySections = next
	return true
}

// ── Page-management handlers ─────────────────────────────────────────────────

func (s *Session) applyPageAdd(m *pb.PageAdd) bool {
	if m.Id == "" || m.Name == "" {
		log.Printf("session.Apply page_add: invalid payload (id=%q name=%q)", m.Id, m.Name)
		return false
	}
	if _, exists := s.Pages[m.Id]; exists {
		log.Printf("session.Apply page_add: duplicate id %q", m.Id)
		return false
	}
	s.Pages[m.Id] = &Page{
		ID:       m.Id,
		Name:     m.Name,
		Tokens:   make(map[string]*pb.Token),
		FogPolys: make(map[string]*pb.FogPoly),
	}
	s.PageOrder = append(s.PageOrder, m.Id)
	return true
}

func (s *Session) applyPageRemove(m *pb.PageRemove) bool {
	if m.Id == "" {
		log.Printf("session.Apply page_remove: empty id")
		return false
	}
	if len(s.Pages) <= 1 {
		log.Printf("session.Apply page_remove: cannot remove last page")
		return false
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
	return true
}

func (s *Session) applyPageRename(m *pb.PageRename) bool {
	if m.Id == "" || m.Name == "" {
		log.Printf("session.Apply page_rename: invalid payload")
		return false
	}
	page, ok := s.Pages[m.Id]
	if !ok {
		log.Printf("session.Apply page_rename: unknown page %q", m.Id)
		return false
	}
	page.Name = m.Name
	return true
}

func (s *Session) applyPagePresent(m *pb.PagePresent) bool {
	if m.Id == "" {
		log.Printf("session.Apply page_present: empty id")
		return false
	}
	page, ok := s.Pages[m.Id]
	if !ok {
		log.Printf("session.Apply page_present: unknown page %q", m.Id)
		return false
	}
	s.PresentedPageID = m.Id
	s.runRules(page, "pagePresent", pageSubject{page: page})
	return true
}

// applyTokenUpdateWithRules merges the partial update, then runs tokenUpdate
// rules against the merged token with its pre-merge snapshot, so `when` sees the
// updated state and prev(...) can compare old vs new. runRules broadcasts a
// followup for every token the rules change (a plain tokenUpdate echo can't carry
// status changes), so clients see the effect live instead of only after refresh.
func (s *Session) applyTokenUpdateWithRules(page *Page, tu *pb.TokenUpdate) bool {
	var prev *pb.Token
	if t, ok := page.Tokens[tu.Id]; ok {
		prev = proto.Clone(t).(*pb.Token)
	}
	ok := page.applyTokenUpdate(tu)
	if ok {
		s.runRules(page, "tokenUpdate", tokenSubject{cur: page.Tokens[tu.Id], prev: prev})
	}
	return ok
}

func (s *Session) applyPageTags(m *pb.PageTags) bool {
	if m.Id == "" {
		log.Printf("session.Apply page_tags: empty id")
		return false
	}
	page, ok := s.Pages[m.Id]
	if !ok {
		log.Printf("session.Apply page_tags: unknown page %q", m.Id)
		return false
	}
	page.Tags = m.Tags
	return true
}

// ── Ephemeral validators (mutate nothing) ────────────────────────────────────

func validateArrowUpdate(m *pb.ArrowUpdate) bool {
	if !finiteFloat(m.X1) || !finiteFloat(m.Y1) || !finiteFloat(m.X2) || !finiteFloat(m.Y2) {
		log.Printf("session.Apply arrow_update: non-finite coordinates")
		return false
	}
	return true
}

func validateRadiusUpdate(m *pb.RadiusUpdate) bool {
	if !finiteFloat(m.X) || !finiteFloat(m.Y) || !finiteFloat(m.X2) || !finiteFloat(m.Y2) {
		log.Printf("session.Apply radius_update: invalid payload")
		return false
	}
	return true
}

func validatePing(m *pb.Ping) bool {
	if !finiteFloat(m.X) || !finiteFloat(m.Y) {
		log.Printf("session.Apply ping: non-finite coordinates")
		return false
	}
	return true
}

func validateViewportSync(m *pb.ViewportSync) bool {
	if !finiteFloat(m.WorldCenterX) || !finiteFloat(m.WorldCenterY) || !finiteFloat(m.Scale) || m.Scale <= 0 {
		log.Printf("session.Apply viewport_sync: invalid payload")
		return false
	}
	return true
}

// applyDiceRollRequest validates the request, resolves the initiating token (if
// any), runs diceRollRequest rules against the combined context, then broadcasts
// the original message so the dice overlay can animate the roll.
func (s *Session) applyDiceRollRequest(req *pb.DiceRollRequest) bool {
	if req.Expression == "" {
		return false
	}
	var tok *pb.Token
	if id := req.GetTokenId(); id != "" {
		tok = s.findToken(id)
	}
	s.runRules(nil, "diceRollRequest", diceRequestSubject{req: req, tok: tok})
	return true
}

// applyInitiativeStart fires the initiativeStart rules (the DM began an encounter)
// so their webhook side effects queue. It carries no state; returning true lets
// the hub drain those side effects and rebroadcast the bare signal.
func (s *Session) applyInitiativeStart() bool {
	s.runRules(nil, "initiativeStart", initiativeSubject{})
	return true
}

// applyInitiativeEnd fires the initiativeEnd rules (the DM ended an encounter)
// so their webhook side effects queue. Like applyInitiativeStart it carries no
// state; returning true lets the hub drain those side effects and rebroadcast
// the bare signal.
func (s *Session) applyInitiativeEnd() bool {
	s.runRules(nil, "initiativeEnd", initiativeSubject{})
	return true
}

// findToken searches every page for the token with the given id. Returns nil if
// not found (token may have been deleted between the roll and its arrival).
func (s *Session) findToken(id string) *pb.Token {
	for _, page := range s.Pages {
		if t, ok := page.Tokens[id]; ok {
			return t
		}
	}
	return nil
}

func validateDiceRollResult(m *pb.DiceRollResult) bool {
	if m.Expression == "" || m.Sides == 0 || len(m.Rolls) == 0 {
		log.Printf("session.Apply dice_roll_result: invalid payload")
		return false
	}
	return true
}

// ── Page-scoped handlers ─────────────────────────────────────────────────────

func (p *Page) applyMapSet(m *pb.MapSet) bool {
	if m.Url == "" || m.Width <= 0 || m.Height <= 0 {
		log.Printf("session.Apply map_set: invalid payload (url=%q w=%d h=%d)", m.Url, m.Width, m.Height)
		return false
	}
	p.MapURL = m.Url
	p.MapWidth = m.Width
	p.MapHeight = m.Height
	return true
}

func (p *Page) applyMapResize(m *pb.MapResize) bool {
	if m.Width <= 0 || m.Height <= 0 {
		log.Printf("session.Apply map_resize: invalid dimensions (%dx%d)", m.Width, m.Height)
		return false
	}
	p.MapWidth = m.Width
	p.MapHeight = m.Height
	return true
}

func (p *Page) applyTokenAdd(m *pb.TokenAdd) ([]byte, bool) {
	t := m.Token
	if t == nil || t.Id == "" || t.Url == "" || !finiteFloat(t.X) || !finiteFloat(t.Y) {
		log.Printf("session.Apply token_add: invalid payload")
		return nil, false
	}
	// Enforce one token per character per page: if this token would duplicate a
	// character already on the page (e.g. a copy/paste of a player token onto its
	// own page), drop the association and rebroadcast the corrected token so every
	// client renders it unassociated. Scoping this by character (not just owner)
	// lets a player place their new active token even while a retired character's
	// leftover token is still on the page.
	if t.Player && t.GetOwnerPlayerId() != "" && p.conflictingPlayerToken(t) != nil {
		t.Player = false
		t.OwnerPlayerId = nil
		p.Tokens[t.Id] = t
		return marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_TokenAdd{
			TokenAdd: &pb.TokenAdd{PageId: p.ID, Token: t},
		}})
	}
	p.Tokens[t.Id] = t
	return nil, true
}

func (p *Page) applyTokenMove(m *pb.TokenMove) bool {
	if m.Id == "" || !finiteFloat(m.X) || !finiteFloat(m.Y) {
		log.Printf("session.Apply token_move: invalid payload (id=%q)", m.Id)
		return false
	}
	t, ok := p.Tokens[m.Id]
	if !ok {
		log.Printf("session.Apply token_move: unknown token %q", m.Id)
		return false
	}
	t.X = m.X
	t.Y = m.Y
	return true
}

func (p *Page) applyTokenMoveBatch(m *pb.TokenMoveBatch) bool {
	changed := false
	for _, mv := range m.Moves {
		if mv.Id == "" || !finiteFloat(mv.X) || !finiteFloat(mv.Y) {
			log.Printf("session.Apply token_move_batch: invalid move (id=%q)", mv.Id)
			continue
		}
		t, ok := p.Tokens[mv.Id]
		if !ok {
			log.Printf("session.Apply token_move_batch: unknown token %q", mv.Id)
			continue
		}
		t.X = mv.X
		t.Y = mv.Y
		changed = true
	}
	return changed
}

func (p *Page) applyTokenRemove(m *pb.TokenRemove) bool {
	if m.Id == "" {
		log.Printf("session.Apply token_remove: empty id")
		return false
	}
	delete(p.Tokens, m.Id)
	return true
}

func (p *Page) applyTokenUpdate(m *pb.TokenUpdate) bool {
	if m.Id == "" {
		log.Printf("session.Apply token_update: empty id")
		return false
	}
	t, ok := p.Tokens[m.Id]
	if !ok {
		log.Printf("session.Apply token_update: unknown token %q", m.Id)
		return false
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
	if m.Pinned != nil {
		t.Pinned = *m.Pinned
	}
	if m.Size != nil {
		t.Size = *m.Size
	}
	if m.OwnerPlayerId != nil {
		// Assign/clear the controlling player for an owned monster (familiar,
		// mount, summon). Empty string clears the association; player stays as-is
		// (these are never character tokens).
		if *m.OwnerPlayerId == "" {
			t.OwnerPlayerId = nil
		} else {
			t.OwnerPlayerId = m.OwnerPlayerId
		}
	}
	return true
}

// conflictingPlayerToken returns an existing player token on this page that
// represents the same character as t (so adding t would duplicate it), or nil.
// Used by applyTokenAdd to enforce one token per character per page — a player
// can still have their new active token placed while a retired character's
// leftover token is on the page, since the two carry different character ids.
func (p *Page) conflictingPlayerToken(t *pb.Token) *pb.Token {
	for _, ex := range p.Tokens {
		if ex.Player && ex.Id != t.Id && ex.CharacterId == t.CharacterId {
			return ex
		}
	}
	return nil
}

func (p *Page) applyTokenStatus(m *pb.TokenStatus) bool {
	if m.Id == "" {
		log.Printf("session.Apply token_status: empty id")
		return false
	}
	t, ok := p.Tokens[m.Id]
	if !ok {
		log.Printf("session.Apply token_status: unknown token %q", m.Id)
		return false
	}
	t.StatusEffects = m.StatusEffects
	return true
}

func (p *Page) applyTokenTags(m *pb.TokenTags) bool {
	if m.Id == "" {
		log.Printf("session.Apply token_tags: empty id")
		return false
	}
	t, ok := p.Tokens[m.Id]
	if !ok {
		log.Printf("session.Apply token_tags: unknown token %q", m.Id)
		return false
	}
	t.Tags = m.Tags
	return true
}

func (p *Page) applyFogAdd(m *pb.FogAdd) bool {
	if m.Id == "" || len(m.Points) < 6 || len(m.Points)%2 != 0 {
		log.Printf("session.Apply fog_add: invalid payload (id=%q npts=%d)", m.Id, len(m.Points))
		return false
	}
	for _, v := range m.Points {
		if !finiteFloat(v) {
			log.Printf("session.Apply fog_add: non-finite vertex (id=%q)", m.Id)
			return false
		}
	}
	p.FogPolys[m.Id] = &pb.FogPoly{Id: m.Id, Points: m.Points}
	return true
}

func (p *Page) applyFogRemove(m *pb.FogRemove) bool {
	if m.Id == "" {
		log.Printf("session.Apply fog_remove: empty id")
		return false
	}
	delete(p.FogPolys, m.Id)
	return true
}

func (p *Page) applyFogClear(_ *pb.FogClear) bool {
	p.FogPolys = make(map[string]*pb.FogPoly)
	return true
}

func (p *Page) applyHexGridSet(m *pb.HexGridSet) bool {
	g := m.HexGrid
	if g == nil {
		log.Printf("session.Apply hex_grid_set: missing hex_grid")
		return false
	}
	if g.Width <= 0 || g.Height <= 0 ||
		!finiteFloat(g.Width) || !finiteFloat(g.Height) ||
		!finiteFloat(g.OffsetX) || !finiteFloat(g.OffsetY) {
		log.Printf("session.Apply hex_grid_set: invalid size/offset (w=%v h=%v ox=%v oy=%v)",
			g.Width, g.Height, g.OffsetX, g.OffsetY)
		return false
	}
	if g.Orientation != pb.HexGrid_POINTY && g.Orientation != pb.HexGrid_FLAT {
		log.Printf("session.Apply hex_grid_set: invalid orientation %v", g.Orientation)
		return false
	}
	p.HexGrid = &pb.HexGrid{
		Orientation: g.Orientation,
		Width:       g.Width,
		Height:      g.Height,
		OffsetX:     g.OffsetX,
		OffsetY:     g.OffsetY,
	}
	return true
}

func (p *Page) applyHexGridRemove() bool {
	p.HexGrid = nil
	return true
}

// marshalEnvelope serializes env for broadcast, returning (nil, false) on error
// so a failed marshal becomes a no-op rather than broadcasting nil bytes.
func marshalEnvelope(env *pb.Envelope) ([]byte, bool) {
	b, err := marshalOpts.Marshal(env)
	if err != nil {
		log.Printf("marshalEnvelope error: %v", err)
		return nil, false
	}
	return b, true
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
	case *pb.Envelope_TokenMoveBatch:
		return p.TokenMoveBatch.PageId, true
	case *pb.Envelope_TokenRemove:
		return p.TokenRemove.PageId, true
	case *pb.Envelope_TokenUpdate:
		return p.TokenUpdate.PageId, true
	case *pb.Envelope_TokenStatus:
		return p.TokenStatus.PageId, true
	case *pb.Envelope_TokenTags:
		return p.TokenTags.PageId, true
	case *pb.Envelope_FogAdd:
		return p.FogAdd.PageId, true
	case *pb.Envelope_FogRemove:
		return p.FogRemove.PageId, true
	case *pb.Envelope_FogClear:
		return p.FogClear.PageId, true
	case *pb.Envelope_HexGridSet:
		return p.HexGridSet.PageId, true
	case *pb.Envelope_HexGridRemove:
		return p.HexGridRemove.PageId, true
	}
	return "", false
}
