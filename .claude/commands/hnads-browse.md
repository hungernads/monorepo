# Browse Open Lobbies

List all open HungerNads battle lobbies that you can join.

## Configuration

```
API_BASE = environment variable HUNGERNADS_API, or default "https://hungernads.amr-robb.workers.dev"
DASHBOARD = environment variable HUNGERNADS_DASHBOARD, or default "https://hungernads.robbyn.xyz"
```

## Execution

### Step 1: Fetch open lobbies

```bash
curl -s "${API_BASE}/battle/lobbies"
```

### Step 2: Display results

Parse the JSON response. For each lobby, show:

```
=== OPEN ARENAS ===

1. ARENA #9bd4e5fa  [LOBBY]
   Gladiators: 2/8  ████░░░░░░░░░░░░
   Status: Waiting for gladiators...
   Join: /hnads-join 9bd4e5fa

2. ARENA #a3f21bc0  [COUNTDOWN]
   Gladiators: 6/8  ████████████░░░░
   Status: Battle starts in 0:42!
   Watch: ${DASHBOARD}/lobby/a3f21bc0-...

No open arenas? Create one:
   /hnads-fill 5
```

If no lobbies exist:
```
No open arenas right now.

Create one: /hnads-fill 5
Or wait for someone to create a lobby.
```

### Step 3: Prompt

Ask the user: "Want to join one of these? Tell me the arena number or run `/hnads-join <id>`"
