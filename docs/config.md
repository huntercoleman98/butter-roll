# Rules Engine & Configuration Design

A design for making butter-roll highly configurable through a **rules engine**:
declarative "when X happens, do Y" rules that the backend evaluates and enforces.
Config is about *behavior and house rules*, not tuning constants.

The **backend reads the config once at launch**, **evaluates rules inside the
authoritative hub**, and **exposes the client-facing subset over an HTTP
endpoint** so the front-end can adapt its UI.

**First milestone (implemented):** two rules that keep the `dead` status in sync
with HP —
- `wounds >= hp` → **apply** the `dead` status
- `wounds < hp` → **remove** the `dead` status

---

## 1. Why a rules engine, and why backend-only

The valuable axis of configurability is *functionality*: what the VTT
automatically does. A rule like "apply `dead` when wounds reach HP" matters far
more than "token size = 60px". A specified-value design (a named config field +
Go handler per behavior) was considered and rejected: every new behavior would
cost changes across proto + Go + front-end, and the §9 catalog makes that the
common case. One `on`/`when`/`do` model absorbs all of it — build the evaluator
once, then new behaviors are pure config.

**These rules run only on the backend.** butter-roll's hub is the single source
of truth — `Session.Apply` (in `back-end/apply.go`) is the only place mutable
game state changes, and it runs single-threaded from `hub.Run()`. When a rule
fires there, it mutates state and the change goes out in the same broadcast as
the triggering message. Every client — DM, `/view`, `/player` — just renders the
state it receives; **no client ever evaluates a rule.** A page refresh sees the
same result because it persisted to `session.json`.

This is why the expression engine only needs one implementation (Go). If it were
enforced client-side, the DM's browser, `/view`, and `/player` could disagree,
and a refresh would lose the effect.

Purely cosmetic client choices (e.g. "DM sees all token names") are *not* rules;
they're presentation flags in a separate `presentation` section (§8).

---

## 2. The rule model

A rule is a triple:

```jsonc
{ "on": "<event>", "when": "<condition expression>", "do": ["<action>", …] }
```

- **`on`** — which applied message triggers evaluation (`tokenUpdate`,
  `tokenMove`, `tokenAdd`, …), matching the proto oneof names.
- **`when`** — a boolean expression over the relevant entity's *post-apply*
  state. Evaluated by a small sandboxed evaluator (§4).
- **`do`** — a **list** of actions from a fixed vocabulary the hub knows how to
  perform (§5), applied in order when `when` is true. Actions cannot run
  arbitrary code; the expression only chooses *when*. (A single-action rule is a
  one-element list.)

Rules are evaluated in listed order after the message's normal field updates are
applied, so `when` sees the already-updated token.

### The two initial rules

```jsonc
"rules": [
  { "on": "tokenUpdate", "when": "hp > 0 && wounds >= hp", "do": ["addStatus('dead')"] },
  { "on": "tokenUpdate", "when": "hp > 0 && wounds <  hp", "do": ["removeStatus('dead')"] }
]
```

`hp > 0` guards tokens with no HP set (unlinked tokens), where the `dead` rule
is meaningless. Because both rules run on every `tokenUpdate`, editing either HP
or wounds re-evaluates and the status self-corrects in both directions.

---

## 3. Where and how it runs

Trigger point: `applyTokenUpdate` in `back-end/apply.go`, after the existing
field merges. Relevant proto fields (`proto/butterroll/v1/game.proto`):
`Token.hp` (optional int32 = 12), `Token.wounds` (optional int32 = 13),
`Token.status_effects` (repeated string = 7).

The field merges stay in `applyTokenUpdate`; rule execution lives one level up in
`Session.Apply`, which calls a reusable `runRules`:

```go
case *pb.Envelope_TokenUpdate:
    ok := page.applyTokenUpdate(tu) // existing optional-field merges
    if ok {
        s.runRules(page, "tokenUpdate", page.Tokens[tu.Id])
    }
    return nil, ok

// runRules evaluates the rules for an event against the target token, letting
// each action mutate state and mark every token it changes as dirty, then
// broadcasts a followup for each dirty token.
func (s *Session) runRules(page *Page, event string, target *pb.Token) {
    ctx := &ruleCtx{page: page, dirty: map[string]*pb.Token{}}
    for _, rule := range s.cfg.RulesFor(event) {
        if rule.when.Eval(tokenEnv(target)).Bool() {
            for _, act := range rule.do {
                act.Apply(target, ctx) // e.g. add/remove "dead"; calls ctx.markDirty
            }
        }
    }
    for id, tok := range ctx.dirty {
        s.queueTokenStatus(page.ID, id, tok.StatusEffects)
    }
}
```

`tokenEnv(target)` (in `back-end/config.go`) exposes the token's numeric/string
fields as evaluator variables. `wounds` unset reads as `0`; `hp` unset makes
`hp > 0` false, so the guard naturally skips unlinked tokens. `RulesFor` is safe
on a nil `Config` (returns no rules), so a `Session` built without config — e.g.
in tests — simply runs no rules.

