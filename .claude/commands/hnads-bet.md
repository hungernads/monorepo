# Place Bet on Battle

View odds and place a bet on a HungerNads battle via CLI.

## Arguments

**Format**: `$ARGUMENTS`

- First positional arg: `battle_id` (required) — full UUID or first 8 chars
- Optional flags:
  - `--agent=AGENT_ID` — Agent to bet on (if omitted, prompts user)
  - `--amount=NUMBER` — Bet amount in $HNADS (if omitted, prompts user)
  - `--address=WALLET_ADDRESS` — Wallet address for tracking (if omitted, uses env var or generates random)

## Configuration

```
API_BASE = environment variable HUNGERNADS_API, or default "https://hungernads.amr-robb.workers.dev"
DASHBOARD = environment variable HUNGERNADS_DASHBOARD, or default "https://hungernads.robbyn.xyz"
```

## Execution

### Step 1: Fetch battle state

```bash
curl -s "${API_BASE}/battle/${battle_id}"
```

Verify status is ACTIVE or BETTING_OPEN. If not, tell user: "Battle is not active (status: ${status}). Bets can only be placed on active battles."

### Step 2: Fetch and display odds

```bash
curl -s "${API_BASE}/battle/${battle_id}/odds"
```

Display a table of alive agents with: name, class, HP, probability %, decimal odds.

Example display:
```
=== ODDS — ARENA #${id.slice(0,8)} ===

  # | Agent              | Class    | HP       | Prob  | Odds
  1 | WARRIOR "NAD_7X"   | WARRIOR  | 820/1000 | 35%   | 2.9x
  2 | SURVIVOR "GLD_A3"  | SURVIVOR | 920/1000 | 40%   | 2.5x
  3 | GAMBLER "YOLO_99"  | GAMBLER  | 400/1000 | 25%   | 4.0x

Pool: ${totalPool} $HNADS
```

### Step 3: Pick agent to bet on

If `--agent` provided, use that. Otherwise, use AskUserQuestion to let user pick by number from the odds table.

### Step 4: Set bet amount

If `--amount` provided, use that. Otherwise, ask user for amount (default suggestion: 10 $HNADS).

### Step 5: Determine wallet address

Priority: `--address` arg > HUNGERNADS_WALLET env var > generate random 0x address.

This is off-chain — any 0x-format address works for tracking, no actual wallet needed.

### Step 6: Place bet

```bash
curl -s -X POST "${API_BASE}/bet" \
  -H "Content-Type: application/json" \
  -d '{"battleId": "${battle_id}", "userAddress": "${address}", "agentId": "${agent_id}", "amount": ${amount}}'
```

POST /bet body: `{battleId, userAddress, agentId, amount}` — battle must be ACTIVE or BETTING_OPEN status, AND bettingPhase=OPEN.

### Step 7: Confirm

```
=== BET PLACED ===
Agent: ${agentName} (${agentClass})
Amount: ${amount} $HNADS
Odds: ${odds}x
Potential payout: ${amount * odds} $HNADS
Watch: ${DASHBOARD}/battle/${battle_id}
```

## Error Handling

- 404: "Battle not found. Check the ID."
- 400 "Cannot bet on battle with status '...'": "Battle is not accepting bets (status: ${status})"
- 400 "Betting is closed/locked": "Betting phase is closed for this battle."
- Connection error: "Can't reach HungerNads API. Is the server running?"
