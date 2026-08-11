package main

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// A tiny sandboxed expression evaluator for rule `when` conditions.
//
// This is deliberately NOT a general eval: there is no I/O, no loops, and no way
// to mutate state from inside an expression. It parses a fixed grammar (numeric
// comparison, boolean logic, arithmetic, literals, and a small set of known
// variables/functions) to an AST at config-load time, so a typo like `wonds`
// fails at launch rather than mid-session.
//
// Grammar (lowest to highest precedence):
//
//	or   := and ('||' and)*
//	and  := not ('&&' not)*
//	not  := '!' not | cmp
//	cmp  := add (('>='|'>'|'<='|'<'|'=='|'!=') add)?
//	add  := mul (('+'|'-') mul)*
//	mul  := unary (('*'|'/') unary)*
//	unary:= '-' unary | primary
//	prim := number | string | 'true' | 'false' | ident | ident '(' args ')' | '(' or ')'

// knownVars are the identifiers an expression may reference. Extend as rules
// need more of the entity (x, y, public, monster, name, …). A var absent from
// the current event's env reads as 0/"" at eval time, so the set can be a union
// across event types.
var knownVars = map[string]bool{
	"hp":       true,
	"wounds":   true,
	"pageName": true,
	"sides":    true,
	"total":    true,
	"modifier": true,
	"natural":  true,
	"private":  true,
}

// knownFuncs maps a callable name to its arity.
var knownFuncs = map[string]int{
	"hasStatus": 1,
	"hasTag":    1,
}

// Expr is a compiled expression. Eval is pure: it reads from env and returns a
// value, never mutating anything.
type Expr interface {
	Eval(env *ruleEnv) value
}

// ruleEnv supplies variable and function bindings at evaluation time. Missing
// variables read as 0 so an unset token field (e.g. wounds) behaves as zero.
//
// prev, if set, is the same env valued at the entity's pre-event state; the
// prev(...) operator evaluates its subexpression against it. When prev is nil
// (events with no before/after, e.g. pagePresent) prev(x) reads the current
// env, so it degrades to x rather than erroring.
type ruleEnv struct {
	vars  map[string]value
	funcs map[string]func(args []value) value
	prev  *ruleEnv
}

func (e *ruleEnv) lookup(name string) value {
	if v, ok := e.vars[name]; ok {
		return v
	}
	return num(0)
}

func (e *ruleEnv) call(name string, args []value) value {
	if fn, ok := e.funcs[name]; ok {
		return fn(args)
	}
	return boolean(false)
}

// ── Values ───────────────────────────────────────────────────────────────────

type valueKind int

const (
	kindNum valueKind = iota
	kindBool
	kindStr
)

type value struct {
	kind valueKind
	num  float64
	b    bool
	s    string
}

func num(f float64) value  { return value{kind: kindNum, num: f} }
func boolean(b bool) value { return value{kind: kindBool, b: b} }
func str(s string) value   { return value{kind: kindStr, s: s} }

// Bool coerces a value to a boolean: nonzero number, non-empty string, or the
// boolean itself.
func (v value) Bool() bool {
	switch v.kind {
	case kindBool:
		return v.b
	case kindNum:
		return v.num != 0
	case kindStr:
		return v.s != ""
	}
	return false
}

// Num coerces a value to a number for arithmetic/comparison.
func (v value) Num() float64 {
	switch v.kind {
	case kindNum:
		return v.num
	case kindBool:
		if v.b {
			return 1
		}
	}
	return 0
}

func valueEqual(l, r value) bool {
	if l.kind == kindStr || r.kind == kindStr {
		return l.kind == kindStr && r.kind == kindStr && l.s == r.s
	}
	return l.Num() == r.Num()
}

// ── AST nodes ────────────────────────────────────────────────────────────────

type litExpr struct{ v value }

func (e *litExpr) Eval(*ruleEnv) value { return e.v }

type varExpr struct{ name string }

func (e *varExpr) Eval(env *ruleEnv) value { return env.lookup(e.name) }

type callExpr struct {
	name string
	args []Expr
}

func (e *callExpr) Eval(env *ruleEnv) value {
	args := make([]value, len(e.args))
	for i, a := range e.args {
		args[i] = a.Eval(env)
	}
	return env.call(e.name, args)
}

type notExpr struct{ x Expr }

func (e *notExpr) Eval(env *ruleEnv) value { return boolean(!e.x.Eval(env).Bool()) }

// prevExpr evaluates its subexpression against the pre-event snapshot, so a rule
// can compare old vs new without any per-notion variables: `wounds > prev(wounds)`
// is "took damage". Falls back to the current env when there is no prior state.
type prevExpr struct{ x Expr }

