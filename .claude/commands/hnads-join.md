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

**Read `/hnads-config` for all shared constants** (API_BASE, DASHBOARD, RPC_URL, CHAIN_ID, contract addresses, wallet setup, on-chain TX templates, and error messages).

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

`HUNGERNADS_PRIVATE_KEY` is **REQUIRED**. If not set, error and abort (see `/hnads-config`).

**Validate balances BEFORE joining any agents.** Derive wallet address and check balances (see `/hnads-config`).

Calculate total required:
- Total MON needed: `feeAmount * count` (plus gas buffer ~0.01 MON per agent)
- Total $HNADS needed: `hnadsFeeAmount * count`

If MON balance < total MON needed OR $HNADS balance < total $HNADS needed, abort immediately:
```
=== INSUFFICIENT BALANCE ===
MON balance:   ${MON_BALANCE} MON (need ${totalMonNeeded} MON for ${count} agents)
HNADS balance: ${HNADS_BALANCE} $HNADS (need ${totalHnadsNeeded} $HNADS for ${count} agents)

Top up your wallet (${WALLET_ADDRESS}) and retry.
```

If balances are sufficient, show info and proceed:
```
=== PAYMENT REQUIRED ===
MON fee: ${feeAmount} MON per agent
HNADS fee: ${hnadsFeeAmount} $HNADS per agent
Wallet: ${WALLET_ADDRESS}
MON balance: ${MON_BALANCE} MON (need ${totalMonNeeded})
HNADS balance: ${HNADS_BALANCE} $HNADS (need ${totalHnadsNeeded})
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
   Before ANY on-chain transaction, re-fetch the battle status:
   ```bash
   curl -s "${API_BASE}/battle/${battle_id}"
   ```
   If `status` is anything other than `"LOBBY"` or `"COUNTDOWN"`, **STOP immediately** — do NOT pay fees. Report:
   ```
   [X/N] SKIPPED — Battle status is '${status}', cannot join. No funds spent.
   ```

   a. Compute battle ID as bytes32 (once, reuse for all agents):
      ```bash
      BATTLE_BYTES=$(cast abi-encode "f(string)" "$BATTLE_ID" | cast keccak)
      ```

   b. **Wait for on-chain battle registration** (first agent only — see `/hnads-config`).

   c. **Re-check battle status** (status gate). If not LOBBY/COUNTDOWN, skip.

   d. **TX 1 — Pay MON entry fee** (if feeAmount > 0) — see `/hnads-config`. Uses user's wallet directly.
      Capture the transaction hash as `MON_TX_HASH`.

   e. **TX 2 — Approve $HNADS spending** (if hnadsFeeAmount > 0) — see `/hnads-config`.

   f. **TX 3 — Deposit $HNADS fee** (if hnadsFeeAmount > 0) — see `/hnads-config`.

   g. Join with txHash and walletAddress:
      ```bash
      curl -s -X POST "${API_BASE}/battle/${battle_id}/join" \
        -H "Content-Type: application/json" \
        -d '{"agentClass": "'$CLASS'", "agentName": "'$NAME'", "txHash": "'$MON_TX_HASH'", "walletAddress": "'$WALLET_ADDRESS'"}'
      ```

4. **If free lobby** (feeAmount = 0 AND hnadsFeeAmount = 0):
   ```bash
   curl -s -X POST "${API_BASE}/battle/${battle_id}/join" \
     -H "Content-Type: application/json" \
     -d '{"agentClass": "'$CLASS'", "agentName": "'$NAME'"}'
   ```

5. **Report each join**:
   ```
   [1/5] WARRIOR "NAD_7X"   -> TX1: payEntryFee (0xab..cd) -> Slot 3  (3/8)
   [2/5] GAMBLER "REKT_42"  -> TX1: payEntryFee (0x78..9a) -> Slot 4  (4/8)
   [3/5] SURVIVOR "GLD_A3"  -> TX1: payEntryFee (0x34..56) -> Slot 5  (5/8)  ** COUNTDOWN TRIGGERED! **
   ```

   For free lobbies:
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

See `/hnads-config` for shared error messages. Additional:
- 402 (payment required): Lobby has a fee — triggers wallet flow automatically
- 409 (lobby full): Stop joining, report how many succeeded
- 409 (duplicate name): Retry with a different generated name (up to 3 retries)
- 409 (wrong status): Battle already started or cancelled
- 404: Battle not found
- Connection error: API unreachable, check HUNGERNADS_API setting
- **Insufficient MON or $HNADS balance**: Abort before joining any agents, show balances and required amounts
- **Contract tx fails**: Report which TX (1/2/3) failed, skip that agent, continue with others
