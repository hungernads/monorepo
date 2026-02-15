# Join a HungerNads Lobby

Add one or more AI agents to an open battle lobby. Automatically handles payment for paid lobbies.

## Arguments

**Format**: `$ARGUMENTS`

Parse arguments:
- First positional arg: `battle_id` (required) — full UUID or first 8 chars
- Second positional arg: `count` (optional, default 1) — number of agents to join
- `--class=CLASS`: force a specific class (WARRIOR, TRADER, SURVIVOR, PARASITE, GAMBLER)
- `--name=NAME`: set a specific agent name (only works with count=1)

## Configuration

```
API_BASE = environment variable HUNGERNADS_API, or default "https://hungernads.amr-robb.workers.dev"
DASHBOARD = environment variable HUNGERNADS_DASHBOARD, or default "https://hungernads.robbyn.xyz"
RPC_URL = "https://testnet-rpc.monad.xyz"
CHAIN_ID = 10143
ARENA_CONTRACT = "0x45B9151BD350F26eE0ad44395B5555cbA5364DC8"
HNADS_TOKEN = "0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777"
AGENT_FAUCET = "https://agents.devnads.com/v1/faucet"
```

## Execution

### Step 1: Resolve battle ID

If battle_id is < 36 chars (partial), fetch lobbies to find the full UUID:
```bash
curl -s "${API_BASE}/battle/lobbies"
```
Match the partial ID against `battleId` in results. If no match, try using it as-is.

### Step 2: Check lobby status and fees

Fetch battle details:
```bash
curl -s "${API_BASE}/battle/${battle_id}"
```

Extract `feeAmount` (MON fee) and `hnadsFeeAmount` ($HNADS fee) from the response. Show current lobby status before joining.

A lobby is **paid** if `feeAmount > 0` OR `hnadsFeeAmount > 0`. A lobby is **free** if both are "0".

### Step 3: Wallet setup and balance validation (only if paid lobby)

If the lobby is paid:

Each agent gets an ephemeral wallet funded via the Monad agent faucet (free, no auth) for MON. If `hnadsFeeAmount > 0`, the environment variable `HUNGERNADS_PRIVATE_KEY` is **REQUIRED** to transfer $HNADS tokens to the ephemeral wallet (there is no $HNADS faucet).

If `hnadsFeeAmount > 0` and `HUNGERNADS_PRIVATE_KEY` is not set, error and abort:
```
ERROR: $HNADS fee required but HUNGERNADS_PRIVATE_KEY not set.
This lobby requires $HNADS tokens which must be transferred from a funded wallet.
Set the HUNGERNADS_PRIVATE_KEY environment variable and retry.
```

**Validate balances BEFORE joining any agents.** Derive the main wallet address from `HUNGERNADS_PRIVATE_KEY`:
```bash
MAIN_ADDRESS=$(cast wallet address --private-key $MAIN_PK)
```

Check MON balance of main wallet:
```bash
MON_BALANCE=$(cast balance --rpc-url https://testnet-rpc.monad.xyz $MAIN_ADDRESS --ether)
```

Check $HNADS balance of main wallet (if hnadsFeeAmount > 0):
```bash
HNADS_BALANCE=$(cast call --rpc-url https://testnet-rpc.monad.xyz \
  0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777 \
  "balanceOf(address)(uint256)" $MAIN_ADDRESS | cast --from-wei)
```

Calculate total required:
- Total MON needed: `feeAmount * count` (plus gas buffer ~0.01 MON per agent)
- Total $HNADS needed: `hnadsFeeAmount * count`

If MON balance < total MON needed OR $HNADS balance < total $HNADS needed, abort immediately:
```
=== INSUFFICIENT BALANCE ===
MON balance:   ${MON_BALANCE} MON (need ${totalMonNeeded} MON for ${count} agents)
HNADS balance: ${HNADS_BALANCE} $HNADS (need ${totalHnadsNeeded} $HNADS for ${count} agents)

Top up your wallet (${MAIN_ADDRESS}) and retry.
```

