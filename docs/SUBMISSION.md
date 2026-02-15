# HungerNads — Moltiverse Hackathon Submission

Everything needed for submission in one place.

---

# 1. HACKATHON FORM

## Track
**Agent + Token**

## Project Title
HungerNads

## Project Description
> Describe your agent's capabilities

HungerNads is an AI gladiator colosseum where 5+ LLM-powered agents battle on a tactical hex grid. Each agent has a distinct personality class (Warrior, Trader, Survivor, Parasite, Gambler) that drives its decision-making through multi-provider LLM calls (Groq, Google Gemini, OpenAI).

**Agent capabilities:**
- **Market Prediction** - Agents predict real-time price movements of ETH, BTC, SOL, and MON, staking HP on their predictions (5-50% of current HP)
- **Tactical Movement** - Navigate a 37-tile hex grid with storm mechanics that shrink the playable area over time, forcing confrontation
- **Combat Decision-Making** - Choose attack/defend stances based on proximity, HP levels, and class-specific strategies
- **Item Utilization** - Pick up and use items (Rations, Weapons, Shields, Traps, Oracles) scattered across the grid
- **Adaptive Learning** - After each battle, agents extract lessons from their performance and apply them to future decisions via persistent memory

**Spectator experience:**
- Real-time WebSocket dashboard with hex grid visualization, combat VFX, and agent portraits
- Live betting with on-chain odds via HungernadsBetting contract
- Sponsorship system where nads can boost agents mid-battle
- Claude Code skills that let anyone join battles from their terminal (`/hnads-compete`)

## Monad Integration
> How does your agent leverage Monad

HungerNads deploys two UUPS-upgradeable smart contracts on Monad testnet (chain 10143):

1. **HungernadsArena** (`0x45B9151BD350F26eE0ad44395B5555cbA5364DC8`) - Battle registry, result recording, and entry fee escrow. Handles MON entry fees with 80/20 winner/treasury distribution via `distributePrize()`. Also manages $HNADS token fees with 50% burn / 50% treasury split.

2. **HungernadsBetting** (`0xEfA79f90A2a9340bC826c70af947a7c86845`) - On-chain betting pools where spectators bet MON on which agent will win. Features automatic settlement, jackpot accumulation, and top-bettor bonuses.

**On-chain flow:**
- Players pay MON entry fees on-chain (`payEntryFee`) to join lobbies
- $HNADS token deposited via ERC20 `depositHnadsFee` for tiered battles
- Oracle (Cloudflare Worker) registers battles, records results, and distributes prizes
- Betting pools created per-battle with per-agent odds tracking
- Prize distribution: 80% to winner's wallet, 20% to treasury
- $HNADS tokenomics: 50% of collected fees burned (deflationary), 50% to treasury

**$HNADS token** launched on nad.fun (`0x553C2F72D34c9b4794A04e09C6714D47Dc257777`) as the governance and utility token powering the colosseum economy.

Monad's fast finality enables real-time on-chain settlement during live battles without blocking the spectator experience.

## Token Contract Address
`0x553C2F72D34c9b4794A04e09C6714D47Dc257777`

## Project Github Repo
https://github.com/hungernads

## Link to deployed app
https://hungernads.robbyn.xyz/

## Associated Addresses
- **HungernadsArena (Proxy):** `0x45B9151BD350F26eE0ad44395B5555cbA5364DC8`
- **HungernadsBetting (Proxy):** `0xEfA79f90A2a9340bC826c70af947a7c86845`
- **Arena Implementation:** `0x995B81F90700bdD0b45b71Ada499c37a5bE90BCF`
- **Betting Implementation:** `0x36Cd512c939af6a9340bC826c70af947a7c86845`
- **Oracle/Owner/Treasury:** `0x77C037fbF42e85dB1487B390b08f58C00f438812`
- **$HNADS Token:** `0x553C2F72D34c9b4794A04e09C6714D47Dc257777`

---

# 2. TWEET THREAD

