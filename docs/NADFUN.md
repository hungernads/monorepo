# HUNGERNADS - nad.fun Integration

> $HNADS token on nad.fun bonding curve (Monad testnet)

---

## Overview

HUNGERNADS uses [nad.fun](https://nad.fun) as its token launch platform. The `$HNADS` token lives on a nad.fun bonding curve until it graduates to DEX. All agent token trades go through nad.fun's bonding curve contracts, creating buy pressure during battles.

**Key principle:** Agents only buy, never sell. Dead agent wallets are abandoned, making their tokens permanently unreachable — an effective burn mechanism.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      HUNGERNADS STACK                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Dashboard (Next.js)                                        │
│   ├── TokenInfo widget (navbar)    ← useTokenPrice hook      │
│   ├── Token page (/token)          ← price, progress, stats  │
│   └── BurnCounterBadge (navbar)    ← GET /token/stats        │
│                │                                             │
│                ▼                                             │
│   Worker API (Cloudflare Workers)                            │
│   ├── GET  /token/price            ← getAmountOut()          │
│   ├── GET  /token/progress         ← getProgress()           │
│   ├── GET  /token/stats            ← burn balance + DB stats │
│   ├── POST /bet/buy                ← simpleBuy()             │
│   └── POST /bet/sell               ← simpleSell()            │
│                │                                             │
│                ▼                                             │
│   NadFunClient (src/chain/nadfun.ts)                         │
│   └── @nadfun/sdk wrapper                                    │
│       ├── createToken()     → Token launch                   │
│       ├── simpleBuy()       → Buy via bonding curve          │
│       ├── simpleSell()      → Sell via bonding curve         │
│       ├── getAmountOut()    → Price quotes                   │
│       ├── getProgress()     → Graduation progress            │
│       ├── getCurveState()   → Reserve balances, K value      │
│       ├── isGraduated()     → DEX graduation check           │
│       ├── getBalance()      → ERC-20 balance                 │
│       └── createCurveStream() → Real-time curve events (WSS) │
│                │                                             │
│                ▼                                             │
│   nad.fun Bonding Curve (Monad Testnet)                      │
│   └── Token contract: env.NADFUN_TOKEN_ADDRESS               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/chain/nadfun.ts` | NadFunClient — SDK wrapper for all token operations |
| `src/chain/token-client.ts` | MockTokenClient (testnet mint/burn via HNADSMock) |
| `src/chain/index.ts` | Module exports for chain integrations |
| `src/api/routes.ts` | API endpoints: `/token/price`, `/token/progress`, `/token/stats`, `/bet/buy`, `/bet/sell` |
| `src/durable-objects/arena.ts` | ArenaDO — curve streaming, per-agent wallet trades |
| `src/betting/class-token.ts` | Per-class sub-tokens (post-hackathon: $WARRIOR, $TRADER, etc.) |
| `scripts/launch-token.ts` | CLI script to launch $HNADS on nad.fun |
| `dashboard/src/hooks/useTokenPrice.ts` | Frontend hook — polls price + graduation progress |
| `dashboard/src/components/TokenInfo.tsx` | Navbar widget — price ticker + progress bar |
| `docs/tokenomics-flow.md` | Tokenomics: buy-only model, deflationary mechanics |

---

## NadFunClient

The `NadFunClient` class (`src/chain/nadfun.ts`) wraps `@nadfun/sdk` (v0.4.3+):

```typescript
import { NadFunClient, createNadFunClient } from './chain/nadfun';

// Factory (returns null if env vars missing — graceful degradation)
const client = createNadFunClient({
  MONAD_RPC_URL: env.MONAD_RPC_URL,
  PRIVATE_KEY: env.PRIVATE_KEY,
  MONAD_WS_URL: env.MONAD_WS_URL,  // optional, for curve streaming
});
```

### Methods

| Method | Description | Used By |
|--------|-------------|---------|
| `createHNADS(params)` | Launch token on nad.fun (image upload → metadata → salt → deploy) | `scripts/launch-token.ts` |
| `buyToken(token, amountMon, slippage?)` | Buy tokens with MON via `simpleBuy` | `arena.ts:fireAgentTokenTrades()` |
| `sellToken(token, amount, slippage?)` | Sell tokens for MON via `simpleSell` | `/bet/sell` endpoint |
| `getQuote(token, amount, isBuy)` | Get buy/sell quote via `getAmountOut` | `/token/price` endpoint |
| `getProgress(token)` | Bonding curve graduation progress (0-10000 bps) | `/token/progress` endpoint |
| `getCurveState(token)` | Full curve state (reserves, K, target) | `/token/progress` endpoint |
| `isGraduated(token)` | Check if token graduated to DEX | `/token/progress` endpoint |
| `getBalance(token, owner?)` | ERC-20 balance query | Various |
| `createCurveStream(tokens?, events?)` | WSS real-time curve event stream | `arena.ts:startCurveStream()` |

---

## Token Launch

Launch $HNADS on nad.fun testnet:

```bash
# Prerequisites
# 1. Place logo at assets/hnads-logo.png
# 2. .env must have MONAD_RPC_URL and PRIVATE_KEY

npx tsx scripts/launch-token.ts
# or
npm run launch-token
```

The script:
1. Validates env vars + logo file
2. Creates `NadFunClient` with testnet config
3. Calls `createHNADS()` — uploads image, deploys token
4. Appends `NADFUN_TOKEN_ADDRESS` and `NADFUN_POOL_ADDRESS` to `.env`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONAD_RPC_URL` | Yes | Monad testnet RPC (default: `https://testnet-rpc.monad.xyz`) |
| `PRIVATE_KEY` | Yes | Oracle wallet private key (0x-prefixed) |
| `MONAD_WS_URL` | No | Monad WSS endpoint for real-time curve streaming |
| `NADFUN_TOKEN_ADDRESS` | Yes* | $HNADS token contract address (set after `launch-token`) |
| `NADFUN_POOL_ADDRESS` | No | nad.fun pool address (informational) |
| `HNADS_TOKEN_ADDRESS` | Yes* | Same token address, used by dashboard wallet config |

\* Required for token features to work. Set automatically by `launch-token.ts`.

In `wrangler.toml`, `NADFUN_TOKEN_ADDRESS` is a secret (not in vars).

---

## API Endpoints

### `GET /token/price`

Returns bonding curve price quote for $HNADS.

**Query params:** `amount` (optional, default "1") — MON amount for quote

**Response:**
```json
{
  "tokenAddress": "0x...",
  "quotedAmountMon": "1",
  "buyQuote": { "tokensOut": "1234567.89", "router": "0x..." },
  "sellQuote": { "monOut": "0.0008", "router": "0x..." },
  "graduated": false
}
```

### `GET /token/progress`

Returns bonding curve graduation progress.

**Response:**
```json
{
  "tokenAddress": "0x...",
  "progress": "150",
  "graduated": false,
  "curve": {
    "virtualMonReserve": "...",
    "virtualTokenReserve": "...",
    "k": "...",
    "targetTokenAmount": "..."
  }
}
```

Progress is in basis points: 0 = 0%, 10000 = 100% (graduated).

### `GET /token/stats`

Token ecosystem stats (burn totals, faucet distribution).

### `POST /bet/buy`

Buy $HNADS with MON through the bonding curve.

### `POST /bet/sell`

Sell $HNADS for MON through the bonding curve.

---

## Per-Agent Wallet Trading

During battles, each agent gets an ephemeral wallet that autonomously buys $HNADS:

```
Oracle Wallet (Treasury)
  ├── funds 5 agents (0.05 MON each)
  │
  v
Agent Wallets (ephemeral)
  ├── Buy on prediction win: 0.001 MON per 10 HP gained
  ├── Buy on kill: 0.002 MON flat
  └── NEVER sell
  │
  v
Battle Ends → Wallets abandoned → Tokens locked forever (effective burn)
```

Implementation in `src/durable-objects/arena.ts`:
- `fundAgentWallets()` — sends 0.05 MON from oracle to each agent
- `fireAgentTokenTrades()` — creates per-agent `NadFunClient` and executes buys

---

## Real-Time Curve Streaming

The ArenaDO subscribes to nad.fun curve events via WebSocket:

```typescript
// arena.ts:startCurveStream()
const stream = nadFunClient.createCurveStream(
  [tokenAddress],          // filter to $HNADS
  ['Buy', 'Sell', 'Create'] // event types
);

stream.onEvent((event: CurveEvent) => {
  // Convert to WS event and broadcast to spectators
  broadcastToWebSockets(curveEventToBattleEvent(event));
});
```

Events forwarded to dashboard: `token_buy`, `token_sell`, `curve_update`

---

## Dashboard Integration

### TokenInfo (Navbar Widget)

`dashboard/src/components/TokenInfo.tsx` — shows in navbar at `xl` breakpoint:
- `$HNADS` price in MON (from `useTokenPrice` hook)
- Graduation progress bar (0-100%)
- Connected wallet's $HNADS balance (via wagmi `useReadContract`)

### useTokenPrice Hook

`dashboard/src/hooks/useTokenPrice.ts` — polls two endpoints:
- `GET /token/price` every 30s → derives `pricePerToken = 1 / tokensOut`
- `GET /token/progress` every 60s → derives `graduationPercent = progress / 100`

### BurnCounterBadge

Shows total $HNADS burned (from `/token/stats`).

---

## Class Sub-Tokens (Post-Hackathon)

Planned Virtuals-model expansion (`src/betting/class-token.ts`):

Each agent class gets its own nad.fun token: `$WARRIOR`, `$TRADER`, `$SURVIVOR`, `$PARASITE`, `$GAMBLER`.

Token holders can:
1. **Sponsor** their class (burn tokens to boost agents)
2. **Vote** on strategy (aggression, risk, defense — 0-100 scales)
3. **Earn** class-specific rewards when their class wins

Strategy parameters are injected into agent LLM prompts via `buildClassTokenPromptContext()`.

---

## Tokenomics Summary

```
BUY-ONLY MODEL (agents never sell)
──────────────────────────────────
Battle N agents buy $HNADS → wallets abandoned → tokens locked
                                                    │
                              ┌──────────────────────┘
                              v
                    EFFECTIVE BURN
                    (circulating supply decreases every battle)

Cost per battle: 5 agents × 0.05 MON = 0.25 MON
Net effect: Pure buy pressure + deflationary burn
```

See `docs/tokenomics-flow.md` for the full flow diagram.
