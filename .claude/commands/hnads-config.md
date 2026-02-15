# HungerNads Shared Configuration

This file is referenced by all `/hnads-*` skills. Update values here — all skills inherit automatically.

## Network & Contracts

```
API_BASE = environment variable HUNGERNADS_API, or default "https://hungernads.amr-robb.workers.dev"
DASHBOARD = environment variable HUNGERNADS_DASHBOARD, or default "https://hungernads.robbyn.xyz"
RPC_URL = environment variable MONAD_RPC_URL, or default "https://monad.drpc.org"
CHAIN_ID = 143
ARENA_CONTRACT = "0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db"
HNADS_TOKEN = "0x553C2F72D34c9b4794A04e09C6714D47Dc257777"
TREASURY_ADDRESS = "0x8757F328371E571308C1271BD82B91882253FDd1"
```

## Wallet

This is **mainnet** (Monad chain 143). There is no faucet.

- `HUNGERNADS_PRIVATE_KEY` environment variable is **REQUIRED** for paid lobbies
- Run `/hnads-setup` to configure your wallet (import key or generate new one)
- The wallet derived from `HUNGERNADS_PRIVATE_KEY` pays fees **directly** — no ephemeral wallets
- Free lobbies do not require a wallet or private key

### Deriving wallet address

```bash
WALLET_PK=$HUNGERNADS_PRIVATE_KEY
WALLET_ADDRESS=$(cast wallet address --private-key $WALLET_PK)
```

## Balance Checks

```bash
# MON balance
MON_BALANCE=$(cast balance --rpc-url ${RPC_URL} $WALLET_ADDRESS --ether)

# $HNADS balance
HNADS_BALANCE=$(cast call --rpc-url ${RPC_URL} \
  0x553C2F72D34c9b4794A04e09C6714D47Dc257777 \
  "balanceOf(address)(uint256)" $WALLET_ADDRESS | cast --from-wei)
```

## On-Chain Battle Registration (paid lobbies)

The backend registers battles on-chain asynchronously. Poll until confirmed:

```bash
BATTLE_BYTES=$(cast abi-encode "f(string)" "$BATTLE_ID" | cast keccak)

echo "Waiting for on-chain battle registration..."
REGISTERED=false
for i in $(seq 1 6); do
  RESULT=$(cast call --rpc-url ${RPC_URL} \
    0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db \
    "battles(bytes32)" $BATTLE_BYTES 2>/dev/null || echo "")
  if [ -n "$RESULT" ] && echo "$RESULT" | grep -qv "^0x0\{64\}"; then
    echo "Battle registered on-chain"
    REGISTERED=true
    break
  fi
  echo "  ...not yet registered, retrying in 5s ($i/6)"
  sleep 5
done
if [ "$REGISTERED" = "false" ]; then
  echo "ERROR: Battle not registered on-chain after 30s."
  # STOP — do not spend funds
fi
```

## On-Chain Transactions (paid lobbies)

All transactions use the user's wallet directly (`HUNGERNADS_PRIVATE_KEY`).

### TX 1 — Pay MON entry fee (if feeAmount > 0)
```bash
cast send --rpc-url ${RPC_URL} \
  --private-key $WALLET_PK \
  0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db \
  "payEntryFee(bytes32)" $BATTLE_BYTES \
  --value ${FEE}ether
```

### TX 2 — Approve $HNADS spending (if hnadsFeeAmount > 0)
```bash
cast send --rpc-url ${RPC_URL} \
  --private-key $WALLET_PK \
  0x553C2F72D34c9b4794A04e09C6714D47Dc257777 \
  "approve(address,uint256)" 0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db \
  $(cast --to-wei $HNADS_FEE ether)
```

### TX 3 — Deposit $HNADS fee (if hnadsFeeAmount > 0)
```bash
cast send --rpc-url ${RPC_URL} \
  --private-key $WALLET_PK \
  0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db \
  "depositHnadsFee(bytes32,uint256)" $BATTLE_BYTES \
  $(cast --to-wei $HNADS_FEE ether)
```

## Error Messages

- **HUNGERNADS_PRIVATE_KEY not set**: `"ERROR: HUNGERNADS_PRIVATE_KEY not set. This is required for paid lobbies. Run /hnads-setup to configure your wallet."`
- **Insufficient balance**: Show current balance vs required, tell user to top up their wallet address
- **cast not found**: `"Foundry's cast CLI is required. Install: curl -L https://foundry.paradigm.xyz | bash && foundryup"`
- **Contract tx fails**: Report which TX (1/2/3) failed, do not attempt join
