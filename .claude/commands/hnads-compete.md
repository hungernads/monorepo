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

Each agent gets an ephemeral wallet funded via the Monad agent faucet (free, no auth) for MON. If `hnadsFeeAmount > 0`, the environment variable `HUNGERNADS_PRIVATE_KEY` is **REQUIRED** to transfer $HNADS tokens to the ephemeral wallet (there is no $HNADS faucet).

If `hnadsFeeAmount > 0` and `HUNGERNADS_PRIVATE_KEY` is not set, error and abort:
```
ERROR: $HNADS fee required but HUNGERNADS_PRIVATE_KEY not set.
This lobby requires $HNADS tokens which must be transferred from a funded wallet.
Set the HUNGERNADS_PRIVATE_KEY environment variable and retry.
```

1. **Validate balances BEFORE proceeding.** Derive the main wallet address from `HUNGERNADS_PRIVATE_KEY`:
   ```bash
   MAIN_ADDRESS=$(cast wallet address --private-key $MAIN_PK)
   MON_BALANCE=$(cast balance --rpc-url https://testnet-rpc.monad.xyz $MAIN_ADDRESS --ether)
   ```
   If `hnadsFeeAmount > 0`, also check $HNADS balance:
   ```bash
   HNADS_BALANCE=$(cast call --rpc-url https://testnet-rpc.monad.xyz \
     0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777 \
     "balanceOf(address)(uint256)" $MAIN_ADDRESS | cast --from-wei)
   ```
   If MON balance < `feeAmount` (plus ~0.01 gas buffer) OR $HNADS balance < `hnadsFeeAmount`, abort:
   ```
   === INSUFFICIENT BALANCE ===
   MON balance:   ${MON_BALANCE} MON (need ${feeAmount} MON)
   HNADS balance: ${HNADS_BALANCE} $HNADS (need ${hnadsFeeAmount} $HNADS)

   Top up your wallet (${MAIN_ADDRESS}) and retry.
   ```

2. **Show cost** (balances sufficient):
   ```
   === PAYMENT REQUIRED ===
   MON fee: ${feeAmount} MON
   HNADS fee: ${hnadsFeeAmount} $HNADS
   Wallet: ${MAIN_ADDRESS}
   MON balance: ${MON_BALANCE} MON
   HNADS balance: ${HNADS_BALANCE} $HNADS
   Funding: Agent faucet (1 MON, free)${hnadsFeeAmount > 0 ? ' + main wallet (for $HNADS)' : ''}
   ```

2. **Generate ephemeral wallet**:
   ```bash
   cast wallet new --json
   ```
   Extract `address` and `privateKey`.

3. **Fund ephemeral wallet with MON via agent faucet**:
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
   If neither works, error and abort.

4. **If `hnadsFeeAmount > 0`, transfer $HNADS tokens** from HUNGERNADS_PRIVATE_KEY to ephemeral wallet:
   ```bash
   cast send --rpc-url https://testnet-rpc.monad.xyz \
     --private-key $MAIN_PK \
     0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777 \
     "transfer(address,uint256)" $AGENT_ADDRESS \
     $(cast --to-wei $HNADS_FEE ether)
   ```

5. **Compute battle ID as bytes32** for contract calls:
   ```bash
   BATTLE_BYTES=$(cast abi-encode "f(string)" "$BATTLE_ID" | cast keccak)
   ```

6. **TX 1 — Pay MON entry fee** (if feeAmount > 0):
   ```bash
   cast send --rpc-url https://testnet-rpc.monad.xyz \
     --private-key $AGENT_PK \
     0x45B9151BD350F26eE0ad44395B5555cbA5364DC8 \
     "payEntryFee(bytes32)" $BATTLE_BYTES \
     --value ${FEE}ether
   ```
   Capture the transaction hash as `MON_TX_HASH`.

7. **TX 2 — Approve $HNADS spending** (if hnadsFeeAmount > 0):
   ```bash
   cast send --rpc-url https://testnet-rpc.monad.xyz \
     --private-key $AGENT_PK \
     0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777 \
     "approve(address,uint256)" 0x45B9151BD350F26eE0ad44395B5555cbA5364DC8 \
     $(cast --to-wei $HNADS_FEE ether)
   ```

8. **TX 3 — Deposit $HNADS fee** (if hnadsFeeAmount > 0):
   ```bash
   cast send --rpc-url https://testnet-rpc.monad.xyz \
     --private-key $AGENT_PK \
     0x45B9151BD350F26eE0ad44395B5555cbA5364DC8 \
     "depositHnadsFee(bytes32,uint256)" $BATTLE_BYTES \
     $(cast --to-wei $HNADS_FEE ether)
   ```

### Step 5: Join the battle

**If paid** (feeAmount > 0 OR hnadsFeeAmount > 0):
```bash
curl -s -X POST "${API_BASE}/battle/${battle_id}/join" \
  -H "Content-Type: application/json" \
  -d '{"agentClass": "${class}", "agentName": "${name}", "txHash": "'$MON_TX_HASH'", "walletAddress": "'$AGENT_ADDRESS'"}'
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
${feeAmount > 0 ? `Wallet: ${agentAddress}\nMON fee paid: ${feeAmount} MON (TX1: ${monTxHash.slice(0,10)}...${monTxHash.slice(-6)})` : ''}
${hnadsFeeAmount > 0 ? `$HNADS fee paid: ${hnadsFeeAmount} $HNADS (TX2: approve, TX3: ${hnadsTxHash.slice(0,10)}...${hnadsTxHash.slice(-6)})` : ''}

${status === 'COUNTDOWN' ? 'Battle starts in ~60 seconds!' : `Waiting for ${5 - playerCount} more gladiators...`}

Watch live: ${DASHBOARD}/lobby/${battle_id}

Share this link so others can join:
${DASHBOARD}/lobby/${battle_id}

Tip: Need more agents? Run: /hnads-join ${battle_id.slice(0,8)} 4
```

If the lobby still needs agents to trigger countdown, suggest `/hnads-join` to fill slots.

## Error Handling

- **Faucet fails**: Fall back to `HUNGERNADS_PRIVATE_KEY` if available, otherwise abort
- **Faucet + PK both unavailable**: Report error, do not attempt join
- **Insufficient MON or $HNADS balance**: Abort before attempting any transactions, show balances and required amounts
- **$HNADS fee required but HUNGERNADS_PRIVATE_KEY not set**: Abort immediately (cannot get $HNADS from faucet)
- **Contract tx fails**: Report which TX (1/2/3) failed, do not attempt join
- **Fee payment fails**: Report error, do not attempt join
- **402 Payment Required**: Fee required but no txHash — triggers wallet flow
- **cast not found**: Error "Foundry's cast CLI is required. Install: curl -L https://foundry.paradigm.xyz | bash"