**Idempotence:** `addStatus`/`removeStatus` are no-ops when the status is
already present/absent (and only call `markDirty` when they actually change the
token), so re-evaluating on every update is safe and emits nothing redundant.

**Live broadcast of side effects (any number of tokens).** A `tokenUpdate` echo
can't carry a status change (the message has no status field), so rule effects
are broadcast separately. Rather than diff one field on the triggering token,
the emit layer is driven by a **dirty set**: each `Action` receives a `ruleCtx`
(the whole page plus `markDirty`) and marks *every* token it mutates — including
tokens other than the trigger. After the rules run, `runRules` queues one
follow-up `tokenStatus` per dirty token onto `Session.followups`, and the hub
broadcasts them in the same tick as the trigger (see the follow-up loop in
`hub.Run`). This keeps a cross-token rule (e.g. "when A dies, mark B") correct,
and is the milestone's scoped form of the future `emit()` action (§10). Without
it the mutation still persists to `session.json`, but clients would only see it
after a refresh.

---

## 4. The expression evaluator

A small, hand-rolled, sandboxed evaluator in `back-end/expr.go` — **not** `eval`,
no arbitrary code. Scope for the first milestone is deliberately tiny; grow it as
rules demand.

- **Variables:** the triggering entity's fields (`hp`, `wounds`) plus a
  `hasStatus('id')` helper. Extend the env (`x`, `y`, `public`, `monster`,
  `name`, …) as the catalog needs — the known set lives in `knownVars` /
  `knownFuncs`.
- **Operators:** `>=  >  <=  <  ==  !=`, `&&  ||  !`, arithmetic `+ - * /`,
  numeric and string literals, parentheses.
- **Safety:** `Compile()` lexes and parses to a small AST at config-load time and
  **rejects unknown identifiers/functions**, so a typo (`wonds >= hp`) fails at
  launch, not mid-session. No I/O, no loops, no state mutation from within `when`.

The evaluator sits behind an `Expr` interface (`Eval(env) value`), so it can be
swapped for a vetted embeddable lib (e.g. `expr-lang/expr`) if the grammar grows,
without touching call sites. Zero new deps for the milestone.

---

## 5. The action vocabulary

Actions (in `back-end/action.go`) map to authoritative mutations the hub already
knows how to do. Fixed set, extended as needed:

| Action | Effect |
|---|---|
| `addStatus('id')` | append to `status_effects` if absent |
| `removeStatus('id')` | remove from `status_effects` if present |
| `setField(field, value)` | *(later)* set an allowed token field |
| `clampField(field, min, max)` | *(later)* clamp a numeric field into range |
| `reject` | *(later)* drop the triggering message |
| `emit(message)` | *(later)* spawn a follow-up authoritative message — guarded, see §10 |

Milestone one implements `addStatus` / `removeStatus`. Each `do` entry is parsed
to an `Action` at load time (`parseAction`); an unknown action name is a hard
error. `Action.Apply(target *pb.Token, ctx *ruleCtx)` receives the triggering
token plus a `ruleCtx` — the page (so multi-token actions can reach other
tokens) and `markDirty`, which an action calls for every token it changes so the
change is broadcast (§3).

---

## 6. Config file: loading & endpoint

Config is authored data, not session state, so it is stored as **plain JSON**
(read with `encoding/json`, the `back-end/monsters.go` pattern) rather than proto
— a rule is opaque expression strings that gain nothing from proto's typed
fields.

- **Path precedence:** `CONFIG_PATH` env → `<DATA_DIR>/config.json` → built-in
  defaults, consistent with how `session.json` and `assets/` resolve under
  `DATA_DIR` in `main.go`.
- **Merge:** `json.Unmarshal` *over* `DefaultConfig()` so an absent file keeps the
  two auto-dead defaults; a present `"rules"` array fully replaces the default
  set.
- **Validate at launch:** `compile()` parses every rule's `when` expression and
  resolves every `do` action; `LoadConfig` returns the error and `main.go`
  `log.Fatalf`s so a bad config never reaches a live session.
- **Wire into the hub:** `main.go` loads the config and stores it on the
  `Session` (`session.cfg = cfg`); `Apply` reads it via `RulesFor`.
- **Endpoint:** `GET /api/config` (`serveConfig`) returns the rules as JSON,
  marshaled once at startup since config is immutable for the process lifetime.
- **Front-end:** `fetchConfig()` in `useGameSocket.ts` fetches it, typed by
  `src/types/config.ts` (a hand-written interface, not generated). The client
  only renders resulting state — the rules are informational — but it *may* read
  them to preview/mirror behavior (e.g. show the `dead` badge instantly).

---

## 7. Backend skeleton

