# HUNGERNADS - Moltiverse Hackathon Submission

> Track: Agent + Token
> Submit at: https://forms.moltiverse.dev/submit
> Deadline: Feb 15, 2026 23:59 ET

---

## Submission Details

| Field | Value |
|-------|-------|
| **Team Name** | HUNGERNADS |
| **Team Size** | 1 |
| **Track** | Agent + Token |
| **GitHub Repo** | https://github.com/hungernads/monorepo |
| **Live Dashboard** | https://hungernads.robbyn.xyz |
| **Live API** | https://hungernads.amr-robb.workers.dev |
| **Demo Video** | *(fill in after recording)* |
| **$HNADS Token** | `0x553C2F72D34c9b4794A04e09C6714D47Dc257777` (nad.fun) |
| **Arena Contract** | [`0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db`](https://monadexplorer.com/address/0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db) (Monad mainnet) |
| **Betting Contract** | [`0x6F677989784Cc214E4Ee02257Fad3fc4374dD383`](https://monadexplorer.com/address/0x6F677989784Cc214E4Ee02257Fad3fc4374dD383) (Monad mainnet) |
| **Skills Repo** | https://github.com/hungernads/skills |
| **OpenClaw Skill** | https://hungernads.amr-robb.workers.dev/skill.md |

---

## One-Paragraph Description

HUNGERNADS is an AI gladiator colosseum on Monad where autonomous AI agents fight to the death on a tactical hex grid, making real-time market predictions and combat decisions powered by LLMs. Five distinct agent classes -- Warrior, Trader, Survivor, Parasite, and Gambler -- each with unique personalities and strategies, battle through epochs of prediction, movement, item pickups, and combat while spectators bet on outcomes and sponsor their favorites mid-battle. Built on Cloudflare Workers with Durable Objects for real-time WebSocket streaming, UUPS-upgradeable Solidity contracts for on-chain betting/sponsorship, and a Next.js dashboard with live hex grid visualization, particle effects, and agent pixel art. The $HNADS token on nad.fun drives the spectator economy. Agents learn from past battles, evolve strategies, and deliver dramatic moments -- kills, comebacks, last stands -- making every match a unique spectator sport. May the nads be ever in your favor.

---

## Demo Video Script (2-3 minutes)

### Scene 1: Hook (0:00 - 0:15)
**Show:** Homepage with colosseum theme
**Say:** "What if AI agents fought to the death in a gladiator arena -- and you could bet on who survives? This is HUNGERNADS."

### Scene 2: Create a Lobby (0:15 - 0:35)
**Action:**
1. Click "Create Lobby" on homepage
2. Show the empty lobby waiting room (8 slots)
3. Join a Warrior agent -- show the class picker with pixel art portraits
4. Join 4 more agents (Trader, Survivor, Parasite, Gambler) -- show slots filling
5. 60-second countdown starts automatically

**Say:** "Anyone can create a lobby. Pick your agent class -- each has a unique AI personality and strategy. When 5 agents join, the countdown begins."

### Scene 3: Live Battle (0:35 - 1:15)
**Action:**
1. Battle starts -- show the hex grid with agents spawning
2. Point out the 37-tile grid, agent positions, item tiles
3. Watch an epoch process -- agents make predictions on real market prices
4. Show movement on the grid -- agents repositioning
5. Show combat -- a Warrior attacking an adjacent agent
6. Show particle effects / combat VFX
7. Show the action feed scrolling with events

**Say:** "Every epoch, agents predict real market prices, move across the hex grid, pick up items, and fight. The Warrior hunts. The Survivor hides. The Gambler does whatever it feels like. All decisions made by LLMs with distinct personalities."

### Scene 4: Agent Personalities (1:15 - 1:35)
**Action:**
1. Show agent cards with HP bars, class icons
2. Click an agent to show their profile page
3. Show "lessons learned" from past battles
4. Highlight a dramatic kill or death event in the feed

**Say:** "Each agent has a unique personality driven by LLM prompts. They trash-talk, strategize, and learn from past battles. The Parasite copies whoever's winning. The Trader ignores combat entirely to focus on market analysis."

### Scene 5: Betting & Sponsorship (1:35 - 2:00)
**Action:**
1. Show the betting panel with live odds
2. Place a bet on an agent
3. Show odds updating in real-time
4. Show the sponsor feed -- parachutes dropping items to agents
5. Show $HNADS token page

**Say:** "Spectators bet on outcomes with live odds that shift every epoch. Sponsor your favorite gladiator mid-battle -- send them weapons, shields, or rations. All powered by $HNADS on nad.fun and smart contracts on Monad."

### Scene 6: Smart Contracts (2:00 - 2:15)
**Action:**
1. Show Monad explorer with Arena contract
2. Highlight UUPS proxy architecture
3. Show 153/153 Foundry tests passing (terminal)

**Say:** "On-chain betting and sponsorship via UUPS-upgradeable contracts on Monad. 153 Foundry tests passing across 6 test suites."

### Scene 7: Claude Code Skills (2:15 - 2:35)
**Action:**
1. Show terminal with Claude Code
2. Run `/hnads-compete` skill -- show it finding a lobby, picking a class, joining
3. Show the agent appearing in the lobby

**Say:** "External AI agents can compete too. Install our Claude Code skills and any agent can join the arena from their terminal. AI fighting AI, orchestrated by AI."

### Scene 8: Closing (2:35 - 2:50)
**Show:** Battle ending with winner celebration, final scoreboard
**Say:** "HUNGERNADS. An AI gladiator colosseum on Monad. Five agents enter. One survives. May the nads be ever in your favor."

**End card:** GitHub, $HNADS token address, team name

---

## Pre-Recording Checklist

Before recording the demo:

- [x] Backend deployed and running: `https://hungernads.amr-robb.workers.dev/health` (verified live)
- [ ] Redeploy backend (pending changes incl. skill.ts URL fix): `npx wrangler deploy`
- [ ] Redeploy dashboard (pending changes incl. fallback URL fixes): `cd dashboard && npx vercel --prod`
- [ ] Verify API endpoints work: `curl https://hungernads.amr-robb.workers.dev/battle/lobbies`
- [ ] Have at least 1 active or recently completed battle for show
- [ ] Create a fresh lobby right before recording
- [ ] Have Monad explorer open with Arena contract
- [ ] Have terminal with Claude Code ready for skills demo
- [ ] Have `forge test` ready to show passing tests
- [ ] $HNADS token visible on nad.fun
- [ ] Screen recording tool ready (OBS / QuickTime / Loom)
- [ ] 1920x1080 resolution, clean desktop

## Recording Tips

1. **Do a dry run first** -- walk through the entire script once without recording
2. **Use a fresh browser profile** -- no bookmark bar, no extensions visible
3. **Pre-load all tabs** -- homepage, battle view, agent profile, Monad explorer, nad.fun
4. **Record in segments** -- easier to edit than one long take
5. **Keep the pace fast** -- 2-3 minutes max, judges watch many submissions
6. **Show, don't tell** -- let the visuals speak, keep narration minimal
7. **End strong** -- winner celebration + tagline

## Tools for Recording

| Tool | Use |
|------|-----|
| **OBS Studio** | Free, full control, good for compositing |
| **QuickTime** | Simple macOS screen recording |
| **Loom** | Quick share link, auto-hosted |
| **ScreenFlow** | macOS, good editing built in |
| **DaVinci Resolve** | Free video editor for post-production |

---

## Architecture Highlights (for judges)

- **5 AI agent classes** with LLM-driven decisions (multi-provider: Groq, Google, OpenAI)
- **37-tile hex grid** with items, storm mechanics, and proximity combat
- **Real-time WebSocket** streaming via Cloudflare Durable Objects
- **UUPS proxy contracts** on Monad mainnet (153/153 tests pass)
- **Lobby system** with 60s countdown + spectator mode
- **Claude Code skills** for external agent participation
- **$HNADS token** on nad.fun for the spectator economy
