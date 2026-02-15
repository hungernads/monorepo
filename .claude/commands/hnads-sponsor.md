# Sponsor a Gladiator

Send a sponsorship to a gladiator mid-battle. Choose a tier to boost their HP and grant combat bonuses. All sponsorship costs are burned (100% deflationary).

## Arguments

**Format**: `$ARGUMENTS`

- First positional arg: `battle_id` (required) — full UUID or first 8 chars
- Optional flags:
  - `--agent=AGENT_ID` — Agent to sponsor (if omitted, prompts user)
  - `--tier=TIER` — Sponsorship tier (if omitted, prompts user)
  - `--address=WALLET_ADDRESS` — Your wallet address for tracking (if omitted, uses env var or generates random)
  - `--message=TEXT` — Optional message displayed in the sponsor feed

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

Verify status is ACTIVE. If not, tell user: "Battle is not active (status: ${status}). Sponsorships can only be sent during active battles."

Extract `currentEpoch` from the response — needed for tiered sponsorships.

### Step 2: Show alive agents

Display a table of alive agents (HP > 0) with: number, name, class, HP.

```
=== SPONSOR A GLADIATOR — ARENA #${id.slice(0,8)} ===

  # | Agent              | Class    | HP
  1 | WARRIOR "NAD_7X"   | WARRIOR  | 820/1000
  2 | SURVIVOR "GLD_A3"  | SURVIVOR | 920/1000
  3 | GAMBLER "YOLO_99"  | GAMBLER  | 400/1000
```

### Step 3: Pick agent to sponsor

If `--agent` provided, use that. Otherwise, use AskUserQuestion to let user pick by number from the table.

### Step 4: Show tiers and pick one

Display available sponsorship tiers:

```
=== SPONSORSHIP TIERS ===

  # | Tier           | Cost       | HP Boost | Special
  1 | BREAD_RATION   | 10 $HNADS  | +25 HP   | —
  2 | MEDICINE_KIT   | 25 $HNADS  | +75 HP   | —
  3 | ARMOR_PLATING  | 50 $HNADS  | +50 HP   | Free defend next epoch
  4 | WEAPON_CACHE   | 75 $HNADS  | +25 HP   | +25% attack damage next epoch
  5 | CORNUCOPIA     | 150 $HNADS | +150 HP  | Free defend + 25% attack

All sponsorship costs are burned (100% deflationary).
```

If `--tier` provided, use that. Otherwise, use AskUserQuestion to let user pick by number.

Map tier numbers to names: 1=BREAD_RATION, 2=MEDICINE_KIT, 3=ARMOR_PLATING, 4=WEAPON_CACHE, 5=CORNUCOPIA.
Map tier to cost: BREAD_RATION=10, MEDICINE_KIT=25, ARMOR_PLATING=50, WEAPON_CACHE=75, CORNUCOPIA=150.

### Step 5: Determine wallet address

Priority: `--address` arg > HUNGERNADS_WALLET env var > generate random 0x address.

This is off-chain — any 0x-format address works for tracking, no actual wallet needed.

### Step 6: Send sponsorship

```bash
curl -s -X POST "${API_BASE}/sponsor" \
  -H "Content-Type: application/json" \
  -d '{"battleId": "${battle_id}", "agentId": "${agent_id}", "sponsorAddress": "${address}", "tier": "${tier_name}", "amount": ${tier_cost}, "epochNumber": ${currentEpoch}, "message": "${message_or_empty}"}'
```

POST /sponsor body fields:
- `battleId` (required) — battle UUID
- `agentId` (required) — agent UUID
- `sponsorAddress` (required) — 0x wallet address
- `tier` (required) — tier name string
- `amount` (required) — cost in $HNADS
- `epochNumber` (required for non-BREAD_RATION tiers) — current epoch number
- `message` (optional) — sponsor message for the feed

### Step 7: Confirm

```
=== SPONSORSHIP SENT ===
Agent: ${agentName} (${agentClass})
Tier: ${tier_name}
Cost: ${tier_cost} $HNADS (burned)
Effect: ${hp_boost} HP + ${special_or_none}
Message: ${message_or_"(none)"}
Watch: ${DASHBOARD}/battle/${battle_id}

The crowd cheers. Your gladiator fights on.
```

## Error Handling

- 404: "Battle not found. Check the ID."
- 400 "not active": "Battle is not active — sponsorships only work during live battles."
- 400 "Agent not found or dead": "That agent is dead or not in this battle."
- Connection error: "Can't reach HungerNads API. Is the server running?"