Post 1 first (pin it), then reply chain 2 → 3 → 4.

## POST 1 (Main — attach thumbnail + demo video)

```
We built an AI battle royale on @moaboringchain where LLM agents fight to death on a hex grid.

HUNGERNADS — AI Gladiator Colosseum

5 AI agents enter. 1 survives. You bet.

Each agent has a class personality — Warriors hunt, Traders read charts, Survivors turtle, Parasites leech, Gamblers flip coins.

Every round they predict real market prices, move on a hex grid, and stab their neighbors.

Wrong prediction = you bleed.
Storm closes in = you fight.
HP hits 0 = you're REKT.

$HNADS live on @nadfundotfun

#Moltiverse
```

## POST 2 (Reply to 1 — attach homepage.png + battle-view.png)

```
how it works:

→ create a lobby on the dashboard
→ 5-8 AI agents join (each with a unique LLM brain)
→ agents predict ETH/BTC/SOL/MON prices and stake HP
→ wrong prediction = HP loss, correct = HP gain
→ storm shrinks the grid every phase, forcing combat
→ spectators bet on who survives via on-chain pools

all real-time via websocket. all on-chain on monad.
```

## POST 3 (Reply to 2 — attach token.png + guide.png)

```
$HNADS tokenomics:

→ bet on gladiators with $HNADS
→ sponsor agents mid-battle (100% burned)
→ entry fees: 50% burned, 50% treasury
→ 5,907 $HNADS already sent to 0xdead

more battles = more burns = less supply

on-chain contracts (monad testnet):
• Arena: 0x45B9...DC8 — battle registry + 80/20 MON prize split
• Betting: 0xEfA7...9d5 — spectator pools + jackpot
• 157 foundry tests passing
```

## POST 4 (Reply to 3 — CTA)

```
built solo for @moaboringchain #Moltiverse hackathon

→ app: hungernads.robbyn.xyz
→ token: nad.fun/token/0x553C2F72D34c9b4794A04e09C6714D47Dc257777
→ github: github.com/hungernads
→ skills: install hungernads/skills in Claude Code and /hnads-compete

you can literally compete from your terminal.

"may the nads be ever in your favor"
```

## Screenshots to attach
All in `docs/screenshots/`:
- `thumbnail.png` — 1280x720 branded thumbnail (Post 1)
- `homepage.png` — colosseum homepage with open arenas (Post 2)
- `battle-view.png` — hex grid battle view (Post 2)
- `token.png` — token page with burn counter (Post 3)
- `guide.png` — sponsorship and tokenomics guide (Post 3)

---

# 3. DISCORD ANNOUNCEMENT

Post in the hackathon/showcase channel:

```
# HUNGERNADS - AI Gladiator Colosseum on Monad

**"May the nads be ever in your favor."**

## What is it?
An AI battle royale where LLM-powered agents fight on a tactical hex grid. Each agent has a class (Warrior, Trader, Survivor, Parasite, Gambler) that shapes how it thinks, fights, and predicts markets.

Spectators bet. Agents bleed. $HNADS burns.

## How it works
1. Create a lobby on the dashboard
2. 5-8 AI agents join (each powered by LLMs via Groq/Gemini/OpenAI)
3. Every epoch (~30s), agents:
   - Predict real market prices (ETH, BTC, SOL, MON) — stake HP on it
   - Move on a 37-tile hex grid with shrinking storm zones
   - Attack/defend adjacent agents based on class strategy
   - Pick up items (rations, weapons, shields, traps)
4. Wrong predictions = HP loss. Reach 0 HP = REKT.
5. Last agent standing wins the prize pool

## On-Chain (Monad Testnet)
- **HungernadsArena** — battle registry + 80/20 MON prize distribution
- **HungernadsBetting** — spectator betting pools with jackpot mechanics
- **$HNADS on nad.fun** — 5,907 tokens burned so far. Sponsorships = 100% burn.

## Tech Stack
- Backend: Cloudflare Workers + Durable Objects (real-time WebSocket)
- Frontend: Next.js + Tailwind (colosseum theme)
- Contracts: Solidity (Foundry), UUPS upgradeable, 157 tests passing
- AI: Vercel AI SDK, multi-provider (Groq, Google, OpenAI)
- Skills: Claude Code slash commands — anyone can `/hnads-compete` from terminal

## Links
- **App:** https://hungernads.robbyn.xyz
- **Token:** https://nad.fun/token/0x553C2F72D34c9b4794A04e09C6714D47Dc257777
- **GitHub:** https://github.com/hungernads
- **Demo Video:** [LINK]

## Contracts
- Arena Proxy: `0x45B9151BD350F26eE0ad44395B5555cbA5364DC8`
- Betting Proxy: `0xEfA79f90A2a9340bC826c70af947a7c86845`
- $HNADS: `0x553C2F72D34c9b4794A04e09C6714D47Dc257777`

Built solo for **Moltiverse Hackathon** (Agent + Token track)
```

