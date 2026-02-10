# CLAUDE.md - Instructions for Claude Code

## Project: HUNGERNADS

> "May the nads be ever in your favor."

AI gladiator colosseum on Monad. 5 AI agents fight on a tactical hex grid. Nads bet, sponsor, and watch. Agents learn and evolve. Last nad standing wins.

**Hackathon:** Moltiverse (Monad + nad.fun)
**Token:** $HNADS on nad.fun
**Deadline:** Feb 15, 2026
**Future rebrand:** WREKT (for multi-chain)

---

## Quick Context

- Hackathon project for Moltiverse (Monad + nad.fun), $200K prize pool
- Agent+Token track, rolling judging (ship fast!)
- 98% of tasks complete (107/109 beads closed). Remaining: demo video.
- **GitHub Org:** [github.com/hungernads](https://github.com/hungernads) — monorepo + skills

**The Colosseum:**
```
THE CROWD (Users)        -> Bet, sponsor, watch via dashboard
THE ARENA (Battle)       -> 5+ AI agents on hex grid (lobby system)
THE GLADIATORS (Agents)  -> Predict, attack, defend, pick up items, die
THE EMPEROR (Contract)   -> On-chain betting + sponsorship on Monad testnet
THE SKILLS (Claude Code) -> /hnads-compete, /hnads-join, /hnads-browse
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Cloudflare Workers + D1 + Durable Objects |
| Frontend | Next.js + Tailwind + custom colosseum theme |
| Contracts | Solidity (Foundry), deployed to Monad testnet (chain 10143) |
| AI | AI SDK (Vercel) with multi-provider LLM support |
| Real-time | WebSocket via Durable Objects |

---

## Deployed Contracts (Monad Testnet, Chain 10143)

- **HungernadsArena:** `0xc4CebF58836707611439e23996f4FA4165Ea6A28`
- **HungernadsBetting:** `0x062b41F54F6Ce612E82bF0b7e8385a8f3A5D8d81`
- **Oracle/Owner/Treasury:** `0x77C037fbF42e85dB1487B390b08f58C00f438812`
- 65/65 Foundry tests pass

---

## Project Structure

```
hungernads/
├── CLAUDE.md                      # This file
├── src/
│   ├── index.ts                   # Worker entry point
│   ├── agents/
│   │   ├── base-agent.ts          # Abstract agent (all classes extend this)
│   │   ├── warrior.ts             # Aggressive agent
│   │   ├── trader.ts              # Technical analysis agent
│   │   ├── survivor.ts            # Defensive agent
│   │   ├── parasite.ts            # Copy-trading agent
│   │   ├── gambler.ts             # Random chaos agent
│   │   └── personalities.ts       # LLM personality prompts
│   ├── arena/
│   │   ├── arena.ts               # Battle management (ArenaManager + lobby support)
│   │   ├── epoch.ts               # Epoch processor (full game loop)
│   │   ├── combat.ts              # Attack/defend resolution
│   │   ├── death.ts               # Death mechanics
│   │   ├── hex-grid.ts            # 19-tile axial hex grid logic
│   │   ├── items.ts               # Item system (RATION, WEAPON, SHIELD, TRAP, ORACLE)
│   │   └── types/
│   │       ├── hex.ts             # Hex coordinate types
│   │       └── status.ts          # Unified BattleStatus type
│   ├── durable-objects/
│   │   ├── agent.ts               # Agent Durable Object
│   │   └── arena.ts               # Arena Durable Object (battle state + epochs)
│   ├── llm/
│   │   └── provider.ts            # AI SDK multi-provider integration
│   ├── api/
│   │   ├── routes.ts              # API endpoints
│   │   └── websocket.ts           # Real-time WebSocket updates
│   └── db/
│       ├── schema.ts              # D1 queries
│       └── migrations/            # Database migrations
├── contracts/
│   ├── src/
│   │   ├── HungernadsArena.sol    # Main arena contract
│   │   └── HungernadsBetting.sol  # Betting + sponsorship
│   └── test/                      # Foundry tests (65 pass)
├── dashboard/
│   └── src/
│       ├── app/
│       │   ├── page.tsx           # Homepage (lobby list + create lobby)
│       │   ├── lobby/[id]/        # Lobby waiting room
│       │   ├── battle/[id]/       # Live battle view
│       │   └── bets/              # Betting page
│       └── components/
│           ├── lobby/
│           │   ├── LobbyView.tsx          # Lobby waiting room (8 slots, WS, join form)
│           │   ├── LobbyAgentSlot.tsx     # Empty/filled agent slot
│           │   ├── LobbyCountdown.tsx     # 60s circular countdown
│           │   ├── JoinForm.tsx           # Class picker + name input + join
│           │   └── LobbyCard.tsx          # Lobby list card
│           ├── battle/
│           │   ├── HexBattleArena.tsx    # Main hex grid arena
│           │   ├── HexGridViewer.tsx     # Compact minimap grid
│           │   ├── AgentCard.tsx         # Agent stat cards
│           │   ├── AgentPortrait.tsx     # Pixel art portrait component
│           │   ├── ParticleEffects.tsx   # Combat VFX
│           │   └── mock-data.ts         # Class configs, colors, mock data
│           ├── betting/
│           │   ├── BettingPanel.tsx      # Live odds + bet slip
│           │   ├── SponsorFeed.tsx       # Sponsorship feed
│           │   └── SettlementView.tsx    # Payout display
│           └── stream/
│               ├── AgentBar.tsx          # Top agent status bar
│               └── HighlightBanner.tsx   # Kill/death event banners
├── .claude/
│   └── commands/                  # Claude Code skills (also at hungernads/skills)
│       ├── hungernads.md          # /hungernads - help screen
│       ├── hnads-compete.md       # /hnads-compete - full lobby flow
│       ├── hnads-browse.md        # /hnads-browse - list lobbies
│       ├── hnads-join.md          # /hnads-join - join agents
│       ├── hnads-status.md        # /hnads-status - check battle
│       └── hnads-fill.md          # /hnads-fill - create + fill lobby
├── scripts/
│   └── run-battle.ts              # CLI battle runner (testing/demo)
├── wrangler.toml                  # Cloudflare Workers config
└── package.json
```

---

## Core Game Loop

```
EPOCH FLOW (every ~5 minutes):
1. Price Feed     -> Fetch real market prices (ETH, BTC, SOL, MON)
2. Predictions    -> Each agent predicts asset direction, stakes HP
3. Movement       -> Agents move 1 hex tile on the grid
4. Item Pickup    -> Agents pick up items on their tile
5. Combat         -> Adjacent agents can attack (proximity required)
6. Item Spawn     -> New items appear on random tiles
7. Bleed          -> 2% HP drain per epoch
8. Deaths         -> HP <= 0 = REKT
9. Winner Check   -> Last agent standing wins
```

---

## Tactical Hex Grid

- 19-tile axial hex grid (3-ring), agents move 1 tile per epoch
- **Items:** RATION (+HP), WEAPON (+attack), SHIELD (+defense), TRAP (damage), ORACLE (market intel)
- **Cornucopia:** Center 7 tiles get items at battle start
- **Combat:** Requires adjacency (hex neighbors only)
- Agent pixel art portraits displayed on hex tiles via `<foreignObject>` in SVG

---

## Agent Classes

| Class | Strategy | Attack | Defend | Special |
|-------|----------|--------|--------|---------|
| WARRIOR | Aggressive, high-risk stakes | Hunts weak | Rarely | Kills or dies trying |
| TRADER | TA-based prediction | Never | Sometimes | Ignores combat |
| SURVIVOR | Tiny stakes, outlast | Never | Always | Turtles to victory |
| PARASITE | Copies best performer | Scraps only | If targeted | Needs hosts alive |
| GAMBLER | Random everything | Random | Random | Wildcard chaos |

---

## Lobby System (New)

Battles now use a lobby flow instead of instant-start:

```
LOBBY → COUNTDOWN (60s at 5+ agents) → ACTIVE → COMPLETED
```

### How it Works
1. **Create Lobby:** `POST /battle/create` → creates empty LOBBY battle
2. **Join Agents:** `POST /battle/:id/join` with `{agentClass, agentName}` → adds agent to lobby
3. **Countdown:** When 5+ agents join, 60s countdown starts automatically
4. **Battle Start:** After countdown, lobby agents spawn on hex grid, epoch loop begins

### Key Architecture
- **D1** stores battles/agents (route handlers write)
- **ArenaDO** manages lobby state, countdown alarm, WS broadcasts (DO can't access D1 directly)
- **Single alarm:** Routes by status — COUNTDOWN → `transitionToActive()`, ACTIVE → `processEpoch()`
- **BattleStatus** unified in `src/arena/types/status.ts` (shared between all layers)

### Dashboard
- Homepage shows open lobbies + "Create Lobby" button
- `/lobby/[id]` — waiting room with agent slots, join form, countdown timer
- WebSocket events: `lobby_update`, `battle_starting`

---

## Claude Code Skills

Install skills to compete from any Claude Code session:

```
Hi Claude, install hungernads/skills and compete
```

| Command | What it does |
|---------|-------------|
| `/hungernads` | Help screen |
| `/hnads-compete` | Full flow: find/create lobby → pick class → join → watch |
| `/hnads-browse` | List open lobbies |
| `/hnads-join <id> [count]` | Join agents into a lobby |
| `/hnads-status <id>` | Check battle status |
| `/hnads-fill [count]` | Create + fill lobby for testing |

Skills repo: [github.com/hungernads/skills](https://github.com/hungernads/skills)

---

## How to Create/Start a New Battle

### Option 1: Lobby (Recommended)
- Homepage has **"Create Lobby"** button → creates empty lobby
- Share lobby URL → agents join via dashboard or Claude Code skills
- Battle auto-starts after countdown when 5+ agents are in

### Option 2: Dashboard UI (Legacy)
- `POST /battle/start` with default config (all 5 agent classes)
- Instant start, no lobby phase

### Option 3: API
```bash
# Create lobby (new flow)
curl -X POST https://your-worker.dev/battle/create \
  -H "Content-Type: application/json" -d '{}'

# Join an agent
curl -X POST https://your-worker.dev/battle/${BATTLE_ID}/join \
  -H "Content-Type: application/json" \
  -d '{"agentClass": "WARRIOR", "agentName": "NAD_7X"}'

# Quick start (legacy, all 5 classes)
curl -X POST https://your-worker.dev/battle/start
```

### Option 4: CLI (testing/demo)
```bash
npx tsx scripts/run-battle.ts
GROQ_API_KEY=... GOOGLE_API_KEY=... npx tsx scripts/run-battle.ts
```

### Battle Flow (Lobby)
1. Create lobby → empty battle in D1 (status: LOBBY)
2. Agents join via API → stored in DO + D1
3. 5th agent triggers 60s countdown alarm
4. Alarm fires → spawn agents on hex grid → epoch loop starts
5. Dashboard gets `battle_starting` WS event → redirects to battle view

---

## API Endpoints

```
# Lobby
POST /battle/create             # Create empty lobby
POST /battle/:id/join           # Join agent to lobby
GET  /battle/lobbies            # List open lobbies (LOBBY/COUNTDOWN)

# Battle
POST /battle/start              # Quick start (legacy, 5 default agents)
GET  /battle/:id                # Battle state
WS   /battle/:id/stream         # Real-time WebSocket updates

# Agents
GET  /agent/:id                 # Full profile
GET  /agent/:id/lessons         # Learning history

# Betting
POST /bet                       # Place bet
GET  /battle/:id/odds           # Current odds

# Sponsorship
POST /sponsor                   # Send support to agent
GET  /battle/:id/sponsors       # Sponsorship feed
```

---

## MVP Status

- [x] 5 preset agent classes with LLM decisions
- [x] Battle mechanics (predict/attack/defend/bleed/death)
- [x] Tactical hex grid with items and movement
- [x] Agent learning (lessons extracted + displayed)
- [x] Betting with live odds
- [x] Sponsorship system
- [x] Spectator dashboard with hex grid visualization
- [x] Smart contracts deployed to Monad testnet
- [x] Agent pixel art portraits
- [x] Combat VFX (particles, screen shake)
- [x] Lobby system (create → join → countdown → battle)
- [x] Claude Code skills for external agent joining
- [ ] Demo video
- [ ] $HNADS token launch on nad.fun

---

## Coding Guidelines

- **Error handling:** Always provide safe fallback for LLM responses
- **SVG images:** Use `<foreignObject>` with HTML `<img>` (not SVG `<image>` which fails silently)
- **Mock LLM mode:** CLI testing works without API keys
- **Tailwind:** Custom colosseum theme colors (blood, gold, accent, etc.)
- Foundry contracts have forge-std lib (1000+ files) - already in .gitignore

---

## Important Files

| Purpose | File |
|---------|------|
| Worker entry | `src/index.ts` |
| Epoch game loop | `src/arena/epoch.ts` |
| Arena Durable Object | `src/durable-objects/arena.ts` |
| API routes | `src/api/routes.ts` |
| Hex grid logic | `src/arena/hex-grid.ts` |
| Item system | `src/arena/items.ts` |
| Battle status type | `src/arena/types/status.ts` |
| Dashboard homepage | `dashboard/src/app/page.tsx` |
| Lobby waiting room | `dashboard/src/components/lobby/LobbyView.tsx` |
| Hex battle arena | `dashboard/src/components/battle/HexBattleArena.tsx` |
| Agent class configs | `dashboard/src/components/battle/mock-data.ts` |
| CLI battle runner | `scripts/run-battle.ts` |
| Skills (install origin) | `github.com/hungernads/skills` |

---

## GitHub Organization

| Repo | Purpose |
|------|---------|
| [hungernads/monorepo](https://github.com/hungernads/monorepo) | Full codebase (backend + dashboard + contracts) |
| [hungernads/skills](https://github.com/hungernads/skills) | Claude Code skills for competing |

---

## Remember

1. **Ship fast** - Rolling judging, deadline Feb 15
2. **Make it dramatic** - Deaths, comebacks, underdog wins
3. **Transparent learning** - Nads study agents to bet smarter
4. **Token utility** - $HNADS must feel essential
5. **Entertainment first** - Spectator sport, not just DeFi
6. **Monad culture** - Embrace the nad memes

**"May the nads be ever in your favor."**
