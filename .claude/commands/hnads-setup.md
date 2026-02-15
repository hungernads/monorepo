# HungerNads Wallet Setup

Set up your wallet for paid HungerNads lobbies. Either import an existing private key or generate a fresh wallet.

## Arguments

**Format**: `$ARGUMENTS`

Parse arguments:
- `--key=PRIVATE_KEY`: import an existing private key (hex, with or without 0x prefix)
- `--generate`: generate a new wallet instead of importing
- `--api=URL`: override HUNGERNADS_API (default: production worker)
- `--dashboard=URL`: override HUNGERNADS_DASHBOARD (default: production dashboard)

If no arguments provided, ask the user what they want to do.

## Configuration

```
RPC_URL = "https://testnet-rpc.monad.xyz"
CHAIN_ID = 10143
HNADS_TOKEN = "0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777"
```

## Prerequisites

Check that `cast` (Foundry) is installed:
```bash
which cast
```
If not found, error:
```
Foundry's cast CLI is required for wallet operations.
Install: curl -L https://foundry.paradigm.xyz | bash && foundryup
```

## Execution

### Step 1: Get or generate wallet

**If --key provided** (or user pastes a key):

Validate the key:
```bash
cast wallet address --private-key $KEY
```
If it errors, report invalid key and abort.

Extract the address from output.

**If --generate** (or user asks to generate):

```bash
cast wallet new --json
```
Extract `address` and `privateKey` from JSON output.

Display:
```
=== NEW WALLET GENERATED ===
Address:     ${address}
Private Key: ${privateKey}

IMPORTANT: Save your private key somewhere safe! If you lose it, your funds are gone.
```

**If no args**: Ask the user with AskUserQuestion:
```
How would you like to set up your wallet?
  1. Import existing key — I have a private key to use
  2. Generate new wallet — Create a fresh Monad testnet wallet
```

### Step 2: Check balances

```bash
MON_BALANCE=$(cast balance --rpc-url https://testnet-rpc.monad.xyz $ADDRESS --ether)
```

```bash
HNADS_BALANCE=$(cast call --rpc-url https://testnet-rpc.monad.xyz \
  0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777 \
  "balanceOf(address)(uint256)" $ADDRESS | cast --from-wei)
```

### Step 3: Save configuration

Write the private key to the project `.env` file (create if needed, append if exists). Do NOT overwrite existing entries — update them if `HUNGERNADS_PRIVATE_KEY` already exists.

```
HUNGERNADS_PRIVATE_KEY=${privateKey}
```

If --api provided, also save:
```
HUNGERNADS_API=${api}
```

If --dashboard provided, also save:
```
HUNGERNADS_DASHBOARD=${dashboard}
```

### Step 4: Fund if needed (new wallets)

If MON balance is 0, offer to fund via the agent faucet:
```bash
curl -s -X POST "https://agents.devnads.com/v1/faucet" \
  -H "Content-Type: application/json" \
  -d '{"chainId": 10143, "address": "'$ADDRESS'"}'
```

Re-check MON balance after faucet:
```bash
MON_BALANCE=$(cast balance --rpc-url https://testnet-rpc.monad.xyz $ADDRESS --ether)
```

### Step 5: Summary

```
=== WALLET CONFIGURED ===
Address:       ${address}
MON balance:   ${MON_BALANCE} MON
$HNADS balance: ${HNADS_BALANCE} $HNADS
Saved to:      .env (HUNGERNADS_PRIVATE_KEY)

You're ready to join paid lobbies!

Next steps:
  /hnads-compete          — Find or create a lobby and join
  /hnads-browse           — Browse open lobbies
  /hnads-join <id>        — Join a specific lobby

${MON_BALANCE == 0 ? "Note: Your wallet has 0 MON. Free lobbies work without funds." : ""}
${HNADS_BALANCE == 0 ? "Note: Your wallet has 0 $HNADS. Lobbies with $HNADS fees will require tokens." : ""}
```

## Error Handling

- **Invalid private key**: Report "Invalid private key format" and abort
- **cast not found**: Report install instructions and abort
- **Faucet fails**: Report "Faucet unavailable. You can fund manually by sending MON to ${address} on Monad testnet."
- **.env write fails**: Show the export command instead: `export HUNGERNADS_PRIVATE_KEY=${key}`
- **Key already in .env**: Update existing value, show "Updated existing HUNGERNADS_PRIVATE_KEY"
