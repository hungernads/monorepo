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

**Read `/hnads-config` for all shared constants** (RPC_URL, CHAIN_ID, HNADS_TOKEN, balance check commands, and error messages).

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
  2. Generate new wallet — Create a fresh Monad wallet
```

### Step 2: Check balances

```bash
MON_BALANCE=$(cast balance --rpc-url ${RPC_URL} $ADDRESS --ether)
```

```bash
HNADS_BALANCE=$(cast call --rpc-url ${RPC_URL} \
  0x553C2F72D34c9b4794A04e09C6714D47Dc257777 \
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

### Step 4: Fund reminder (new wallets)

If MON balance is 0, tell the user they need to fund their wallet:
```
Your wallet has 0 MON. To join paid lobbies, send MON to:
  ${address}

You can get MON from an exchange or a friend. Free lobbies work without funds.
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
- **Zero balance**: Tell user to fund their wallet by sending MON to ${address} on Monad mainnet
- **.env write fails**: Show the export command instead: `export HUNGERNADS_PRIVATE_KEY=${key}`
- **Key already in .env**: Update existing value, show "Updated existing HUNGERNADS_PRIVATE_KEY"
