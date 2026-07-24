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
		funcs: map[string]func([]value) value{
			"hasStatus": func(a []value) value { return boolean(set[a[0].s]) },
		},
	}
}

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
		expr, err := Compile(c.src)
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
	}
	for _, src := range bad {
		if _, err := Compile(src); err == nil {
			t.Errorf("Compile(%q) = nil error, want error", src)
		}
	}
}
