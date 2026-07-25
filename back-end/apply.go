package main

import (
	"log"
	"math"

	pb "butter-roll/server/gen/butterroll/v1"

	"google.golang.org/protobuf/encoding/protojson"
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
func (s *Session) Apply(msg []byte) ([]byte, bool) {
	s.followups = s.followups[:0]

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
		return nil, validateDiceRollRequest(p.DiceRollRequest)
	case *pb.Envelope_DiceRollResult:
		return nil, validateDiceRollResult(p.DiceRollResult)
	case *pb.Envelope_CharacterUpdate:
		return nil, s.applyCharacterUpdate(p.CharacterUpdate)
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
		tu := p.TokenUpdate
		ok := page.applyTokenUpdate(tu)
		if ok {
			// Rules run after the field merges so `when` sees updated state.
			// runRules broadcasts a followup for every token they change (a
			// plain tokenUpdate echo can't carry status changes), so clients
			// see the effect live instead of only after a refresh.
			s.runRules(page, "tokenUpdate", page.Tokens[tu.Id])
		}
		return nil, ok
	case *pb.Envelope_TokenStatus:
		return nil, page.applyTokenStatus(p.TokenStatus)
	case *pb.Envelope_PlayerJoin:
		// Join is idempotent and never rebroadcast as-is: it returns the
		// synthesized TokenAdd/TokenUpdate to broadcast (or nil,false for a no-op).
		return page.applyPlayerJoin(p.PlayerJoin)
	case *pb.Envelope_FogAdd:
		return nil, page.applyFogAdd(p.FogAdd)
	case *pb.Envelope_FogRemove:
		return nil, page.applyFogRemove(p.FogRemove)
	case *pb.Envelope_FogClear:
		return nil, page.applyFogClear(p.FogClear)
	default:
		log.Printf("session.Apply: unhandled message type %T", env.Payload)
		return nil, false
	}
}

// applyCharacterUpdate stores a player's sheet blob keyed by their player_id.
// The original message is rebroadcast (return true) so every client — the DM in
// particular — gets the update live.
func (s *Session) applyCharacterUpdate(m *pb.Character) bool {
	if m.PlayerId == "" {
		log.Printf("session.Apply character_update: empty playerId")
		return false
	}
	if s.Characters == nil {
		s.Characters = make(map[string]string)
	}
	s.Characters[m.PlayerId] = m.Data
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
	if _, ok := s.Pages[m.Id]; !ok {
		log.Printf("session.Apply page_present: unknown page %q", m.Id)
		return false
	}
	s.PresentedPageID = m.Id
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

func validateDiceRollRequest(m *pb.DiceRollRequest) bool {
	return m.Expression != ""
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
	// Enforce one player-character token per player per page: if this token
	// claims an owner that already has one here (e.g. a copy/paste of a player
	// token onto its own page), drop the association and rebroadcast the
	// corrected token so every client renders it unassociated.
	if t.Player && t.GetOwnerPlayerId() != "" && p.playerToken(t.GetOwnerPlayerId()) != nil {
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
	return true
}

// applyPlayerJoin ensures the joining player has exactly one character token on
// this page, then returns the message to broadcast so other clients update. It
// is idempotent (safe to re-send on every reconnect / page change):
//   - an existing player-token owned by this player is adopted, updating its
//     name/color; if nothing changed, it's a no-op (nil, false — not persisted),
//   - otherwise a new player-token is created at the page center.
func (p *Page) applyPlayerJoin(m *pb.PlayerJoin) ([]byte, bool) {
	if m.PlayerId == "" || m.TokenUrl == "" {
		log.Printf("session.Apply player_join: invalid payload (playerId=%q url=%q)", m.PlayerId, m.TokenUrl)
		return nil, false
	}

	// Adopt: the singleton is per-owner per page (m.Player == true tokens).
	if t := p.playerToken(m.PlayerId); t != nil {
		changed := false
		if m.Name != "" && t.Name != m.Name {
			t.Name = m.Name
			changed = true
		}
		if m.Color != "" && t.GetColor() != m.Color {
			c := m.Color
			t.Color = &c
			changed = true
		}
		if !changed {
			return nil, false // already correct — nothing to persist or send
		}
		return marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_TokenUpdate{
			TokenUpdate: &pb.TokenUpdate{PageId: p.ID, Id: t.Id, Name: &t.Name, Color: t.Color},
		}})
	}

	// Create: place at the page center, scattered so simultaneous joiners don't
	// stack perfectly.
	id, err := newUUID()
	if err != nil {
		log.Printf("session.Apply player_join: uuid: %v", err)
		return nil, false
	}
	cx, cy := p.center()
	offset := float64(p.playerTokenCount()) * 40
	playerID := m.PlayerId
	tok := &pb.Token{
		Id:            id,
		Url:           m.TokenUrl,
		X:             cx + offset,
		Y:             cy + offset,
		Name:          m.Name,
		ShowName:      true,
		Public:        true,
		Player:        true,
		OwnerPlayerId: &playerID,
	}
	if m.Color != "" {
		c := m.Color
		tok.Color = &c
	}
	p.Tokens[id] = tok
	return marshalEnvelope(&pb.Envelope{Payload: &pb.Envelope_TokenAdd{
		TokenAdd: &pb.TokenAdd{PageId: p.ID, Token: tok},
	}})
}

// playerToken returns this page's character token owned by playerID, or nil.
func (p *Page) playerToken(playerID string) *pb.Token {
	for _, t := range p.Tokens {
		if t.Player && t.GetOwnerPlayerId() == playerID {
			return t
		}
	}
	return nil
}

// playerTokenCount counts character tokens on the page (for join scatter).
func (p *Page) playerTokenCount() int {
	n := 0
	for _, t := range p.Tokens {
		if t.Player {
			n++
		}
	}
	return n
}

// center returns the page's map center, or the origin if no map is set yet.
func (p *Page) center() (float64, float64) {
	if p.MapWidth > 0 && p.MapHeight > 0 {
		return float64(p.MapWidth) / 2, float64(p.MapHeight) / 2
	}
	return 0, 0
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
	case *pb.Envelope_PlayerJoin:
		return p.PlayerJoin.PageId, true
	case *pb.Envelope_FogAdd:
		return p.FogAdd.PageId, true
	case *pb.Envelope_FogRemove:
		return p.FogRemove.PageId, true
	case *pb.Envelope_FogClear:
		return p.FogClear.PageId, true
	}
	return "", false
}
