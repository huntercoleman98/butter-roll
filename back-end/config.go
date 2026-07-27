package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"

	pb "butter-roll/server/gen/butterroll/v1"
)

// Config holds the room's behavior rules: declarative "when X happens, do Y"
// entries the hub evaluates authoritatively. It is loaded once at launch and is
// immutable for the process lifetime.
type Config struct {
	Rules               []Rule `json:"rules"`
	PlayerTokenFolderID string `json:"playerTokenFolderId"`

	// byEvent indexes compiled rules by their On event, populated by compile().
	byEvent map[string][]Rule
}

// Rule fires its actions when its condition holds for a triggering message.
type Rule struct {
	On   string   `json:"on"`   // proto oneof name, e.g. "tokenUpdate"
	When string   `json:"when"` // condition expression, compiled at load
	Do   []string `json:"do"`   // actions applied in order when When is true

	when Expr     // compiled When
	do   []Action // resolved Do entries
}

// DefaultConfig is the built-in rule set used when no config file is present:
// keep the `dead` status in sync with HP.
func DefaultConfig() *Config {
	return &Config{
		Rules: []Rule{
			{On: "tokenUpdate", When: "hp > 0 && wounds >= hp", Do: []string{"addStatus('dead')"}},
			{On: "tokenUpdate", When: "hp > 0 && wounds < hp", Do: []string{"removeStatus('dead')"}},
		},
	}
}

// LoadConfig reads the config file at path, layering it over DefaultConfig() so
// an absent file (or omitted keys) keeps default behavior, then compiles every
// rule. A present "rules" array fully replaces the default rule set.
func LoadConfig(path string) (*Config, error) {
	cfg := DefaultConfig()
	data, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		// no file: use defaults as-is
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, err
		}
	}
	if err := cfg.compile(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// compile validates and compiles every rule, building the by-event index. Any
// unknown identifier, function, or action is a hard error so a bad config never
// reaches a live session.
func (c *Config) compile() error {
	c.byEvent = make(map[string][]Rule)
	for i := range c.Rules {
		r := &c.Rules[i]
		if r.On == "" {
			return fmt.Errorf("rule %d: missing \"on\"", i)
		}
		expr, err := Compile(r.When)
		if err != nil {
			return fmt.Errorf("rule %d when %q: %w", i, r.When, err)
		}
		r.when = expr
		r.do = r.do[:0]
		for _, ds := range r.Do {
			act, err := parseAction(ds)
			if err != nil {
				return fmt.Errorf("rule %d do %q: %w", i, ds, err)
			}
			r.do = append(r.do, act)
		}
		c.byEvent[r.On] = append(c.byEvent[r.On], *r)
	}
	return nil
}

// RulesFor returns the compiled rules registered for an event (e.g.
// "tokenUpdate"). Safe to call on a nil Config (returns no rules).
func (c *Config) RulesFor(event string) []Rule {
	if c == nil {
		return nil
	}
	return c.byEvent[event]
}

// tokenEnv exposes a token's fields to the expression evaluator. Unset numeric
// fields read as 0 (via the proto getters), so `hp > 0` skips unlinked tokens.
func tokenEnv(t *pb.Token) *ruleEnv {
	return &ruleEnv{
		vars: map[string]value{
			"hp":     num(float64(t.GetHp())),
			"wounds": num(float64(t.GetWounds())),
		},
		funcs: map[string]func([]value) value{
			"hasStatus": func(args []value) value {
				return boolean(hasStatus(t, args[0].s))
			},
		},
	}
}

// ruleCtx is the mutation scope handed to actions while a rule fires. It exposes
// the whole page (so an action may reach tokens other than the trigger) and
// collects every token an action changes, keyed by id, so the caller can
// broadcast exactly those changes — regardless of how many tokens were touched.
type ruleCtx struct {
	page  *Page
	dirty map[string]*pb.Token
}

// markDirty records that a rule changed t, so its new state gets broadcast.
func (c *ruleCtx) markDirty(t *pb.Token) { c.dirty[t.Id] = t }

// runRules evaluates the rules registered for event against target, then queues
// a followup broadcast for every token the rules changed. Nothing is emitted if
// no rule fires or no token is actually modified (actions are idempotent).
func (s *Session) runRules(page *Page, event string, target *pb.Token) {
	if target == nil {
		return
	}
	rules := s.cfg.RulesFor(event)
	if len(rules) == 0 {
		return
	}
	ctx := &ruleCtx{page: page, dirty: make(map[string]*pb.Token)}
	for _, rule := range rules {
		if rule.when.Eval(tokenEnv(target)).Bool() {
			for _, act := range rule.do {
				act.Apply(target, ctx)
			}
		}
	}
	for id, tok := range ctx.dirty {
		s.queueTokenStatus(page.ID, id, tok.StatusEffects)
	}
}

// queueTokenStatus appends a tokenStatus message to the current Apply's
// followups so the hub rebroadcasts a token's statuses after a rule changes them.
func (s *Session) queueTokenStatus(pageID, id string, statuses []string) {
	b, err := marshalOpts.Marshal(&pb.Envelope{Payload: &pb.Envelope_TokenStatus{
		TokenStatus: &pb.TokenStatus{PageId: pageID, Id: id, StatusEffects: statuses},
	}})
	if err != nil {
		log.Printf("queueTokenStatus marshal error: %v", err)
		return
	}
	s.followups = append(s.followups, b)
}

// serveConfig serves the client-facing config (the rules) as JSON. The body is
// marshaled once since config is immutable for the process lifetime.
func serveConfig(cfg *Config) http.HandlerFunc {
	body, err := json.Marshal(cfg)
	if err != nil {
		body = []byte(`{"rules":[]}`)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	}
}
