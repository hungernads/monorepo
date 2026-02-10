# Join a HungerNads Lobby

Add one or more AI agents to an open battle lobby.

## Arguments

**Format**: `$ARGUMENTS`

Parse arguments:
- First positional arg: `battle_id` (required) — full UUID or first 8 chars
- Second positional arg: `count` (optional, default 1) — number of agents to join
- `--class=CLASS`: force a specific class (WARRIOR, TRADER, SURVIVOR, PARASITE, GAMBLER)
- `--name=NAME`: set a specific agent name (only works with count=1)

## Configuration

```
API_BASE = environment variable HUNGERNADS_API, or default "http://localhost:8787"
DASHBOARD = environment variable HUNGERNADS_DASHBOARD, or default "http://localhost:3000"
```

## Execution

### Step 1: Resolve battle ID

If battle_id is < 36 chars (partial), fetch lobbies to find the full UUID:
```bash
curl -s "${API_BASE}/battle/lobbies"
```
Match the partial ID against `battleId` in results. If no match, try using it as-is.

### Step 2: Check lobby status

Show current lobby status before joining.

### Step 3: Join agents

For each agent (1 to count):

1. **Name**: If --name provided and count=1, use it. Otherwise generate a random name:
   - Pattern: `[A-Z]{2,4}_[A-Z0-9]{1,3}` (e.g., "NAD_7X", "REKT_42", "GLD_A3", "MON_99")
   - Max 12 chars, alphanumeric + underscore only

2. **Class**: If --class provided, use it. Otherwise pick randomly from:
   WARRIOR, TRADER, SURVIVOR, PARASITE, GAMBLER

3. **API call**:
```bash
curl -s -X POST "${API_BASE}/battle/${battle_id}/join" \
  -H "Content-Type: application/json" \
  -d '{"agentClass": "WARRIOR", "agentName": "NAD_7X"}'
```

4. **Report each join**:
```
  [1/5] WARRIOR "NAD_7X"   -> Slot 3  (3/8)
  [2/5] GAMBLER "REKT_42"  -> Slot 4  (4/8)
  [3/5] SURVIVOR "GLD_A3"  -> Slot 5  (5/8)  ** COUNTDOWN TRIGGERED! **
```

### Step 4: Summary

```
=== JOINED ===
5/5 agents joined successfully
Lobby: 7/8 gladiators
Countdown: ACTIVE - battle starts in ~60s!

Watch live: ${DASHBOARD}/lobby/${battle_id}
```

## Error Handling

- 409 (lobby full): Stop joining, report how many succeeded
- 409 (duplicate name): Retry with a different generated name (up to 3 retries)
- 409 (wrong status): Battle already started or cancelled
- 404: Battle not found
- Connection error: API unreachable, check HUNGERNADS_API setting
