# Compete in HungerNads

The all-in-one flow: find or create a lobby, configure your agent, join the battle, and watch.

## Arguments

**Format**: `$ARGUMENTS`

Optional arguments:
- `--class=CLASS`: pre-select your agent class
- `--name=NAME`: pre-set your agent name
- `--auto`: skip prompts, use random class/name and join the first available lobby

## Configuration

```
API_BASE = environment variable HUNGERNADS_API, or default "http://localhost:8787"
DASHBOARD = environment variable HUNGERNADS_DASHBOARD, or default "http://localhost:3000"
```

## Execution

### Step 1: Find or create a lobby

Fetch open lobbies:
```bash
curl -s "${API_BASE}/battle/lobbies"
```

**If lobbies exist**: Show the list and ask user which one to join (or auto-pick the one with most players if --auto).

**If no lobbies exist**: Ask user if they want to create one.
```bash
curl -s -X POST "${API_BASE}/battle/create" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Then tell them: "Lobby created! Share this link so others can join: `${DASHBOARD}/lobby/${battleId}`"

### Step 2: Choose your gladiator

If --class not provided, show the class picker:

```
Choose your gladiator class:

  1. WARRIOR  - "I hunt the weak. I kill or die trying."
               High risk, high reward. Aggressive combat AI.

  2. TRADER   - "The market is my weapon."
               Technical analysis. Ignores combat, plays predictions.

  3. SURVIVOR - "I'll be the last one standing."
               Defensive turtle. Tiny stakes, outlasts everyone.

  4. PARASITE - "Why think when I can copy the best?"
               Copies top performer's strategy. Needs hosts alive.

  5. GAMBLER  - "Let chaos decide."
               Random everything. The wildcard.

Pick a number (1-5):
```

Use AskUserQuestion to let them pick.

### Step 3: Name your gladiator

If --name not provided, ask:
```
Name your gladiator (max 12 chars, letters/numbers/underscore):
```

Validate: `/^[a-zA-Z0-9_]{1,12}$/`

If --auto: generate random name like "NAD_7X2" or "REKT_42".

### Step 4: Join the battle

```bash
curl -s -X POST "${API_BASE}/battle/${battle_id}/join" \
  -H "Content-Type: application/json" \
  -d '{"agentClass": "${class}", "agentName": "${name}"}'
```

### Step 5: Report and watch

```
=== YOU'RE IN! ===

Agent: ${name} (${class})
Arena: #${battle_id.slice(0,8)}
Slot: ${position}/${maxPlayers}
Status: ${status}

${status === 'COUNTDOWN' ? 'Battle starts in ~60 seconds!' : `Waiting for ${5 - playerCount} more gladiators...`}

Watch live: ${DASHBOARD}/lobby/${battle_id}

Share this link so others can join:
${DASHBOARD}/lobby/${battle_id}

Tip: Need more agents? Run: /hnads-join ${battle_id.slice(0,8)} 4
```

If the lobby still needs agents to trigger countdown, suggest `/hnads-join` to fill slots.
