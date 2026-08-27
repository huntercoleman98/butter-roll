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
	"strconv"

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

// Webhook is a named, fully-specified outbound request. Body is a JSON template
// authored in config.json: {{var}} / {{tags[0]}} placeholders are substituted from
// the firing subject at send time (see renderBody). With no placeholders it is
// sent verbatim, so it must be valid JSON either way.
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
		schema, ok := eventSchemas[r.On]
		if !ok {
			return fmt.Errorf("rule %d: unknown event %q", i, r.On)
		}
		expr, err := Compile(r.When, schema)
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
// events with no token subject (e.g. pagePresent); tmpl() is the substitution
// context for webhook body templates ({{var}} / {{tags[0]}}, see renderBody).
type ruleSubject interface {
	env() *ruleEnv
	token() *pb.Token
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
		"id":      s.cur.GetId(),
		"name":    s.cur.GetName(),
		"monster": s.cur.GetMonster(),
		"hp":      int(s.cur.GetHp()),
		"wounds":  int(s.cur.GetWounds()),
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
		"pageName": s.page.Name,
		"tags":     s.page.Tags,
	}
}

// diceSubject is a diceRollResult event's subject. It has no token or page and no
// before/after state, so it only ever drives webhook actions.
type diceSubject struct{ res *pb.DiceRollResult }

func (s diceSubject) env() *ruleEnv    { return diceEnv(s.res) }
func (s diceSubject) token() *pb.Token { return nil }
func (s diceSubject) tmpl() map[string]any {
	return map[string]any{
		"sides":    int(s.res.GetSides()),
		"total":    int(s.res.GetTotal()),
		"modifier": int(s.res.GetModifier()),
		"natural":  int(s.res.GetTotal() - s.res.GetModifier()),
		"private":  s.res.GetPrivate(),
	}
}

// diceRequestSubject is a diceRollRequest event's subject. tok is the resolved
// token that initiated the roll (nil when token_id is absent or not found).
// Token mutation actions are suppressed (token() returns nil) because the page
// context needed to broadcast status changes isn't available here.
type diceRequestSubject struct {
	req *pb.DiceRollRequest
	tok *pb.Token
}

func (s diceRequestSubject) env() *ruleEnv    { return diceRequestEnv(s.req, s.tok) }
func (s diceRequestSubject) token() *pb.Token { return nil }
func (s diceRequestSubject) tmpl() map[string]any {
	m := map[string]any{
		"metadata":      s.req.GetMetadata(),
		"token.name":    s.tok.GetName(),
		"token.monster": s.tok.GetMonster(),
		"token.hp":      int(s.tok.GetHp()),
		"token.wounds":  int(s.tok.GetWounds()),
		"token.tags":    s.tok.GetTags(),
	}
	return m
}

// initiativeSubject is the subject for the initiativeStart and initiativeEnd
// events. It carries no state: the events only signal that combat began or
// ended, so their rules bind no variables or functions and they drive webhook
// actions with empty template context.
type initiativeSubject struct{}

func (initiativeSubject) env() *ruleEnv        { return &ruleEnv{} }
func (initiativeSubject) token() *pb.Token     { return nil }
func (initiativeSubject) tmpl() map[string]any { return nil }

// eventSchemas maps each supported event to the identifiers its `when`
// expressions may reference, derived from that event's env builder run on a
// zero-valued entity. The env builder is thus the single source of truth: add a
// var or func there and rules for that event can use it, with no parallel list
// to keep in sync. compile() rejects a rule whose `on` is absent here, so a
// typo'd event name fails at load rather than silently never firing.
var eventSchemas = map[string]eventSchema{
	"tokenUpdate":     schemaOf(tokenEnv(&pb.Token{})),
	"pagePresent":     schemaOf(pageEnv(&Page{})),
	"diceRollResult":  schemaOf(diceEnv(&pb.DiceRollResult{})),
	"diceRollRequest": schemaOf(diceRequestEnv(&pb.DiceRollRequest{}, nil)),
	"initiativeStart": schemaOf(initiativeSubject{}.env()),
	"initiativeEnd":   schemaOf(initiativeSubject{}.env()),
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
		funcs: map[string]ruleFunc{
			"hasStatus": {arity: 1, fn: func(args []value) value { return boolean(hasStatus(t, args[0].s)) }},
			"hasTag":    {arity: 1, fn: func(args []value) value { return boolean(hasTag(t.Tags, args[0].s)) }},
		},
	}
}

// pageEnv exposes a page's fields for page-scoped events (e.g. pagePresent).
func pageEnv(p *Page) *ruleEnv {
	return &ruleEnv{
		vars: map[string]value{
			"pageName": str(p.Name),
		},
		funcs: map[string]ruleFunc{
			"hasTag": {arity: 1, fn: func(args []value) value { return boolean(hasTag(p.Tags, args[0].s)) }},
		},
	}
}