func (e *prevExpr) Eval(env *ruleEnv) value {
	p := env.prev
	if p == nil {
		p = env
	}
	return e.x.Eval(p)
}

type negExpr struct{ x Expr }

func (e *negExpr) Eval(env *ruleEnv) value { return num(-e.x.Eval(env).Num()) }

type binExpr struct {
	op   string
	l, r Expr
}

func (e *binExpr) Eval(env *ruleEnv) value { //nolint:gocyclo // every case is a one-liner
	// Short-circuit logical operators before evaluating the right side.
	switch e.op {
	case "&&":
		if !e.l.Eval(env).Bool() {
			return boolean(false)
		}
		return boolean(e.r.Eval(env).Bool())
	case "||":
		if e.l.Eval(env).Bool() {
			return boolean(true)
		}
		return boolean(e.r.Eval(env).Bool())
	}
	l, r := e.l.Eval(env), e.r.Eval(env)
	switch e.op {
	case "+":
		return num(l.Num() + r.Num())
	case "-":
		return num(l.Num() - r.Num())
	case "*":
		return num(l.Num() * r.Num())
	case "/":
		if r.Num() == 0 {
			return num(0)
		}
		return num(l.Num() / r.Num())
	case ">":
		return boolean(l.Num() > r.Num())
	case ">=":
		return boolean(l.Num() >= r.Num())
	case "<":
		return boolean(l.Num() < r.Num())
	case "<=":
		return boolean(l.Num() <= r.Num())
	case "==":
		return boolean(valueEqual(l, r))
	case "!=":
		return boolean(!valueEqual(l, r))
	}
	return boolean(false)
}

// ── Lexer ────────────────────────────────────────────────────────────────────

type tokKind int

const (
	tokEOF tokKind = iota
	tokNumber
	tokString
	tokIdent
	tokOp
)

type token struct {
	kind tokKind
	text string
}

func lex(src string) ([]token, error) { //nolint:gocyclo // standard lexer: a flat switch over character classes with a shared scan index
	var toks []token
	runes := []rune(src)
	i := 0
	for i < len(runes) {
		c := runes[i]
		switch {
		case unicode.IsSpace(c):
			i++
		case c == '\'':
			// single-quoted string literal
			j := i + 1
			for j < len(runes) && runes[j] != '\'' {
				j++
			}
			if j >= len(runes) {
				return nil, fmt.Errorf("unterminated string literal")
			}
			toks = append(toks, token{tokString, string(runes[i+1 : j])})
			i = j + 1
		case unicode.IsDigit(c) || (c == '.' && i+1 < len(runes) && unicode.IsDigit(runes[i+1])):
			j := i
			for j < len(runes) && (unicode.IsDigit(runes[j]) || runes[j] == '.') {
				j++
			}
			toks = append(toks, token{tokNumber, string(runes[i:j])})
			i = j
		case unicode.IsLetter(c) || c == '_':
			j := i
			for j < len(runes) && (unicode.IsLetter(runes[j]) || unicode.IsDigit(runes[j]) || runes[j] == '_') {
				j++
			}
			toks = append(toks, token{tokIdent, string(runes[i:j])})
			i = j
		default:
			// Two-character operators first, then single-character.
			two := ""
			if i+1 < len(runes) {
				two = string(runes[i : i+2])
			}
			switch two {
			case ">=", "<=", "==", "!=", "&&", "||":
				toks = append(toks, token{tokOp, two})
				i += 2
				continue
			}
			switch c {
			case '>', '<', '!', '+', '-', '*', '/', '(', ')', ',':
				toks = append(toks, token{tokOp, string(c)})
				i++
			default:
				return nil, fmt.Errorf("unexpected character %q", string(c))
			}
		}
	}
	toks = append(toks, token{tokEOF, ""})
	return toks, nil
}

// ── Parser ───────────────────────────────────────────────────────────────────

type parser struct {
	toks []token
	pos  int
}

// Compile lexes and parses src into an Expr, rejecting unknown identifiers and
// functions so a bad `when` fails at config-load time.
func Compile(src string) (Expr, error) {
	if strings.TrimSpace(src) == "" {
		return nil, fmt.Errorf("empty expression")
	}
	toks, err := lex(src)
	if err != nil {
		return nil, err
	}
	p := &parser{toks: toks}
	expr, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if p.cur().kind != tokEOF {
		return nil, fmt.Errorf("unexpected token %q", p.cur().text)
	}
	return expr, nil
}

func (p *parser) cur() token { return p.toks[p.pos] }
func (p *parser) advance()   { p.pos++ }
func (p *parser) isOp(s string) bool {
	return p.cur().kind == tokOp && p.cur().text == s
}

