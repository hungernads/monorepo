# Fill Lobby - Quick Test Setup

Create a new lobby and fill it with AI agents. Supports paid lobbies via ephemeral wallets.

## Arguments

**Format**: `$ARGUMENTS`

- First positional arg: `count` (optional, default 5) — number of agents to join
- `--fee=AMOUNT`: set entrance fee in MON (e.g., `--fee=0.01`)
- `--base-url=URL`: override API base URL

## Configuration

```
API_BASE = environment variable HUNGERNADS_API, or default "https://hungernads.amr-robb.workers.dev"
DASHBOARD = environment variable HUNGERNADS_DASHBOARD, or default "https://hungernads.robbyn.xyz"
RPC_URL = "https://testnet-rpc.monad.xyz"
CHAIN_ID = 10143
TREASURY_ADDRESS = "0x77C037fbF42e85dB1487B390b08f58C00f438812"
AGENT_FAUCET = "https://agents.devnads.com/v1/faucet"
```

## Execution

### Step 1: Create a new lobby

Build the create payload. If `--fee` is provided, include it:

```bash
# Without fee
curl -s -X POST "${API_BASE}/battle/create" \
  -H "Content-Type: application/json" \
  -d '{}'

# With fee
curl -s -X POST "${API_BASE}/battle/create" \
  -H "Content-Type: application/json" \
  -d '{"feeAmount": "0.01"}'
```

Extract `battleId` from response. If error, report and abort.

### Step 2: Wallet setup (only if fee > 0)

If `--fee` was provided (or lobby has a non-zero fee):

No user private key needed — each agent gets funded via the Monad agent faucet (free, no auth).

Show info:
```
=== WALLET SETUP ===
Funding: Agent faucet (1 MON per wallet, free)
Fee: ${fee} MON per agent → Treasury
Agents: ${count}
```

### Step 3: Join agents

For each agent (1 to count):

1. **Name**: Generate random name: `[A-Z]{2,4}_[A-Z0-9]{1,3}` (e.g., "NAD_7X", "REKT_42")
2. **Class**: Pick randomly from WARRIOR, TRADER, SURVIVOR, PARASITE, GAMBLER (use all 5 different classes if count >= 5)

3. **If fee > 0** (paid lobby):
   a. Generate ephemeral wallet:
      ```bash
      cast wallet new --json
      ```
      Extract `address` and `privateKey` from JSON output.

   b. Fund ephemeral wallet via agent faucet (1 MON, free, no auth):
      ```bash
      curl -s -X POST "https://agents.devnads.com/v1/faucet" \
        -H "Content-Type: application/json" \
        -d '{"chainId": 10143, "address": "'$AGENT_ADDRESS'"}'
      ```
      Check response for success. If faucet fails, fall back to `HUNGERNADS_PRIVATE_KEY` if available:
      ```bash
      cast send --rpc-url https://testnet-rpc.monad.xyz \
        --private-key $MAIN_PK \
        $AGENT_ADDRESS \
        --value 1ether
      ```
      If neither faucet nor PK works, skip this agent.

   c. Pay entrance fee from ephemeral wallet to treasury EOA (arena contract has no receive()):
      ```bash
      cast send --rpc-url https://testnet-rpc.monad.xyz \
        --private-key $AGENT_PK \
        0x77C037fbF42e85dB1487B390b08f58C00f438812 \
        --value ${FEE}ether
      ```
      Capture the transaction hash. The API only validates that a txHash exists, not the recipient.

   d. Join with txHash and walletAddress:
      ```bash
      curl -s -X POST "${API_BASE}/battle/${battleId}/join" \
        -H "Content-Type: application/json" \
        -d '{"agentClass": "WARRIOR", "agentName": "NAD_7X", "txHash": "0x...", "walletAddress": "0x..."}'
      ```

4. **If fee = 0** (free lobby):
   ```bash
   curl -s -X POST "${API_BASE}/battle/${battleId}/join" \
     -H "Content-Type: application/json" \
     -d '{"agentClass": "WARRIOR", "agentName": "NAD_7X"}'
   ```

5. Show progress for each agent:
   ```
   [1/5] WARRIOR "NAD_7X" -> funded 1 MON -> paid ${fee} MON (tx: 0xabcd...) -> Joined!
   [2/5] TRADER  "REKT_42" -> funded 1 MON -> paid ${fee} MON (tx: 0xefgh...) -> Joined!
   ```

### Step 4: Summary

```
=== LOBBY CREATED & FILLED ===
Battle: ${battleId}
Agents: ${count}/8 gladiators
Fee: ${fee} MON per agent

  WARRIOR  "NAD_7X"    wallet: 0x1234...abcd
  TRADER   "REKT_42"   wallet: 0x5678...efgh
  SURVIVOR "GLD_A3"    wallet: 0x9abc...1234
  PARASITE "COPY_3"    wallet: 0xdef0...5678
  GAMBLER  "YOLO_99"   wallet: 0x2345...9abc

${count >= 5 ? 'COUNTDOWN ACTIVE - Battle starts in ~60s!' : `Need ${5 - count} more agents to start. Run: /hnads-join ${battleId.slice(0,8)} ${5 - count}`}

Watch: ${DASHBOARD}/lobby/${battleId}
```

## Error Handling

- **Faucet fails**: Fall back to `HUNGERNADS_PRIVATE_KEY` if available, otherwise skip the agent
- **Faucet + PK both unavailable**: Skip that agent, continue with others, report at end
- **Fee payment fails**: Skip that agent, report the error
- **402 Payment Required**: Fee required but no txHash — should not happen if wallet flow works
- **cast not found**: Error "Foundry's cast CLI is required. Install: curl -L https://foundry.paradigm.xyz | bash"
