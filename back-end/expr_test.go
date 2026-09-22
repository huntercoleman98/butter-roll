package main

import "testing"

// evalEnv is a small test env exposing hp/wounds and hasStatus over a status set.
func evalEnv(hp, wounds float64, statuses ...string) *ruleEnv {
	set := map[string]bool{}
	for _, s := range statuses {
		set[s] = true
	}
	return &ruleEnv{
		vars: map[string]value{"hp": num(hp), "wounds": num(wounds)},
		funcs: map[string]ruleFunc{
			"hasStatus": {arity: 1, fn: func(a []value) value { return boolean(set[a[0].s]) }},
		},
	}
}

// tokenTestSchema is the schema for the token-style envs evalEnv builds, so
// Compile in these tests validates against hp/wounds/hasStatus.
var tokenTestSchema = schemaOf(evalEnv(0, 0))

func TestCompileAndEval(t *testing.T) {
	cases := []struct {
		src  string
		env  *ruleEnv
		want bool
	}{
		{"hp > 0 && wounds >= hp", evalEnv(10, 10), true},
		{"hp > 0 && wounds >= hp", evalEnv(10, 9), false},
		{"hp > 0 && wounds < hp", evalEnv(10, 9), true},
		{"hp > 0 && wounds < hp", evalEnv(0, 0), false},   // unlinked: hp guard fails
		{"wounds >= hp", evalEnv(0, 0), true},             // unset both read as 0
		{"!hasStatus('dead')", evalEnv(10, 0), true},      // no statuses
		{"hasStatus('dead')", evalEnv(10, 10, "dead"), true},
		{"1 + 2 * 3 == 7", evalEnv(0, 0), true},           // precedence
		{"(1 + 2) * 3 == 9", evalEnv(0, 0), true},         // parens
		{"wounds >= hp * 0.5", evalEnv(10, 5), true},      // bloodied-style threshold
		{"wounds >= hp * 0.5", evalEnv(10, 4), false},
		{"false || hp == 10", evalEnv(10, 0), true},
	}
	for _, c := range cases {
		expr, err := Compile(c.src, tokenTestSchema)
		if err != nil {
			t.Fatalf("Compile(%q) error: %v", c.src, err)
		}
		if got := expr.Eval(c.env).Bool(); got != c.want {
			t.Errorf("Eval(%q) = %v, want %v", c.src, got, c.want)
		}
	}
}

// withPrev returns env with a prev snapshot attached, for testing prev(...).
func withPrev(env, prev *ruleEnv) *ruleEnv {
	env.prev = prev
	return env
}

func TestPrevComparesOldVsNew(t *testing.T) {
	cases := []struct {
		src  string
		env  *ruleEnv
		want bool
	}{
		// took damage: wounds went up vs the snapshot
		{"wounds > prev(wounds)", withPrev(evalEnv(10, 6), evalEnv(10, 3)), true},
		{"wounds > prev(wounds)", withPrev(evalEnv(10, 3), evalEnv(10, 3)), false},
		// healed: wounds went down
		{"wounds < prev(wounds)", withPrev(evalEnv(10, 2), evalEnv(10, 5)), true},
		// just died this update: now dead, wasn't before
		{"wounds >= hp && prev(wounds) < hp", withPrev(evalEnv(10, 10), evalEnv(10, 9)), true},
		{"wounds >= hp && prev(wounds) < hp", withPrev(evalEnv(10, 10), evalEnv(10, 10)), false},
		// just crossed the bloodied threshold
		{"wounds > hp*0.5 && prev(wounds) <= hp*0.5", withPrev(evalEnv(10, 6), evalEnv(10, 5)), true},
		// prev of a function: just gained the 'dead' status
		{"hasStatus('dead') && !prev(hasStatus('dead'))", withPrev(evalEnv(10, 10, "dead"), evalEnv(10, 9)), true},
		// no prev attached: prev(x) degrades to x, so a delta test is never true
		{"wounds > prev(wounds)", evalEnv(10, 5), false},
	}
	for _, c := range cases {
		expr, err := Compile(c.src, tokenTestSchema)
		if err != nil {
			t.Fatalf("Compile(%q) error: %v", c.src, err)
		}
		if got := expr.Eval(c.env).Bool(); got != c.want {
			t.Errorf("Eval(%q) = %v, want %v", c.src, got, c.want)
		}
	}
}

func TestCompileRejectsBadExpressions(t *testing.T) {
	bad := []string{
		"wonds >= hp",       // unknown identifier (typo)
		"noSuchFunc('x')",   // unknown function
		"hasStatus()",       // wrong arity
		"hp >",              // dangling operator
		"hp > 0 &&",         // incomplete
		"(hp > 0",           // unbalanced paren
		"",                  // empty
		"hp @ 3",            // unexpected character
		"prev(wonds)",       // unknown identifier inside prev (still validated)
		"prev()",            // prev needs an expression
		"prev wounds",       // prev needs parentheses
		"prev(hp",           // unbalanced paren in prev
	}
	for _, src := range bad {
		if _, err := Compile(src, tokenTestSchema); err == nil {
			t.Errorf("Compile(%q) = nil error, want error", src)
		}
	}
}
