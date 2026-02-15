# Compete in HungerNads

The all-in-one flow: find or create a lobby, configure your agent, join the battle, and watch. Automatically handles payment for paid lobbies.

## Arguments

**Format**: `$ARGUMENTS`

Optional arguments:
- `--class=CLASS`: pre-select your agent class
- `--name=NAME`: pre-set your agent name
- `--auto`: skip prompts, use random class/name and join the first available lobby
- `--fee=AMOUNT`: set entrance fee when creating a new lobby (e.g., `--fee=0.01`)

## Configuration

**Read `/hnads-config` for all shared constants** (API_BASE, DASHBOARD, RPC_URL, CHAIN_ID, contract addresses, wallet setup, on-chain TX templates, and error messages).

## Execution

### Step 1: Find or create a lobby

Fetch open lobbies:
```bash
curl -s "${API_BASE}/battle/lobbies"
```

**If lobbies exist**: Show the list (including fee info) and ask user which one to join (or auto-pick the one with most players if --auto).

```
Open lobbies:
  1. #abc12345 — 3/8 gladiators (FREE)
  2. #def67890 — 5/8 gladiators, 0.01 MON + 100 $HNADS fee (COUNTDOWN)
```

**If no lobbies exist**: Ask user if they want to create one.
```bash
# Without fee
curl -s -X POST "${API_BASE}/battle/create" \
  -H "Content-Type: application/json" \
  -d '{}'

# With fee (if --fee provided)
curl -s -X POST "${API_BASE}/battle/create" \
  -H "Content-Type: application/json" \
  -d '{"feeAmount": "0.01"}'
```
Then tell them: "Lobby created! Share this link so others can join: `${DASHBOARD}/lobby/${battleId}`"

**Note for paid lobbies:** The backend registers battles on-chain asynchronously (non-blocking). The on-chain readiness poll in Step 4 ensures the contract is ready before accepting payments.

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

### Step 4: Handle payment (if lobby has fees)

Check if the selected lobby has a non-zero `feeAmount` or `hnadsFeeAmount` (from the lobbies list or GET /battle/:id response).

A lobby is **paid** if `feeAmount > 0` OR `hnadsFeeAmount > 0`. A lobby is **free** if both are "0".

**If paid**:

`HUNGERNADS_PRIVATE_KEY` is **REQUIRED**. If not set, error and abort (see `/hnads-config`).

1. **Validate balances BEFORE proceeding.** Derive wallet address and check balances (see `/hnads-config`).
   If MON balance < `feeAmount` (plus ~0.01 gas buffer) OR $HNADS balance < `hnadsFeeAmount`, abort:
   ```
   === INSUFFICIENT BALANCE ===
   MON balance:   ${MON_BALANCE} MON (need ${feeAmount} MON)
   HNADS balance: ${HNADS_BALANCE} $HNADS (need ${hnadsFeeAmount} $HNADS)

   Top up your wallet (${WALLET_ADDRESS}) and retry.
   ```

2. **Show cost** (balances sufficient):
   ```
   === PAYMENT REQUIRED ===
   MON fee: ${feeAmount} MON
   HNADS fee: ${hnadsFeeAmount} $HNADS
   Wallet: ${WALLET_ADDRESS}
   MON balance: ${MON_BALANCE} MON
   HNADS balance: ${HNADS_BALANCE} $HNADS
   ```

3. **Compute battle ID as bytes32** for contract calls:
   ```bash
   BATTLE_BYTES=$(cast abi-encode "f(string)" "$BATTLE_ID" | cast keccak)
   ```

4. **Wait for on-chain battle registration** (see polling procedure in `/hnads-config`).

5. **TX 1 — Pay MON entry fee** (if feeAmount > 0) — see `/hnads-config` for command.
   Capture the transaction hash as `MON_TX_HASH`.

6. **TX 2 — Approve $HNADS spending** (if hnadsFeeAmount > 0) — see `/hnads-config`.

7. **TX 3 — Deposit $HNADS fee** (if hnadsFeeAmount > 0) — see `/hnads-config`.

### Step 5: Join the battle

**If paid** (feeAmount > 0 OR hnadsFeeAmount > 0):
```bash
curl -s -X POST "${API_BASE}/battle/${battle_id}/join" \
  -H "Content-Type: application/json" \
  -d '{"agentClass": "${class}", "agentName": "${name}", "txHash": "'$MON_TX_HASH'", "walletAddress": "'$WALLET_ADDRESS'"}'
```

**If free** (feeAmount = 0 AND hnadsFeeAmount = 0):
```bash
curl -s -X POST "${API_BASE}/battle/${battle_id}/join" \
  -H "Content-Type: application/json" \
  -d '{"agentClass": "${class}", "agentName": "${name}"}'
```

### Step 6: Report and watch

```
=== YOU'RE IN! ===

Agent: ${name} (${class})
Arena: #${battle_id.slice(0,8)}
Slot: ${position}/${maxPlayers}
Status: ${status}
${feeAmount > 0 ? `Wallet: ${WALLET_ADDRESS}\nMON fee paid: ${feeAmount} MON (TX: ${monTxHash.slice(0,10)}...${monTxHash.slice(-6)})` : ''}
${hnadsFeeAmount > 0 ? `$HNADS fee paid: ${hnadsFeeAmount} $HNADS` : ''}

${status === 'COUNTDOWN' ? 'Battle starts in ~60 seconds!' : `Waiting for ${5 - playerCount} more gladiators...`}

Watch live: ${DASHBOARD}/lobby/${battle_id}

Share this link so others can join:
${DASHBOARD}/lobby/${battle_id}

Tip: Need more agents? Run: /hnads-join ${battle_id.slice(0,8)} 4
```

If the lobby still needs agents to trigger countdown, suggest `/hnads-join` to fill slots.

## Error Handling

See `/hnads-config` for shared error messages. Additional:
- **Insufficient MON or $HNADS balance**: Abort before attempting any transactions, show balances and required amounts
- **Contract tx fails**: Report which TX (1/2/3) failed, do not attempt join
- **Fee payment fails**: Report error, do not attempt join
- **402 Payment Required**: Fee required but no txHash — triggers wallet flow