func (p *parser) parseOr() (Expr, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.isOp("||") {
		p.advance()
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = &binExpr{op: "||", l: left, r: right}
	}
	return left, nil
}

func (p *parser) parseAnd() (Expr, error) {
	left, err := p.parseNot()
	if err != nil {
		return nil, err
	}
	for p.isOp("&&") {
		p.advance()
		right, err := p.parseNot()
		if err != nil {
			return nil, err
		}
		left = &binExpr{op: "&&", l: left, r: right}
	}
	return left, nil
}

func (p *parser) parseNot() (Expr, error) {
	if p.isOp("!") {
		p.advance()
		x, err := p.parseNot()
		if err != nil {
			return nil, err
		}
		return &notExpr{x: x}, nil
	}
	return p.parseCmp()
}

func (p *parser) parseCmp() (Expr, error) {
	left, err := p.parseAdd()
	if err != nil {
		return nil, err
	}
	for _, op := range []string{">=", "<=", "==", "!=", ">", "<"} {
		if p.isOp(op) {
			p.advance()
			right, err := p.parseAdd()
			if err != nil {
				return nil, err
			}
			return &binExpr{op: op, l: left, r: right}, nil
		}
	}
	return left, nil
}

func (p *parser) parseAdd() (Expr, error) {
	left, err := p.parseMul()
	if err != nil {
		return nil, err
	}
	for p.isOp("+") || p.isOp("-") {
		op := p.cur().text
		p.advance()
		right, err := p.parseMul()
		if err != nil {
			return nil, err
		}
		left = &binExpr{op: op, l: left, r: right}
	}
	return left, nil
}

func (p *parser) parseMul() (Expr, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for p.isOp("*") || p.isOp("/") {
		op := p.cur().text
		p.advance()
		right, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		left = &binExpr{op: op, l: left, r: right}
	}
	return left, nil
}

func (p *parser) parseUnary() (Expr, error) {
	if p.isOp("-") {
		p.advance()
		x, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return &negExpr{x: x}, nil
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() (Expr, error) {
	t := p.cur()
	switch t.kind {
	case tokNumber:
		f, err := strconv.ParseFloat(t.text, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid number %q", t.text)
		}
		p.advance()
		return &litExpr{v: num(f)}, nil
	case tokString:
		p.advance()
		return &litExpr{v: str(t.text)}, nil
	case tokIdent:
		p.advance()
		switch t.text {
		case "true":
			return &litExpr{v: boolean(true)}, nil
		case "false":
			return &litExpr{v: boolean(false)}, nil
		case "prev":
			return p.parsePrev()
		}
		if p.isOp("(") {
			return p.parseCall(t.text)
		}
		if !knownVars[t.text] {
			return nil, fmt.Errorf("unknown identifier %q", t.text)
		}
		return &varExpr{name: t.text}, nil
	case tokOp:
		if t.text == "(" {
			p.advance()
			inner, err := p.parseOr()
			if err != nil {
				return nil, err
			}
			if !p.isOp(")") {
				return nil, fmt.Errorf("expected ')'")
			}
			p.advance()
			return inner, nil
		}
	}
	return nil, fmt.Errorf("unexpected token %q", t.text)
}

// parsePrev parses `prev(<expr>)`. The inner expression is parsed and validated
// like any other (unknown identifiers/functions still fail at compile time); at
// eval time it runs against the pre-event snapshot instead of the current state.
func (p *parser) parsePrev() (Expr, error) {
	if !p.isOp("(") {
		return nil, fmt.Errorf("prev expects '(expression)'")
	}
	p.advance() // consume '('
	inner, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if !p.isOp(")") {
		return nil, fmt.Errorf("expected ')' after prev(...)")
	}
	p.advance()
	return &prevExpr{x: inner}, nil
}

func (p *parser) parseCall(name string) (Expr, error) {
	arity, ok := knownFuncs[name]
	if !ok {
		return nil, fmt.Errorf("unknown function %q", name)
	}
	p.advance() // consume '('
	var args []Expr
	if !p.isOp(")") {
		for {
			arg, err := p.parseOr()
			if err != nil {
				return nil, err
			}
			args = append(args, arg)
			if p.isOp(",") {
				p.advance()
				continue
			}
			break
		}
	}
	if !p.isOp(")") {
		return nil, fmt.Errorf("expected ')' in call to %s", name)
	}
	p.advance()
	if len(args) != arity {
		return nil, fmt.Errorf("%s expects %d argument(s), got %d", name, arity, len(args))
	}
	return &callExpr{name: name, args: args}, nil
}
