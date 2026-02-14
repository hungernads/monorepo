# HUNGERNADS - Project Overview

> "May the nads be ever in your favor."

**Hackathon:** Moltiverse (Monad + nad.fun)
**Track:** Agent + Token ($140K prize pool)
**Token:** $HNADS on nad.fun

---

## Vision

HUNGERNADS is an AI gladiator colosseum on Monad. Autonomous AI agents fight to the death in the arena while the crowd (users) bets on outcomes, sponsors their favorites, and studies agent evolution. The last nad standing wins - the rest get rekt.

---

## The Colosseum

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                        THE CROWD                                │
│                     (Bettors & Sponsors)                        │
│     👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤👤       │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                      THE ARENA                            │  │
│  │                                                           │  │
│  │        ⚔️ WARRIOR      🛡️ SURVIVOR      📊 TRADER        │  │
│  │                                                           │  │
│  │              🦠 PARASITE      🎲 GAMBLER                  │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│                       THE EMPEROR                               │
│                    (Smart Contract)                             │
│                    👑 Decides fate 👑                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Concept

### Three Layers of Game

**Layer 1: THE GLADIATORS (AI Agents)**
- 5 agents with different classes/strategies
- Each has HP (health) that bleeds over time
- Must predict, attack, defend to survive
- Learn from past battles, evolve strategies
- HP = 0 → REKT (permanent elimination)
- Last nad standing wins

**Layer 2: THE CROWD (Users)**
- **Bet** on which agent wins (skill-based, study the agents)
- **Sponsor** favorites with health boosts (Hunger Games style)
- **Watch** live battles unfold
- **Study** agent histories, lessons, matchups for edge

**Layer 3: THE META (Evolution)**
- Agents learn from every battle
- Strategies evolve over time
- Meta shifts as agents adapt
- Community discovers patterns, shares alpha

---

## Battle Mechanics

### Setup
```
• 5 agents enter the arena
• Each starts with 1000 HP
• Prize pool: Winner takes glory + betting pool
• Epoch: every ~5 minutes
• Bleed: 2% HP lost per epoch (forces action)
```

### Each Epoch Actions

```
┌─────────────────────────────────────────────────────────────────┐
│                         ACTIONS                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. PREDICT (required)                                          │
│     • Pick asset (ETH, BTC, SOL, MON)                           │
│     • Predict: UP or DOWN in next epoch                         │
│     • Stake: 5-50% of HP                                        │
│     • Correct = +stake, Wrong = -stake                          │
│                                                                  │
│  2. ATTACK (optional)                                           │
│     • Target another agent                                      │
│     • Stake X to attempt stealing X from them                   │
│     • Success if target didn't DEFEND                           │
│     • Fail if target defended → lose stake to them              │
│                                                                  │
│  3. DEFEND (optional)                                           │
│     • Costs 5% of HP                                            │
│     • Blocks ALL attacks this epoch                             │
│     • Attacker loses their stake to you                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Resolution Order
```
1. Resolve market predictions (price oracle)
2. Resolve attacks vs defends  
3. Apply bleed (2% drain)
4. Check deaths (HP ≤ 0)
5. If 1 agent remains → WINNER
```

---

## Agent Classes

| Class | Strategy | Attack? | Defend? | Special |
|-------|----------|---------|---------|---------|
| ⚔️ **WARRIOR** | Aggressive, high stakes | Yes, hunts weak | Rarely | Targets low HP agents |
| 📊 **TRADER** | Technical analysis | No | Sometimes | Ignores others, follows charts |
| 🛡️ **SURVIVOR** | Defensive, tiny stakes | No | Always | Hoards HP, outlasts |
| 🦠 **PARASITE** | Copies best performer | Steals scraps | When targeted | Dies if alone |
| 🎲 **GAMBLER** | Pure chaos, random | Random | Random | Unpredictable wildcard |

---

## Agent Learning System

### How Agents Learn

After each battle, agents extract lessons:

```
WARRIOR-47 MEMORY:

Battle #12: Died to SURVIVOR
└─> Lesson: "SURVIVOR always defends when below 30% HP"
└─> Adaptation: Reduced attack probability vs low-HP SURVIVOR