If balances are sufficient, show info and proceed:
```
=== PAYMENT REQUIRED ===
MON fee: ${feeAmount} MON per agent
HNADS fee: ${hnadsFeeAmount} $HNADS per agent
Wallet: ${MAIN_ADDRESS}
MON balance: ${MON_BALANCE} MON (need ${totalMonNeeded})
HNADS balance: ${HNADS_BALANCE} $HNADS (need ${totalHnadsNeeded})
Funding: Agent faucet (1 MON per wallet, free)${hnadsFeeAmount > 0 ? ' + main wallet (for $HNADS)' : ''}
Agents: ${count}
```

### Step 4: Join agents

For each agent (1 to count):

1. **Name**: If --name provided and count=1, use it. Otherwise generate a random name:
   - Pattern: `[A-Z]{2,4}_[A-Z0-9]{1,3}` (e.g., "NAD_7X", "REKT_42", "GLD_A3", "MON_99")
   - Max 12 chars, alphanumeric + underscore only

2. **Class**: If --class provided, use it. Otherwise pick ONE class at random from the list below. You MUST vary the selection — do NOT always pick the same class. Use a `shuf` command or similar to ensure true randomness:
   ```bash
   CLASS=$(echo -e "WARRIOR\nTRADER\nSURVIVOR\nPARASITE\nGAMBLER" | shuf -n 1)
   ```

3. **If paid lobby** (feeAmount > 0 OR hnadsFeeAmount > 0):

   **IMPORTANT — Status gate before spending funds:**
   Before ANY on-chain transaction (funding, paying fees), re-fetch the battle status:
   ```bash
   curl -s "${API_BASE}/battle/${battle_id}"
   ```
   If `status` is anything other than `"LOBBY"` or `"COUNTDOWN"`, **STOP immediately** — do NOT fund the wallet, do NOT pay fees. Report:
   ```
   [X/N] SKIPPED — Battle status is '${status}', cannot join. No funds spent.
   ```
   This check must be repeated **before each expensive step** (before funding, before payEntryFee, before depositHnadsFee) to avoid burning funds on a battle that went ACTIVE mid-flow.

   a. Generate ephemeral wallet:
      ```bash
      cast wallet new --json
      ```
      Extract `address` and `privateKey` from JSON output.

   b. **Re-check battle status** (status gate). If not LOBBY/COUNTDOWN, skip this agent with no funds spent.

   c. Fund ephemeral wallet with MON via agent faucet (1 MON, free, no auth):
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

   c. If `hnadsFeeAmount > 0`, transfer $HNADS tokens from HUNGERNADS_PRIVATE_KEY to ephemeral wallet:
      ```bash
      cast send --rpc-url https://testnet-rpc.monad.xyz \
        --private-key $MAIN_PK \
        0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777 \
        "transfer(address,uint256)" $AGENT_ADDRESS \
        $(cast --to-wei $HNADS_FEE ether)
      ```

   d. Compute battle ID as bytes32 for contract calls:
      ```bash
      BATTLE_BYTES=$(cast abi-encode "f(string)" "$BATTLE_ID" | cast keccak)
      ```

   e. **Re-check battle status** (status gate). If not LOBBY/COUNTDOWN, skip this agent. Only wallet funding was spent (recoverable from ephemeral wallet).

   f. **TX 1 — Pay MON entry fee** (if feeAmount > 0):
      ```bash
      cast send --rpc-url https://testnet-rpc.monad.xyz \
        --private-key $AGENT_PK \
        0x45B9151BD350F26eE0ad44395B5555cbA5364DC8 \
        "payEntryFee(bytes32)" $BATTLE_BYTES \
        --value ${FEE}ether
      ```
      Capture the transaction hash as `MON_TX_HASH`.

   g. **TX 2 — Approve $HNADS spending** (if hnadsFeeAmount > 0):
      ```bash
      cast send --rpc-url https://testnet-rpc.monad.xyz \
        --private-key $AGENT_PK \
        0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777 \
        "approve(address,uint256)" 0x45B9151BD350F26eE0ad44395B5555cbA5364DC8 \
        $(cast --to-wei $HNADS_FEE ether)
      ```

   h. **TX 3 — Deposit $HNADS fee** (if hnadsFeeAmount > 0):
      ```bash
      cast send --rpc-url https://testnet-rpc.monad.xyz \
        --private-key $AGENT_PK \
        0x45B9151BD350F26eE0ad44395B5555cbA5364DC8 \
        "depositHnadsFee(bytes32,uint256)" $BATTLE_BYTES \
        $(cast --to-wei $HNADS_FEE ether)
      ```
      Capture the transaction hash as `HNADS_TX_HASH`.

   i. **Re-check battle status** (final status gate before API join). If not LOBBY/COUNTDOWN, report funds were spent on-chain but battle is no longer joinable.

   j. Join with txHash, hnadsTxHash (if applicable), and walletAddress:
      ```bash
      curl -s -X POST "${API_BASE}/battle/${battle_id}/join" \
        -H "Content-Type: application/json" \
        -d '{"agentClass": "WARRIOR", "agentName": "NAD_7X", "txHash": "'$MON_TX_HASH'", "hnadsTxHash": "'$HNADS_TX_HASH'", "walletAddress": "'$AGENT_ADDRESS'"}'
      ```
      If `hnadsFeeAmount = 0`, omit `hnadsTxHash` from the payload.

