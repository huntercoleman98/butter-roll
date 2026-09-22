# butter-roll — working notes for Claude

A browser tabletop map tool: Go WebSocket back-end (`back-end/`) with an
authoritative `Session.Apply` state machine, React 19 + TypeScript front-end
(`front-end/`), protobuf-defined wire types (`proto/`, generated into
`back-end/gen/` and `front-end/src/gen/`). See `documentation/CONTEXT.md` for
architecture — but note it is currently stale (see `documentation/REFACTORING.md` §8).

## Architecture guardrails (read before adding to a large file)

This codebase has a documented tendency to **decompose then re-accumulate**:
components get split into hooks, then regrow as features land (`DM.tsx` went
693 → 975 lines this way). Hold the line:

- **Page components (`front-end/src/pages/*.tsx`) stay thin.** When one approaches
  ~300 lines, extract a feature hook into `front-end/src/hooks/` instead of adding
  more inline. Follow the existing pattern: `useInitiative`, `usePages`,
  `useDiceHistory`, `useTokenClipboard`, `usePanels`.
- **Canvas tools go in `MapCanvas/tools/`** as a `use*Tool` hook implementing the
  `Tool` contract (`tools/types.ts`), not as new branches in `MapCanvas.tsx`.
- **Don't copy roll/advantage logic inline.** Dice math and label strings belong
  in the dice util alongside `parseDiceExpression` (currently duplicated — see
  REFACTORING §7; consolidate rather than adding a 4th copy).
- **Prefer classes in `App.css`** over new structural `style={{…}}` objects; keep
  inline styles only for genuinely dynamic values (cursor-driven `left`/`top`).
- **New wire fields:** edit `proto/butterroll/v1/game.proto` and run `make proto`.
  Never hand-edit `back-end/gen/` or `front-end/src/gen/`.

Hard limits back these up: ESLint `max-lines`/`max-lines-per-function`/`complexity`
(front-end) and golangci-lint `funlen`/`gocyclo`/`cyclop` (back-end), both run via
`make lint`. If your change trips a warning, that's the signal to extract — don't
raise the threshold or add a disable comment without a stated reason.

## Commands

- `make lint` — size/complexity guardrails (front-end ESLint + back-end golangci-lint)
- `make build` — regenerate proto, build front-end, build Go binary
- `make dev-frontend` / `make dev-backend` — dev servers
- `cd back-end && go test -tags dev ./...` — back-end tests (the `dev` tag skips
  the prod-only `//go:embed dist`, which is absent without a build; no front-end
  test runner yet)