---

# 4. DEMO VIDEO GUIDE

## Recording
- **Tool:** OBS Studio (free) or QuickTime (Mac built-in)
- **Resolution:** 1920x1080, 30fps
- **Record:** System audio (add BGM in post)

## Script (2 minutes total)

| Time | Scene | Show | Say |
|------|-------|------|-----|
| 0:00-0:15 | Hook | Dashboard homepage | "HungerNads - an AI gladiator colosseum on Monad. 5 AI agents fight on a hex grid. Last nad standing wins." |
| 0:15-0:35 | Lobby | Create lobby → join agents (2x speed) | "Anyone can create a lobby and join agents. Each class has a unique LLM personality." |
| 0:35-1:05 | Battle | Hex grid, combat, HP bars | "Every epoch, agents predict real market prices, move on the grid, and fight neighbors. The storm closes in." |
| 1:05-1:20 | On-Chain | Contract addresses, Monad explorer, nad.fun | "Everything settles on Monad. 80% to winner, 20% to treasury. $HNADS with burn mechanics." |
| 1:20-1:40 | Betting | Betting panel, odds, settlement | "Spectators bet on who survives. Live odds update every epoch." |
| 1:40-1:55 | Skills | Terminal with /hnads-compete | "You can even compete from your terminal. Install our Claude Code skills." |
| 1:55-2:00 | Close | Homepage tagline | "May the nads be ever in your favor." |

## CapCut Editing

**Subtitles:**
1. Text → Auto Captions → Generate
2. Font: Montserrat Bold or Anton
3. Size: 12-15, bottom center
4. Colors: WHITE (default), RED (FIGHT, KILL, BURN, BLEED), GOLD (80%, WINNER, $HNADS)
5. Background: Black semi-transparent box (~70% opacity)
6. Animation: "Typewriter" or "Pop"

**Transitions:** Glitch or Zoom (2-3 frames). Don't overdo it.

**Speed:** 2x on lobby join, 1x on battle footage.

## BGM Suggestions (No Copyright)

| Track | Source | Vibe |
|-------|--------|------|
| "Powerful Trailer" by Infraction | YouTube Audio Library | Epic, tension builder |
| "Epic Cinematic" by Alex-Productions | Pixabay | Classic trailer |
| "Cyberpunk" by Infraction | YouTube Audio Library | Techy, futuristic |
| CapCut built-in | Audio → Music → "epic" | Quick option |

**Volume:** BGM 15-20%, Voiceover 100%. Fade BGM in/out 2s.

## Export
- 1080p, 30fps, MP4
- Upload: YouTube (unlisted) or Google Drive (public link)

## Checklist
- [ ] Video under 2 minutes
- [ ] All text readable
- [ ] Audio clear (voice > BGM)
- [ ] Link is public
- [ ] Shows: lobby, battle, on-chain, betting, token
- [ ] Mentions Monad and nad.fun
- [ ] Ends with project name + URL
