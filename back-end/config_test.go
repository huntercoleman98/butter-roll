package main

import (
	"encoding/json"
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

	s.runRules(page, "tokenUpdate", tokenSubject{cur: page.Tokens["a"]})

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
	prev := proto.Clone(page.Tokens["tok"]).(*pb.Token) // pre-merge snapshot for prev(...)
	if ok := page.applyTokenUpdate(&pb.TokenUpdate{Id: "tok", Wounds: proto.Int32(wounds)}); !ok {
		t.Fatal("applyTokenUpdate returned false")
	}
	s.runRules(page, "tokenUpdate", tokenSubject{cur: page.Tokens["tok"], prev: prev})
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
	s.runRules(page, "tokenUpdate", tokenSubject{cur: page.Tokens["t2"]})
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

// TestPrevAndTagRuleFires exercises the generalized comparison: a rule that
// fires only when a goblin-tagged token takes damage (wounds rose vs prev).
func TestPrevAndTagRuleFires(t *testing.T) {
	cfg := &Config{Rules: []Rule{
		{On: "tokenUpdate", When: "hasTag('goblin') && wounds > prev(wounds)", Do: []string{"addStatus('hurt')"}},
	}}
	if err := cfg.compile(); err != nil {
		t.Fatalf("compile: %v", err)
	}
	run := func(tags []string, from, to int32) []string {
		s := NewSession()
		s.cfg = cfg
		page := s.Pages[s.PresentedPageID]
		page.Tokens["g"] = &pb.Token{Id: "g", Url: "u", Hp: proto.Int32(10), Wounds: proto.Int32(from), Tags: tags}
		prev := proto.Clone(page.Tokens["g"]).(*pb.Token)
		page.applyTokenUpdate(&pb.TokenUpdate{Id: "g", Wounds: proto.Int32(to)})
		s.runRules(page, "tokenUpdate", tokenSubject{cur: page.Tokens["g"], prev: prev})
		return page.Tokens["g"].StatusEffects
	}
	if got := run([]string{"goblin"}, 3, 6); len(got) != 1 || got[0] != "hurt" {
		t.Errorf("goblin took damage: got %v, want [hurt]", got)
	}
	if got := run([]string{"orc"}, 3, 6); len(got) != 0 {
		t.Errorf("non-goblin damaged: got %v, want []", got)
	}
	if got := run([]string{"goblin"}, 6, 3); len(got) != 0 {
		t.Errorf("goblin healed (not damaged): got %v, want []", got)
	}
}

func TestPageEnvHasTag(t *testing.T) {
	p := &Page{Name: "Darkwood", Tags: []string{"forest", "night"}}
	cases := []struct {
		src  string
		want bool
	}{
		{"hasTag('forest')", true},
		{"hasTag('desert')", false},
		{"pageName == 'Darkwood'", true},
	}
	for _, c := range cases {
		expr, err := Compile(c.src)
		if err != nil {
			t.Fatalf("Compile(%q): %v", c.src, err)
		}
		if got := expr.Eval(pageEnv(p)).Bool(); got != c.want {
			t.Errorf("Eval(%q) on page env = %v, want %v", c.src, got, c.want)
		}
	}
}

// recordAction records that it ran, for asserting non-token event wiring.
type recordAction struct{ hits *int }

func (a recordAction) Apply(_ *pb.Token, _ *ruleCtx) { *a.hits++ }

// TestPagePresentRunsRules proves the pagePresent event is wired through Apply to
// runRules against the presented page (a page subject, no token).
func TestPagePresentRunsRules(t *testing.T) {
	s := NewSession()
	page := s.Pages[s.PresentedPageID]
	page.Tags = []string{"forest"}
	hits := 0
	forest, err := Compile("hasTag('forest')")
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	s.cfg = &Config{byEvent: map[string][]Rule{
		"pagePresent": {{when: forest, do: []Action{recordAction{hits: &hits}}}},
	}}
	msg, _ := marshalOpts.Marshal(&pb.Envelope{Payload: &pb.Envelope_PagePresent{
		PagePresent: &pb.PagePresent{Id: page.ID},
	}})
	if _, ok := s.Apply(msg); !ok {
		t.Fatal("Apply(pagePresent) returned false")
	}
	if hits != 1 {
		t.Fatalf("expected pagePresent rule to fire once, got %d", hits)
	}
}

// TestWebhookActionRendersAndQueues fires a webhook rule and inspects the
// rendered request queued on Session.outbound (no network).
func TestWebhookActionRendersAndQueues(t *testing.T) {
	cfg := &Config{
		Webhooks: map[string]*Webhook{
			"goblin-hurt": {
				URL:  "http://localhost:8090/api/sfx",
				Body: json.RawMessage(`{"cue":"goblin-hurt","token":{{name}},"wounds":{{wounds}}}`),
			},
		},
		Rules: []Rule{
			{On: "tokenUpdate", When: "hasTag('goblin') && wounds > prev(wounds)", Do: []string{"webhook('goblin-hurt')"}},
		},
	}
	if err := cfg.compile(); err != nil {
		t.Fatalf("compile: %v", err)
	}
	s := NewSession()
	s.cfg = cfg
	page := s.Pages[s.PresentedPageID]
	page.Tokens["g"] = &pb.Token{Id: "g", Url: "u", Name: "Goblin Archer", Hp: proto.Int32(10), Wounds: proto.Int32(2), Tags: []string{"goblin"}}
	prev := proto.Clone(page.Tokens["g"]).(*pb.Token)
	page.applyTokenUpdate(&pb.TokenUpdate{Id: "g", Wounds: proto.Int32(5)})
	s.runRules(page, "tokenUpdate", tokenSubject{cur: page.Tokens["g"], prev: prev})

	if len(s.outbound) != 1 {
		t.Fatalf("expected 1 outbound request, got %d", len(s.outbound))
	}
	req := s.outbound[0]
	if req.Method != "POST" || req.URL != "http://localhost:8090/api/sfx" {
		t.Errorf("unexpected method/url: %s %s", req.Method, req.URL)
	}
	// Body must be valid JSON with the templated values substituted by type.
	var got map[string]any
	if err := json.Unmarshal(req.Body, &got); err != nil {
		t.Fatalf("rendered body is not valid JSON (%q): %v", req.Body, err)
	}
	if got["cue"] != "goblin-hurt" || got["token"] != "Goblin Archer" || got["wounds"].(float64) != 5 {
		t.Errorf("unexpected rendered body: %v", got)
	}
}

// TestWebhookNotFiredWithoutMatch confirms a non-matching condition queues nothing.
func TestWebhookNotFiredWithoutMatch(t *testing.T) {
	cfg := &Config{
		Webhooks: map[string]*Webhook{"x": {URL: "http://localhost/x"}},
		Rules:    []Rule{{On: "tokenUpdate", When: "hasTag('goblin')", Do: []string{"webhook('x')"}}},
	}
	if err := cfg.compile(); err != nil {
		t.Fatalf("compile: %v", err)
	}
	s := NewSession()
	s.cfg = cfg
	page := s.Pages[s.PresentedPageID]
	page.Tokens["t"] = &pb.Token{Id: "t", Url: "u", Tags: []string{"orc"}}
	s.runRules(page, "tokenUpdate", tokenSubject{cur: page.Tokens["t"]})
	if len(s.outbound) != 0 {
		t.Fatalf("expected no outbound for non-matching rule, got %d", len(s.outbound))
	}
}

func TestCompileRejectsUnknownWebhookAndBadURL(t *testing.T) {
	// rule references a webhook that isn't defined
	c1 := &Config{Rules: []Rule{{On: "pagePresent", When: "true", Do: []string{"webhook('nope')"}}}}
	if err := c1.compile(); err == nil {
		t.Error("compile accepted a rule referencing an undefined webhook")
	}
	// webhook with a non-absolute URL
	c2 := &Config{Webhooks: map[string]*Webhook{"bad": {URL: "not-a-url"}}}
	if err := c2.compile(); err == nil {
		t.Error("compile accepted a webhook with an invalid url")
	}
}

func TestClientJSONStripsWebhooks(t *testing.T) {
	cfg := &Config{
		Rules:    []Rule{{On: "tokenUpdate", When: "true", Do: []string{"webhook('x')"}}},
		Webhooks: map[string]*Webhook{"x": {URL: "http://secret.local/x"}},
	}
	body, err := cfg.clientJSON()
	if err != nil {
		t.Fatalf("clientJSON: %v", err)
	}
	if strings.Contains(string(body), "webhooks") || strings.Contains(string(body), "secret.local") {
		t.Fatalf("client config leaked webhooks: %s", body)
	}
	if !strings.Contains(string(body), "\"rules\"") {
		t.Fatalf("client config missing rules: %s", body)
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