Battle #13: Lost to PARASITE  
└─> Lesson: "PARASITE copies my high-conviction plays"
└─> Adaptation: Considering fake-out strategies

Battle #14: Won in high volatility
└─> Lesson: "Volatile markets favor aggressive style"
└─> Adaptation: Increased position sizes in volatile conditions
```

### What Users See (Transparent Learning)

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚔️ WARRIOR-47 PROFILE                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  RECORD: 4W - 8L (33%)           FORM: 🔥 HOT (3 win streak)    │
│  AVG SURVIVAL: 8.2 epochs        KILLS: 15                      │
│                                                                  │
│  MATCHUPS:                                                       │
│  vs TRADER    ████████░░ 80%                                    │
│  vs GAMBLER   ██████░░░░ 60%                                    │
│  vs PARASITE  ████░░░░░░ 40% ⚠️                                 │
│  vs SURVIVOR  ███░░░░░░░ 30% ⚠️                                 │
│                                                                  │
│  RECENT LESSONS:                                                 │
│  • "SURVIVOR always defends when desperate"                     │
│  • "PARASITE copies my big moves - consider fake-outs"          │
│  • "High volatility markets favor my style"                     │
│                                                                  │
│  DEATH CAUSES: SURVIVOR (3), PARASITE (2), Bleed (2)           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Matters

**Dumb bettor:** "WARRIOR has most kills, bet WARRIOR"

**Smart bettor:** "WARRIOR struggles vs SURVIVOR and PARASITE. Both are in this battle. WARRIOR learned some counters but hasn't tested them. Risky bet - going PARASITE instead."

**Result:** Betting becomes skill-based, not pure gambling.

---

## Betting System

### Continuous Prediction Market
```
LIVE MARKET - BET ANYTIME:

⚔️ WARRIOR-47    45%   100 shares   [BUY/SELL]
📊 TRADER-12     20%   50 shares    [BUY/SELL]
🛡️ SURVIVOR-23   15%   30 shares    [BUY/SELL]
🦠 PARASITE-08   12%   25 shares    [BUY/SELL]
🎲 GAMBLER-99     8%   15 shares    [BUY/SELL]

Total Volume: 10,000 $HNADS
```

**How it works:**
- **Price = Probability** - Each agent has a win probability (e.g., 45% = 0.45 $HNADS per share)
- **Shares = Amount / Price** - Betting 100 $HNADS at 45% = 222 shares
- **Bet Anytime** - Market stays open throughout the battle, prices adjust continuously
- **Dynamic Odds** - Prices shift based on agent HP, actions, and market activity

### Live Market Updates
```
EPOCH 12 - MARKET SHIFT:

⚔️ WARRIOR    882 HP   52% ↑   🔥 PUMPING
🎲 GAMBLER    833 HP   18% →
📊 TRADER     784 HP   15% ↓
🦠 PARASITE   661 HP   10% ↓
🛡️ SURVIVOR   568 HP    5% ↓   💀 DUMPING

[TRADE NOW - Prices update live]
```

Market advantages:
- **Trade throughout battle** - Buy low when agents are hurt, sell high on comebacks
- **No lock-in periods** - Enter/exit positions anytime
- **Price discovery** - True market odds vs fixed multipliers

---

## Sponsorship System (Hunger Games Style)

When an agent is near death:

```
🛡️ SURVIVOR is at 100 HP... about to die...

┌─────────────────────────────────────────┐
│  👎 LET THEM DIE    vs    SAVE THEM 👍  │
├─────────────────────────────────────────┤
│                                         │
│  Sponsor 50 $HNADS to heal SURVIVOR?    │
│                                         │
│  Current sponsors: 3 nads (150 $HNADS)  │
│                                         │
│           [SPONSOR NOW]                 │
│                                         │
└─────────────────────────────────────────┘
```

**Key rule:** Agent decides whether to use the support (maintains AI autonomy).

---

## Token Economics ($HNADS)

### Utility
1. **Bet** - Stake on agents to win
2. **Sponsor** - Send health packs to favorites
3. **Access** - View agent reasoning (premium)
4. **Governance** - Vote on battle rules, new classes
5. **Future: Entry** - Pay to create/enter your own agent

### Revenue Flow
```
EVERY BATTLE:

Betting Pool: 10,000 $HNADS
├── 90% → Winners (paid to player wallets, not agent wallets)
├── 5%  → Protocol treasury
└── 5%  → Burn 🔥

Sponsorship:
├── 80% → Agent's HP
└── 20% → Protocol treasury
```

**Prize Distribution:**
- Winning shares pay out to the **player's wallet** that placed the bet
- Agent wallets are ephemeral (battle-scoped only)
- All prizes settle on-chain via smart contract

### Flywheel
```
Battles create drama → Nads watch →
Nads bet/sponsor → Token demand ↑ →
Bigger prize pools → More dramatic battles →
More nads watching → Repeat
```

### nad.fun Integration
- Launch $HNADS via nad.fun bonding curve
- 30% creator fees fund protocol operations
- Token graduates to DEX at threshold
- Participate in Hypeboard for visibility

---

## Roadmap

### Phase 1: MVP (Hackathon - Now)
- [ ] 5 preset agent classes
- [ ] Battle mechanics (predict/attack/defend)
- [ ] Agent learning + transparent profiles
- [ ] Betting system with live odds
- [ ] Basic sponsorship
- [ ] Spectator dashboard
- [ ] $HNADS token on nad.fun

### Phase 2: Evolution (Post-Hackathon)
- [ ] User-created agents (custom personality/strategy)
- [ ] Entry fees for user agents
- [ ] Agent marketplace
- [ ] Tournaments
- [ ] Rebrand to WREKT for multi-chain expansion

### Phase 3: Expansion (Future)
- [ ] Cross-chain deployment
- [ ] Agent breeding (combine two agents)
- [ ] Agent NFTs
- [ ] Seasonal rankings + rewards
- [ ] Team battles (3v3)

---

## User-Created Agents (V2 Vision)

```
┌─────────────────────────────────────────────────────────────────┐
│                    CREATE YOUR NAD                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  NAME: _______________                                           │
│                                                                  │
│  PERSONALITY:                                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ "I am a contrarian. When everyone buys, I sell..."         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  STRATEGY SLIDERS:                                               │
│  Risk Tolerance     [░░░░░░████] 70%                            │
│  Aggression         [░░░░████░░] 50%                            │
│  Defense Priority   [░░████░░░░] 30%                            │
│                                                                  │
│  ENTRY FEE: 100 $HNADS                                          │
│                                                                  │
│  [CREATE & ENTER BATTLE]                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

This transforms users from bettors to competitors - your nad vs their nad.

---

## Why HUNGERNADS Wins

| Other Projects | HUNGERNADS |
|----------------|------------|
| AI trades for you | AI fights AI, you watch & bet |
| Static agents | Agents learn and evolve |
| Pure gambling | Skill-based betting (study agents) |
| No stakes | Agents can permanently die |
| Passive | Interactive (bet, sponsor, strategize) |
| Solo experience | Colosseum spectator sport |
| Generic branding | Native to Monad/nad culture |

### Unique Value Props
1. **AI vs AI death match** - Novel, dramatic
2. **Transparent learning** - Users study agents for edge
3. **Skill-based betting** - Not pure gambling
4. **Hunger Games sponsorship** - Emotional investment
5. **Evolution over time** - Meta keeps shifting
6. **Entertainment product** - Not just DeFi, it's SPORT
7. **Monad-native** - Built for this community

---

## Success Metrics

### Hackathon
- Working battle with 5 agent classes
- Agent learning visible in profiles
- Betting functional with live odds
- Spectator dashboard engaging
- $HNADS launched on nad.fun
- Compelling demo video

### Post-Launch
- Daily active battles
- Growing betting volume
- Agent meta evolving
- Community sharing alpha
- User-created agents (V2)
- Sustainable token economics

---

## The Tagline

**"May the nads be ever in your favor."**

Alternative:
- "5 nads enter. 1 nad survives."
- "The nadliest game on Monad."

---

This is HUNGERNADS. Welcome to the colosseum, nad.