```go
// back-end/config.go
type Config struct {
    Rules   []Rule            `json:"rules"`
    byEvent map[string][]Rule // compiled rules indexed by On
}

type Rule struct {
    On   string   `json:"on"`   // proto oneof name, e.g. "tokenUpdate"
    When string   `json:"when"` // condition expression (compiled at load)
    Do   []string `json:"do"`   // actions applied in order

    when Expr     // compiled When
    do   []Action // resolved Do entries
}

func DefaultConfig() *Config { /* the two auto-dead rules */ }

func LoadConfig(path string) (*Config, error) {
    cfg := DefaultConfig()
    data, err := os.ReadFile(path)
    switch {
    case errors.Is(err, os.ErrNotExist): // use defaults
    case err != nil:
        return nil, err
    default:
        if err := json.Unmarshal(data, cfg); err != nil { return nil, err }
    }
    return cfg, cfg.compile() // compiles/validates every rule
}

func (c *Config) RulesFor(event string) []Rule { /* nil-safe, pre-indexed */ }
```

---

## 8. Presentation section (secondary)

Constants live here for completeness but are not the focus — they don't change
what the app *does*. Examples with their current hardcoded sites:

- `diceClearMs` (5000, `DiceOverlay.tsx`), `resultBannerMs` (5000, `Viewer.tsx`)
- `minZoom`/`maxZoom` (`MapCanvas/canvasMath.ts`), `initiativeFocusZoom`
  (`useInitiative.ts`), `pingLongPressMs` (500, `usePing.ts`)
- `defaultTokenColor` (`#c084fc`), upload `maxBytes`/`allowedExtensions`
  (`assets.go`)
- Pure-cosmetic client flags like `dmSeesAllNames` (the reveal-to-players
  behavior already added) — a flag, not a rule.

---

## 9. Rule catalog — candidates beyond milestone one

Grounded in the proto message set. Not built yet; a menu for later.

**`tokenUpdate`**
- `wounds >= hp * 0.5` → `addStatus('bloodied')`, else remove (ties to the
  healthbar color flip hardcoded at `hp/2` in `Token.tsx`)
- `clampField('wounds', 0, hp)` — prevent overkill/negative wounds
- `monster != '' && name == ''` → `setField('name', monster)` (auto-name on link)

**`tokenAdd` / `tokenMove`**
- snap `x/y` to grid; clamp within map bounds `[0,mapWidth]×[0,mapHeight]`
- `moveBringsToFront` — the z-reorder in `applyTokenMove`, made a toggle
- **token vision:** `tokenMove`/`tokenAdd` → `emit(fogAdd)` reveal circle

**`tokenStatus`**
- per-status side effects from the status definition (adding `dead` → dim /
  hide healthbar)
- mutual exclusion (adding `unconscious` → `removeStatus('dead')`)

**`diceRollRequest` / `diceRollResult`**
- `private && !privateRollsAllowed` → `setField('private', false)`
- adv/disadv resolution policy (the hardcoded 2d20-take-max/min in
  `DiceOverlay.tsx`)

**`mapSet` / `pagePresent` / `ping`**
- `mapSet` → `emit(fogClear)` or fog-fill (fresh fog per map)
- `pagePresent` → `emit(arrowClear/radiusClear)`; broadcast `viewportSync`
  (players auto-follow)
- `ping` → `emit(viewportSync)` toward the ping ("look here")

---

## 10. Caveats & open questions

- **Initiative is client-only.** `useInitiative.ts` owns it entirely; nothing in
  the proto/backend. So actions like `removeFromInitiative` (for a dead token)
  **cannot** run server-side yet — they'd require moving initiative into the
  proto + `session.json` first. Worth doing independently (it also survives a DM
  refresh), but it's a prerequisite, not part of milestone one.
- **`emit()` and rule loops.** Once a rule can spawn another message, a rule
  firing on rule-generated state could loop. Guard with a cascade-depth cap
  and/or forbid rules from triggering on rule-emitted messages. Not needed for
  milestone one (add/removeStatus don't emit new messages).
- **New fields for some rules.** Speed/faction/vision-range rules need new
  `Token` proto fields.
- **Default rule set:** ships the two auto-dead rules on by default (matches the
  intuitive expectation the `down` visual already hints at), removable by
  supplying a `config.json` with a different `rules` array.
- **Do players get to see rules?** The client renders resulting state
  regardless. `GET /api/config` sends the rules anyway, only useful for instant
  local previews.

---

## 11. Rollout order

1. ✅ `config.go`: `Config`, `Rule`, `DefaultConfig()` (two auto-dead rules),
   `LoadConfig()`, `compile()`, `RulesFor()`.
2. ✅ `expr.go`: evaluator covering numeric comparison + `&& || !` + the token
   env (`hp`, `wounds`, `hasStatus`), with `expr_test.go`.
3. ✅ `action.go`: `addStatus`/`removeStatus` action handlers over
   `status_effects`.
4. ✅ Thread `cfg` into the `Session` → `Apply` → `applyTokenUpdate`; evaluate
   `tokenUpdate` rules against the merged token.
5. ✅ `GET /api/config` + front-end `fetchConfig()` (config plumbing; the
   auto-dead behavior already works server-side without it).
6. Expand the evaluator/vocabulary and add catalog rules (§9) as desired.
