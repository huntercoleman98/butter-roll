package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	pb "butter-roll/server/gen/butterroll/v1"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// testStatusOn is a multi-token action used only in tests: it adds a status to
// an arbitrary token on the page (not necessarily the trigger), exercising the
// dirty-set emit path for side effects that reach beyond the triggering token.
type testStatusOn struct{ id, status string }

func (a testStatusOn) Apply(_ *pb.Token, ctx *ruleCtx) {
	other, ok := ctx.page.Tokens[a.id]
	if !ok || hasStatus(other, a.status) {
		return
	}
	other.StatusEffects = append(other.StatusEffects, a.status)
	ctx.markDirty(other)
}

// alwaysExpr is a test Expr that always evaluates true.
type alwaysExpr struct{}

func (alwaysExpr) Eval(*ruleEnv) value { return boolean(true) }

// TestRunRulesEmitsPerAffectedToken proves the emit layer is not tied to the
// triggering token: a single rule that changes two different tokens produces a
// followup for each.
func TestRunRulesEmitsPerAffectedToken(t *testing.T) {
	s := NewSession()
	page := s.Pages[s.PresentedPageID]
	page.Tokens["a"] = &pb.Token{Id: "a", Url: "u"}
	page.Tokens["b"] = &pb.Token{Id: "b", Url: "u"}
	// Hand-built config (bypassing parseAction) so we can use a multi-token
	// action that the shipped vocabulary doesn't yet include.
	s.cfg = &Config{byEvent: map[string][]Rule{
		"tokenUpdate": {{
			when: alwaysExpr{},
			do:   []Action{addStatusAction{id: "dead"}, testStatusOn{id: "b", status: "marked"}},
		}},
	}}
	s.followups = s.followups[:0]

	s.runRules(page, "tokenUpdate", page.Tokens["a"])

	if len(s.followups) != 2 {
		t.Fatalf("expected a followup per affected token (2), got %d", len(s.followups))
	}
	got := map[string]string{}
	for _, raw := range s.followups {
		var env pb.Envelope
		if err := protojson.Unmarshal(raw, &env); err != nil {
			t.Fatalf("bad followup: %v", err)
		}
		ts := env.GetTokenStatus()
		got[ts.Id] = strings.Join(ts.StatusEffects, ",")
	}
	ids := make([]string, 0, len(got))
	for id := range got {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	if strings.Join(ids, ",") != "a,b" || got["a"] != "dead" || got["b"] != "marked" {
		t.Fatalf("unexpected followups: %v", got)
	}
}

// applyWounds runs a wounds-only token_update through a session carrying cfg
// (merge + rules) and returns the token's resulting status effects.
func applyWounds(t *testing.T, cfg *Config, hp, wounds int32, initial ...string) []string {
	t.Helper()
	s := NewSession()
	s.cfg = cfg
	page := s.Pages[s.PresentedPageID]
	page.Tokens["tok"] = &pb.Token{
		Id: "tok", Url: "u", Hp: proto.Int32(hp), StatusEffects: append([]string(nil), initial...),
	}
	if ok := page.applyTokenUpdate(&pb.TokenUpdate{Id: "tok", Wounds: proto.Int32(wounds)}); !ok {
		t.Fatal("applyTokenUpdate returned false")
	}
	s.runRules(page, "tokenUpdate", page.Tokens["tok"])
	return page.Tokens["tok"].StatusEffects
}

func TestDefaultConfigAutoDead(t *testing.T) {
	cfg := DefaultConfig()
	if err := cfg.compile(); err != nil {
		t.Fatalf("compile default: %v", err)
	}

	// wounds >= hp adds dead
	if got := applyWounds(t, cfg, 10, 10); len(got) != 1 || got[0] != "dead" {
		t.Errorf("wounds>=hp: got %v, want [dead]", got)
	}
	// healing back below hp removes dead
	if got := applyWounds(t, cfg, 10, 9, "dead"); len(got) != 0 {
		t.Errorf("wounds<hp: got %v, want []", got)
	}
	// unlinked token (hp unset -> 0) is untouched
	s := NewSession()
	s.cfg = cfg
	page := s.Pages[s.PresentedPageID]
	page.Tokens["t2"] = &pb.Token{Id: "t2", Url: "u"}
	page.applyTokenUpdate(&pb.TokenUpdate{Id: "t2", Wounds: proto.Int32(0)})
	s.runRules(page, "tokenUpdate", page.Tokens["t2"])
	if len(page.Tokens["t2"].StatusEffects) != 0 {
		t.Errorf("unlinked token gained status: %v", page.Tokens["t2"].StatusEffects)
	}
}

func TestApplyEmitsTokenStatusFollowup(t *testing.T) {
	cfg := DefaultConfig()
	if err := cfg.compile(); err != nil {
		t.Fatalf("compile: %v", err)
	}
	s := NewSession()
	s.cfg = cfg
	page := s.Pages[s.PresentedPageID]
	page.Tokens["tok"] = &pb.Token{Id: "tok", Url: "u", Hp: proto.Int32(10)}

	// wounds >= hp: expect a followup tokenStatus carrying "dead".
	msg, _ := marshalOpts.Marshal(&pb.Envelope{Payload: &pb.Envelope_TokenUpdate{
		TokenUpdate: &pb.TokenUpdate{PageId: page.ID, Id: "tok", Wounds: proto.Int32(10)},
	}})
	if _, ok := s.Apply(msg); !ok {
		t.Fatal("Apply returned false")
	}
	if len(s.followups) != 1 {
		t.Fatalf("expected 1 followup, got %d", len(s.followups))
	}
	var env pb.Envelope
	if err := protojson.Unmarshal(s.followups[0], &env); err != nil {
		t.Fatalf("followup not valid protojson: %v", err)
	}
	ts := env.GetTokenStatus()
	if ts == nil || ts.Id != "tok" || len(ts.StatusEffects) != 1 || ts.StatusEffects[0] != "dead" {
		t.Fatalf("unexpected followup: %+v", ts)
	}

	// A tokenUpdate that doesn't change statuses emits no followup.
	msg2, _ := marshalOpts.Marshal(&pb.Envelope{Payload: &pb.Envelope_TokenUpdate{
		TokenUpdate: &pb.TokenUpdate{PageId: page.ID, Id: "tok", Wounds: proto.Int32(10)},
	}})
	if _, ok := s.Apply(msg2); !ok {
		t.Fatal("Apply returned false")
	}
	if len(s.followups) != 0 {
		t.Fatalf("expected no followup when status unchanged, got %d", len(s.followups))
	}
}

func TestLoadConfigMissingFileUsesDefaults(t *testing.T) {
	cfg, err := LoadConfig(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil {
		t.Fatalf("LoadConfig missing: %v", err)
	}
	if len(cfg.RulesFor("tokenUpdate")) != 2 {
		t.Errorf("expected 2 default tokenUpdate rules, got %d", len(cfg.RulesFor("tokenUpdate")))
	}
}

func TestLoadConfigReplacesRules(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	os.WriteFile(path, []byte(`{"rules":[
		{"on":"tokenUpdate","when":"wounds >= hp","do":["addStatus('down')"]}
	]}`), 0644)
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if n := len(cfg.RulesFor("tokenUpdate")); n != 1 {
		t.Fatalf("expected file rules to replace defaults, got %d rules", n)
	}
	if got := applyWounds(t, cfg, 5, 5); len(got) != 1 || got[0] != "down" {
		t.Errorf("custom rule: got %v, want [down]", got)
	}
}

func TestLoadConfigRejectsBadRule(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	os.WriteFile(path, []byte(`{"rules":[
		{"on":"tokenUpdate","when":"wonds >= hp","do":["addStatus('dead')"]}
	]}`), 0644)
	if _, err := LoadConfig(path); err == nil {
		t.Error("LoadConfig accepted a rule with an unknown identifier")
	}
}
