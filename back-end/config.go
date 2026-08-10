package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"

	pb "butter-roll/server/gen/butterroll/v1"
)

// Config holds the room's behavior rules: declarative "when X happens, do Y"
// entries the hub evaluates authoritatively. It is loaded once at launch and is
// immutable for the process lifetime.
type Config struct {
	Rules               []Rule `json:"rules"`
	PlayerTokenFolderID string `json:"playerTokenFolderId"`

	// Webhooks are named outbound HTTP requests a webhook('name') action fires.
	// This is the entire coupling surface to external apps (e.g. the soundboard):
	// the URL and payload shape live here, never in Go. Server-only — stripped
	// from GET /api/config (see clientJSON).
	Webhooks map[string]*Webhook `json:"webhooks"`

	// byEvent indexes compiled rules by their On event, populated by compile().
	byEvent map[string][]Rule
}

// Webhook is a named, fully-specified outbound request. Body is a JSON template:
// each {{var}} placeholder is replaced by the JSON encoding of a context value
// (token/page fields plus event) at fire time — so write `{"n": {{name}}}`, not
// `{"n": "{{name}}"}`. A body with no placeholders is a static payload.
type Webhook struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"` // default POST
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
}

// outboundRequest is a rendered webhook ready for the dispatcher to send. Queued
// on Session.outbound during Apply; no network happens inside the hub loop.
type outboundRequest struct {
	Method  string
	URL     string
	Headers map[string]string
	Body    []byte
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
	if err := c.compileWebhooks(); err != nil {
		return err
	}
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
			if wa, ok := act.(webhookAction); ok {
				if _, defined := c.Webhooks[wa.name]; !defined {
					return fmt.Errorf("rule %d do %q: webhook %q is not defined in \"webhooks\"", i, ds, wa.name)
				}
			}
			r.do = append(r.do, act)
		}
		c.byEvent[r.On] = append(c.byEvent[r.On], *r)
	}
	return nil
}