// diceEnv exposes a dice roll's fields for diceRollResult events. natural is the
// resolved single-die value (total minus modifier), so a crit-fail rule is
// `sides == 20 && natural == 1` regardless of any modifier; private lets a rule
// skip the DM's secret rolls (e.g. `... && !private`).
func diceEnv(r *pb.DiceRollResult) *ruleEnv {
	return &ruleEnv{
		vars: map[string]value{
			"sides":    num(float64(r.GetSides())),
			"total":    num(float64(r.GetTotal())),
			"modifier": num(float64(r.GetModifier())),
			"natural":  num(float64(r.GetTotal() - r.GetModifier())),
			"private":  boolean(r.GetPrivate()),
		},
	}
}

// diceRequestEnv exposes a dice roll request's fields for diceRollRequest events.
// tok is the token that initiated the roll (nil when none). Token fields read as
// zero/empty when tok is nil so rules like `token.hp > 0` safely skip tokenless
// rolls. tokenHasTag(tag) checks tok's tags and returns false when tok is nil.
func diceRequestEnv(req *pb.DiceRollRequest, tok *pb.Token) *ruleEnv {
	var hp, wounds float64
	var name, monster string
	var tags []string
	if tok != nil {
		hp = float64(tok.GetHp())
		wounds = float64(tok.GetWounds())
		name = tok.GetName()
		monster = tok.GetMonster()
		tags = tok.Tags
	}
	return &ruleEnv{
		vars: map[string]value{
			"metadata":      str(req.GetMetadata()),
			"token.hp":      num(hp),
			"token.wounds":  num(wounds),
			"token.name":    str(name),
			"token.monster": str(monster),
		},
		funcs: map[string]ruleFunc{
			"tokenHasTag": {arity: 1, fn: func(args []value) value { return boolean(hasTag(tags, args[0].s)) }},
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

	// cfg resolves a webhook action's definition; outbound collects the requests
	// it fires, which the caller drains onto Session.outbound. subj is the firing
	// entity, used to render webhook body templates (may be nil).
	cfg      *Config
	subj     ruleSubject
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
	ctx := &ruleCtx{page: page, dirty: make(map[string]*pb.Token), cfg: s.cfg, subj: subj}
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

// clientJSON is the client-facing projection of the config: rules and the token
// folder, but NOT webhooks (backend-only plumbing, possibly internal URLs).
func (c *Config) clientJSON() ([]byte, error) {
	return json.Marshal(struct {
		Rules               []Rule `json:"rules"`
		PlayerTokenFolderID string `json:"playerTokenFolderId,omitempty"`
	}{Rules: c.Rules, PlayerTokenFolderID: c.PlayerTokenFolderID})
}

// tmplVar matches a webhook body placeholder: {{ name }} or {{ name[0] }}. The
// name may contain dots (e.g. token.name); the optional [n] indexes a string list.
var tmplVar = regexp.MustCompile(`{{\s*([\w.]+)\s*(?:\[\s*(\d+)\s*\])?\s*}}`)

// renderBody substitutes {{var}} / {{var[n]}} placeholders in a webhook body
// template with values from ctx, JSON-escaping each substitution so the result
// stays valid whether the placeholder sits inside a JSON string ("a/{{tags[0]}}/b")
// or is a whole value ({"n": {{sides}}}). Missing vars and out-of-range indexes
// render as empty. A placeholder-free template passes through unchanged; an empty
// template yields nil.
func renderBody(tmpl []byte, ctx map[string]any) []byte {
	if len(tmpl) == 0 {
		return nil
	}
	return tmplVar.ReplaceAllFunc(tmpl, func(m []byte) []byte {
		sub := tmplVar.FindSubmatch(m)
		return jsonEscape(tmplValue(ctx[string(sub[1])], sub[2]))
	})
}

// tmplValue resolves a single placeholder to its raw string form. idx is the
// bracketed index bytes ("" when absent); when present, v must be a []string and
// is indexed, yielding "" if out of range or not a list.
func tmplValue(v any, idx []byte) string {
	if len(idx) > 0 {
		list, _ := v.([]string)
		i, _ := strconv.Atoi(string(idx))
		if i < 0 || i >= len(list) {
			return ""
		}
		return list[i]
	}
	switch x := v.(type) {
	case string:
		return x
	case int:
		return strconv.Itoa(x)
	case bool:
		return strconv.FormatBool(x)
	default:
		return ""
	}
}

// jsonEscape encodes s as JSON and strips the surrounding quotes, so the escaped
// content can be spliced into a body template without breaking its JSON.
func jsonEscape(s string) []byte {
	b, err := json.Marshal(s)
	if err != nil {
		return nil
	}
	return b[1 : len(b)-1]
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
