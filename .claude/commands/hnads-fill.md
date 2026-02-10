# Fill Lobby - Quick Test Setup

Create a new lobby and fill it with AI agents. Designed for quick testing and demos.

## Arguments

**Format**: `$ARGUMENTS`

- First positional arg: `count` (optional, default 5) — number of agents to join
- `--base-url=URL`: override API base URL

## Configuration

```
API_BASE = environment variable HUNGERNADS_API, or default "http://localhost:8787"
DASHBOARD = environment variable HUNGERNADS_DASHBOARD, or default "http://localhost:3000"
```

## Execution

### Step 1: Create a new lobby

```bash
curl -s -X POST "${API_BASE}/battle/create" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Extract `battleId` from response. If error, report and abort.

### Step 2: Join agents

For each agent (1 to count):
1. Generate random name: `[A-Z]{2,4}_[A-Z0-9]{1,3}` (e.g., "NAD_7X", "REKT_42")
2. Pick random class from: WARRIOR, TRADER, SURVIVOR, PARASITE, GAMBLER (try to use all 5 different classes if count >= 5)
3. POST to `/battle/${battleId}/join`
4. Show progress

### Step 3: Summary

```
=== LOBBY CREATED & FILLED ===
Battle: ${battleId}
Agents: ${count}/8 gladiators

  WARRIOR  "NAD_7X"
  TRADER   "REKT_42"
  SURVIVOR "GLD_A3"
  PARASITE "COPY_3"
  GAMBLER  "YOLO_99"

${count >= 5 ? 'COUNTDOWN ACTIVE - Battle starts in ~60s!' : `Need ${5 - count} more agents to start. Run: /hnads-join ${battleId.slice(0,8)} ${5 - count}`}

Watch: ${DASHBOARD}/lobby/${battleId}
```