// compileWebhooks validates each webhook definition (absolute URL, default
// method) so a bad target fails at launch rather than mid-session.
func (c *Config) compileWebhooks() error {
	for name, wh := range c.Webhooks {
		if wh == nil || wh.URL == "" {
			return fmt.Errorf("webhook %q: missing url", name)
		}
		if _, err := url.ParseRequestURI(wh.URL); err != nil {
			return fmt.Errorf("webhook %q: invalid url %q: %w", name, wh.URL, err)
		}
		if wh.Method == "" {
			wh.Method = http.MethodPost
		}
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

// ruleSubject is the entity an event fires against. env() builds its evaluator
// bindings (including a prev snapshot for events with before/after state, read by
// the prev(...) operator); token() is the token an action mutates, or nil for
// events with no token subject (e.g. pagePresent).
type ruleSubject interface {
	env() *ruleEnv
	token() *pb.Token
	// tmpl is the substitution context for webhook body templates ({{var}}).
	tmpl() map[string]any
}

// tokenSubject is a token-scoped event's subject. prev is the token's pre-merge
// snapshot (nil when there is none).
type tokenSubject struct{ cur, prev *pb.Token }

func (s tokenSubject) env() *ruleEnv {
	e := tokenEnv(s.cur)
	if s.prev != nil {
		e.prev = tokenEnv(s.prev)
	}
	return e
}
func (s tokenSubject) token() *pb.Token { return s.cur }
func (s tokenSubject) tmpl() map[string]any {
	return map[string]any{
		"id":      s.cur.Id,
		"name":    s.cur.Name,
		"hp":      s.cur.GetHp(),
		"wounds":  s.cur.GetWounds(),
		"monster": s.cur.Monster,
		"tags":    s.cur.Tags,
	}
}

// pageSubject is a page-scoped event's subject (e.g. pagePresent). It has no
// token to mutate and no before/after state.
type pageSubject struct{ page *Page }

func (s pageSubject) env() *ruleEnv    { return pageEnv(s.page) }
func (s pageSubject) token() *pb.Token { return nil }
func (s pageSubject) tmpl() map[string]any {
	return map[string]any{
		"id":       s.page.ID,
		"pageName": s.page.Name,
		"tags":     s.page.Tags,
	}
}

// tokenEnv exposes a token's fields to the expression evaluator. Unset numeric
// fields read as 0 (via the proto getters), so `hp > 0` skips unlinked tokens.
// The same builder is used for the current and prev(...) snapshots, so a new
// comparable field added here is instantly available in both forms.
func tokenEnv(t *pb.Token) *ruleEnv {
	return &ruleEnv{
		vars: map[string]value{
			"hp":     num(float64(t.GetHp())),
			"wounds": num(float64(t.GetWounds())),
		},
		funcs: map[string]func([]value) value{
			"hasStatus": func(args []value) value { return boolean(hasStatus(t, args[0].s)) },
			"hasTag":    func(args []value) value { return boolean(hasTag(t.Tags, args[0].s)) },
		},
	}
}

// pageEnv exposes a page's fields for page-scoped events (e.g. pagePresent).
func pageEnv(p *Page) *ruleEnv {
	return &ruleEnv{
		vars: map[string]value{
			"pageName": str(p.Name),
		},
		funcs: map[string]func([]value) value{
			"hasTag": func(args []value) value { return boolean(hasTag(p.Tags, args[0].s)) },
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

	// subj/event/cfg let a webhook action render its request; outbound collects
	// the rendered requests the caller drains onto Session.outbound.
	subj     ruleSubject
	event    string
	cfg      *Config
	outbound []outboundRequest
}

// markDirty records that a rule changed t, so its new state gets broadcast.
func (c *ruleCtx) markDirty(t *pb.Token) { c.dirty[t.Id] = t }

// emit queues a rendered outbound request for the dispatcher.
func (c *ruleCtx) emit(r outboundRequest) { c.outbound = append(c.outbound, r) }

// runRules evaluates the rules registered for event against subj, then queues a
// followup broadcast for every token the rules changed and every outbound webhook
// they fired. Nothing is emitted if no rule fires.
func (s *Session) runRules(page *Page, event string, subj ruleSubject) {
	rules := s.cfg.RulesFor(event)
	if len(rules) == 0 {
		return
	}
	env := subj.env()
	ctx := &ruleCtx{page: page, dirty: make(map[string]*pb.Token), subj: subj, event: event, cfg: s.cfg}
	for _, rule := range rules {
		if rule.when.Eval(env).Bool() {
			for _, act := range rule.do {
				act.Apply(subj.token(), ctx)
			}
		}
	}
	for id, tok := range ctx.dirty {
		s.queueTokenStatus(page.ID, id, tok.StatusEffects)
	}
	s.outbound = append(s.outbound, ctx.outbound...)
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

// tmplVar matches a {{ var }} placeholder in a webhook body template.
var tmplVar = regexp.MustCompile(`{{\s*(\w+)\s*}}`)

// renderBody substitutes {{var}} placeholders in a webhook body template with the
// JSON encoding of the matching context value (so the result stays valid JSON and
// preserves types). Unknown vars render as null. An empty template yields nil.
func renderBody(tmpl []byte, ctx map[string]any) []byte {
	if len(tmpl) == 0 {
		return nil
	}
	return tmplVar.ReplaceAllFunc(tmpl, func(m []byte) []byte {
		v, ok := ctx[string(tmplVar.FindSubmatch(m)[1])]
		if !ok {
			return []byte("null")
		}
		b, err := json.Marshal(v)
		if err != nil {
			return []byte("null")
		}
		return b
	})
}

// clientJSON is the client-facing projection of the config: rules and the token
// folder, but NOT webhooks (backend-only plumbing, possibly internal URLs).
func (c *Config) clientJSON() ([]byte, error) {
	return json.Marshal(struct {
		Rules               []Rule `json:"rules"`
		PlayerTokenFolderID string `json:"playerTokenFolderId,omitempty"`
	}{Rules: c.Rules, PlayerTokenFolderID: c.PlayerTokenFolderID})
}

// serveConfig serves the client-facing config as JSON. The body is marshaled once
// since config is immutable for the process lifetime.
func serveConfig(cfg *Config) http.HandlerFunc {
	body, err := cfg.clientJSON()
	if err != nil {
		body = []byte(`{"rules":[]}`)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
}
