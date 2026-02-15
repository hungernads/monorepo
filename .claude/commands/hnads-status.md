# Check Battle Status

View the current state of a HungerNads battle — lobby, active, or completed.

## Arguments

**Format**: `$ARGUMENTS`

- First positional arg: `battle_id` (required) — full UUID or first 8 chars

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

### Step 2: Display based on status

**LOBBY / COUNTDOWN:**
```
=== ARENA #${id.slice(0,8)} ===
Status: ${status}
Gladiators: ${playerCount}/${maxPlayers}

Agents:
  1. WARRIOR "NAD_7X"     - Ready
  2. TRADER  "REKT_42"    - Ready
  3. SURVIVOR "GLD_A3"    - Ready

${countdown ? `Countdown: Battle starts in ${countdown}!` : `Waiting for ${5 - playerCount} more...`}

Join: /hnads-join ${id.slice(0,8)}
Watch: ${DASHBOARD}/lobby/${id}
```

**ACTIVE:**
```
=== ARENA #${id.slice(0,8)} ===
Status: ACTIVE (Epoch ${epoch}/${maxEpochs})

Agents:
  1. WARRIOR "NAD_7X"     HP: 820/1000  Kills: 1
  2. TRADER  "REKT_42"    HP: 650/1000  Kills: 0
  3. SURVIVOR "GLD_A3"    HP: 920/1000  Kills: 0
  4. PARASITE "COPY_3"    ** REKT ** (killed by WARRIOR)
  5. GAMBLER "YOLO_99"    HP: 400/1000  Kills: 1

Watch: ${DASHBOARD}/battle/${id}
```

**COMPLETED:**
```
=== ARENA #${id.slice(0,8)} ===
Status: COMPLETED

WINNER: SURVIVOR "GLD_A3" - Survived ${epochs} epochs!

Final Standings:
  1. SURVIVOR "GLD_A3"     HP: 120  Kills: 0  Survived: 10 epochs
  2. WARRIOR "NAD_7X"      HP: 0    Kills: 2  Survived: 8 epochs
  3. GAMBLER "YOLO_99"     HP: 0    Kills: 1  Survived: 6 epochs
  4. TRADER "REKT_42"      HP: 0    Kills: 0  Survived: 4 epochs
  5. PARASITE "COPY_3"     HP: 0    Kills: 0  Survived: 3 epochs
```

### Error Handling

- 404: "Battle not found. Check the ID and try again."
- Connection error: "Can't reach HungerNads API. Is the server running?"
