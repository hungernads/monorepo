#!/usr/bin/env bash
# migrate-oracle.sh — Transfer oracle/owner/treasury roles to a new wallet
#
# Usage:
#   CURRENT_PK=0x... NEW_ORACLE=0x... ./scripts/migrate-oracle.sh
#
# Optional:
#   NEW_TREASURY=0x...  (defaults to NEW_ORACLE)
#   RPC_URL=...         (defaults to Monad testnet)
#   SKIP_OWNERSHIP=1    (skip transferOwnership calls)

set -euo pipefail
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1

# ── Config ───────────────────────────────────────────────────────
RPC_URL="${RPC_URL:-https://monad.drpc.org}"
CURRENT_PK="${CURRENT_PK:?Set CURRENT_PK to the current owner private key}"
NEW_ORACLE="${NEW_ORACLE:?Set NEW_ORACLE to the new oracle/owner address}"
NEW_TREASURY="${NEW_TREASURY:-$NEW_ORACLE}"
SKIP_OWNERSHIP="${SKIP_OWNERSHIP:-0}"

# Contract addresses (UUPS proxies)
ARENA="0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db"
BETTING="0x6F677989784Cc214E4Ee02257Fad3fc4374dD383"
# CLASS_TOKEN_MANAGER — uncomment and set if deployed
# CLASS_TOKEN_MANAGER="0x..."

echo "════════════════════════════════════════════════════"
echo "  HUNGERNADS — Oracle Migration"
echo "════════════════════════════════════════════════════"
echo "  RPC:           $RPC_URL"
echo "  New Oracle:    $NEW_ORACLE"
echo "  New Treasury:  $NEW_TREASURY"
echo "  Skip ownership: $SKIP_OWNERSHIP"
echo "════════════════════════════════════════════════════"
echo ""

send() {
  local label="$1" contract="$2" fn="$3" arg="$4"
  echo -n "  $label... "
  TX=$(cast send --rpc-url "$RPC_URL" --private-key "$CURRENT_PK" \
    "$contract" "$fn" "$arg" --json 2>&1 | python3 -c "import json,sys; print(json.load(sys.stdin).get('transactionHash','FAILED'))" 2>/dev/null || echo "FAILED")
  if [ "$TX" = "FAILED" ]; then
    echo "FAILED"
  else
    echo "$TX"
  fi
}

# ── 1. HungernadsArena ──────────────────────────────────────────
echo "[Arena] $ARENA"
send "setOracle" "$ARENA" "setOracle(address)" "$NEW_ORACLE"
send "setTreasury" "$ARENA" "setTreasury(address)" "$NEW_TREASURY"
if [ "$SKIP_OWNERSHIP" != "1" ]; then
  send "transferOwnership" "$ARENA" "transferOwnership(address)" "$NEW_ORACLE"
fi
echo ""

# ── 2. HungernadsBetting ────────────────────────────────────────
echo "[Betting] $BETTING"
send "setOracle" "$BETTING" "setOracle(address)" "$NEW_ORACLE"
send "setTreasury" "$BETTING" "setTreasury(address)" "$NEW_TREASURY"
if [ "$SKIP_OWNERSHIP" != "1" ]; then
  send "transferOwnership" "$BETTING" "transferOwnership(address)" "$NEW_ORACLE"
fi
echo ""

# ── 3. ClassTokenManager (if set) ───────────────────────────────
if [ -n "${CLASS_TOKEN_MANAGER:-}" ]; then
  echo "[ClassTokenManager] $CLASS_TOKEN_MANAGER"
  send "setOracle" "$CLASS_TOKEN_MANAGER" "setOracle(address)" "$NEW_ORACLE"
  if [ "$SKIP_OWNERSHIP" != "1" ]; then
    send "transferOwnership" "$CLASS_TOKEN_MANAGER" "transferOwnership(address)" "$NEW_ORACLE"
  fi
  echo ""
fi

echo "════════════════════════════════════════════════════"
echo "  On-chain migration complete."
echo ""
echo "  Next steps:"
echo "  1. Update wrangler secret:"
echo "     echo -n '<new-private-key>' | npx wrangler secret put PRIVATE_KEY"
echo "  2. Redeploy: npx wrangler deploy"
echo "  3. Update hardcoded refs:"
echo "     - CLAUDE.md"
echo "     - docs/SUBMISSION.md"
echo "     - .claude/commands/hnads-fill.md"
echo "     - scripts/deploy-tier-system.sh"
echo "════════════════════════════════════════════════════"