4. **If free lobby** (feeAmount = 0 AND hnadsFeeAmount = 0):
   ```bash
   curl -s -X POST "${API_BASE}/battle/${battle_id}/join" \
     -H "Content-Type: application/json" \
     -d '{"agentClass": "WARRIOR", "agentName": "NAD_7X"}'
   ```

5. **Report each join**:
   ```
   [1/5] WARRIOR "NAD_7X"   -> funded 1 MON + ${hnadsFee} $HNADS -> TX1: payEntryFee (0xab..cd) -> TX2: approve (0xef..12) -> TX3: depositHnads (0x34..56) -> Slot 3  (3/8)
   [2/5] GAMBLER "REKT_42"  -> funded 1 MON + ${hnadsFee} $HNADS -> TX1: payEntryFee (0x78..9a) -> TX2: approve (0xbc..de) -> TX3: depositHnads (0xf0..12) -> Slot 4  (4/8)
   [3/5] SURVIVOR "GLD_A3"  -> funded 1 MON + ${hnadsFee} $HNADS -> TX1: payEntryFee (0x34..56) -> TX2: approve (0x78..9a) -> TX3: depositHnads (0xbc..de) -> Slot 5  (5/8)  ** COUNTDOWN TRIGGERED! **
   ```

   For MON-only lobbies (hnadsFeeAmount = 0), omit $HNADS parts:
   ```
   [1/5] WARRIOR "NAD_7X"   -> funded 1 MON -> TX1: payEntryFee (0xab..cd) -> Slot 3  (3/8)
   ```

   For free lobbies, omit the funded/paid parts:
   ```
   [1/5] WARRIOR "NAD_7X"   -> Slot 3  (3/8)
   ```

### Step 5: Summary

```
=== JOINED ===
${successCount}/${count} agents joined successfully
Lobby: ${totalPlayers}/8 gladiators
${feeAmount > 0 ? `Total MON spent: ${totalMonSpent} MON` : ''}
${hnadsFeeAmount > 0 ? `Total $HNADS spent: ${totalHnadsSpent} $HNADS` : ''}
Countdown: ${status}

Watch live: ${DASHBOARD}/lobby/${battle_id}
```

## Error Handling

- 402 (payment required): Lobby has a fee — triggers wallet flow automatically
- 409 (lobby full): Stop joining, report how many succeeded
- 409 (duplicate name): Retry with a different generated name (up to 3 retries)
- 409 (wrong status): Battle already started or cancelled
- 404: Battle not found
- Connection error: API unreachable, check HUNGERNADS_API setting
- **Faucet fails**: Fall back to `HUNGERNADS_PRIVATE_KEY` if available, otherwise skip the agent
- **Faucet + PK both unavailable**: Skip that agent, continue with others, report at end
- **Insufficient MON or $HNADS balance**: Abort before joining any agents, show balances and required amounts
- **$HNADS fee required but HUNGERNADS_PRIVATE_KEY not set**: Abort immediately (cannot get $HNADS from faucet)
- **Contract tx fails**: Report which TX (1/2/3) failed, skip that agent, continue with others
- **cast not found**: Error "Foundry's cast CLI is required. Install: curl -L https://foundry.paradigm.xyz | bash"
