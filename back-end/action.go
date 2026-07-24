package main

import (
	"fmt"

	pb "butter-roll/server/gen/butterroll/v1"
)

// Action is a single authoritative mutation a rule performs when its condition
// is true. Actions come from a fixed vocabulary — a rule's expression only
// chooses *when* one runs, never *what* it does.
//
// target is the token the rule fired for; ctx gives access to the rest of the
// page (so an action may reach other tokens) and to markDirty, which an action
// MUST call for every token it changes so the change is broadcast (§ ruleCtx).
type Action interface {
	Apply(target *pb.Token, ctx *ruleCtx)
}

// parseAction turns a `do` entry like "addStatus('dead')" into a resolved
// Action, or returns an error (so a bad action fails at config-load time).
func parseAction(src string) (Action, error) {
	name, args, err := parseCall(src)
	if err != nil {
		return nil, err
	}
	switch name {
	case "addStatus":
		if len(args) != 1 {
			return nil, fmt.Errorf("addStatus expects 1 argument, got %d", len(args))
		}
		return addStatusAction{id: args[0]}, nil
	case "removeStatus":
		if len(args) != 1 {
			return nil, fmt.Errorf("removeStatus expects 1 argument, got %d", len(args))
		}
		return removeStatusAction{id: args[0]}, nil
	default:
		return nil, fmt.Errorf("unknown action %q", name)
	}
}

// parseCall parses a `name('arg', …)` call with string-literal arguments,
// reusing the expression lexer.
func parseCall(src string) (name string, args []string, err error) {
	toks, err := lex(src)
	if err != nil {
		return "", nil, err
	}
	i := 0
	if toks[i].kind != tokIdent {
		return "", nil, fmt.Errorf("expected action name in %q", src)
	}
	name = toks[i].text
	i++
	if !(toks[i].kind == tokOp && toks[i].text == "(") {
		return "", nil, fmt.Errorf("expected '(' after %q", name)
	}
	i++
	for toks[i].kind != tokEOF && !(toks[i].kind == tokOp && toks[i].text == ")") {
		if toks[i].kind != tokString {
			return "", nil, fmt.Errorf("action %q: arguments must be quoted strings", name)
		}
		args = append(args, toks[i].text)
		i++
		if toks[i].kind == tokOp && toks[i].text == "," {
			i++
			continue
		}
		break
	}
	if !(toks[i].kind == tokOp && toks[i].text == ")") {
		return "", nil, fmt.Errorf("expected ')' in %q", src)
	}
	i++
	if toks[i].kind != tokEOF {
		return "", nil, fmt.Errorf("trailing tokens after action %q", name)
	}
	return name, args, nil
}

type addStatusAction struct{ id string }

func (a addStatusAction) Apply(t *pb.Token, ctx *ruleCtx) {
	if hasStatus(t, a.id) {
		return
	}
	t.StatusEffects = append(t.StatusEffects, a.id)
	ctx.markDirty(t)
}

type removeStatusAction struct{ id string }

func (a removeStatusAction) Apply(t *pb.Token, ctx *ruleCtx) {
	if !hasStatus(t, a.id) {
		return
	}
	removeStatus(t, a.id)
	ctx.markDirty(t)
}

// removeStatus drops id from the token's status effects if present.
func removeStatus(t *pb.Token, id string) {
	out := t.StatusEffects[:0]
	for _, s := range t.StatusEffects {
		if s != id {
			out = append(out, s)
		}
	}
	t.StatusEffects = out
}

// hasStatus reports whether the token currently carries the given status.
func hasStatus(t *pb.Token, id string) bool {
	for _, s := range t.StatusEffects {
		if s == id {
			return true
		}
	}
	return false
}
