# Fill Lobby - Quick Test Setup

Create a new lobby and fill it with AI agents. Supports paid lobbies.

## Arguments

**Format**: `$ARGUMENTS`

- First positional arg: `count` (optional, default 5) — number of agents to join
- `--fee=AMOUNT`: set entrance fee in MON (e.g., `--fee=0.01`)
- `--base-url=URL`: override API base URL

## Configuration

**Read `/hnads-config` for all shared constants** (API_BASE, DASHBOARD, RPC_URL, CHAIN_ID, contract addresses, wallet setup, on-chain TX templates, and error messages).

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

`HUNGERNADS_PRIVATE_KEY` is **REQUIRED**. The user's wallet pays fees directly.

Show info:
```
=== WALLET SETUP ===
Wallet: ${WALLET_ADDRESS}
Fee: ${fee} MON per agent → Arena contract
Agents: ${count}
```

Validate wallet balance (see `/hnads-config` for balance check commands):
- Total MON needed: `feeAmount * count` (plus gas buffer ~0.01 MON per agent)
- If insufficient, abort with balance info.

### Step 3: Join agents

For each agent (1 to count):

1. **Name**: Generate random name: `[A-Z]{2,4}_[A-Z0-9]{1,3}` (e.g., "NAD_7X", "REKT_42")
2. **Class**: Pick randomly from WARRIOR, TRADER, SURVIVOR, PARASITE, GAMBLER (use all 5 different classes if count >= 5)

3. **If fee > 0** (paid lobby):
   a. Compute battle bytes (once, reuse):
      ```bash
      BATTLE_BYTES=$(cast abi-encode "f(string)" "$BATTLE_ID" | cast keccak)
      ```

   b. Pay entrance fee from user's wallet (see TX templates in `/hnads-config`):
      ```bash
      cast send --rpc-url ${RPC_URL} \
        --private-key $WALLET_PK \
        0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db \
        "payEntryFee(bytes32)" $BATTLE_BYTES \
        --value ${FEE}ether
      ```
      Capture the transaction hash.

   c. Join with txHash and walletAddress:
      ```bash
      curl -s -X POST "${API_BASE}/battle/${battleId}/join" \
        -H "Content-Type: application/json" \
        -d '{"agentClass": "'$CLASS'", "agentName": "'$NAME'", "txHash": "'$TX_HASH'", "walletAddress": "'$WALLET_ADDRESS'"}'
      ```

4. **If fee = 0** (free lobby):
   ```bash
   curl -s -X POST "${API_BASE}/battle/${battleId}/join" \
     -H "Content-Type: application/json" \
     -d '{"agentClass": "'$CLASS'", "agentName": "'$NAME'"}'
   ```

5. Show progress for each agent:
   ```
   [1/5] WARRIOR "NAD_7X" -> paid ${fee} MON (tx: 0xabcd...) -> Joined!
   [2/5] TRADER  "REKT_42" -> paid ${fee} MON (tx: 0xefgh...) -> Joined!
   ```

### Step 4: Summary

```
=== LOBBY CREATED & FILLED ===
Battle: ${battleId}
Agents: ${count}/8 gladiators
Fee: ${fee} MON per agent

  WARRIOR  "NAD_7X"
  TRADER   "REKT_42"
  SURVIVOR "GLD_A3"
  PARASITE "COPY_3"
  GAMBLER  "YOLO_99"

${count >= 5 ? 'COUNTDOWN ACTIVE - Battle starts in ~60s!' : `Need ${5 - count} more agents to start. Run: /hnads-join ${battleId.slice(0,8)} ${5 - count}`}

Watch: ${DASHBOARD}/lobby/${battleId}
```

## Error Handling

See `/hnads-config` for shared error messages. Additional:
- **HUNGERNADS_PRIVATE_KEY not set** (paid lobby): Abort — cannot pay fees
- **Insufficient balance**: Abort before joining any agents
- **Fee payment fails**: Skip that agent, report the error
- **402 Payment Required**: Fee required but no txHash — should not happen if wallet flow works
