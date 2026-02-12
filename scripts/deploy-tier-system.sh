#!/bin/bash
#
# HUNGERNADS - Tier System Deployment Script
# "May the nads be ever in your favor."
#
# Deploys the full tier system: D1 migration, contract upgrade, worker deploy,
# and secret configuration.
#
# Usage:
#   ./scripts/deploy-tier-system.sh                    # Full deployment
#   ./scripts/deploy-tier-system.sh --dry-run          # Preview without executing
#   ./scripts/deploy-tier-system.sh --skip-contracts   # Skip contract upgrade
#   ./scripts/deploy-tier-system.sh --skip-worker      # Skip worker deploy
#   ./scripts/deploy-tier-system.sh --skip-migration   # Skip D1 migration
#   ./scripts/deploy-tier-system.sh --contracts-only   # Only upgrade contracts
#
# Prerequisites:
#   - forge (Foundry) installed
#   - wrangler authenticated (wrangler login)
#   - cast (Foundry) installed
#   - .env file with MONAD_RPC_URL and PRIVATE_KEY
#
# Environment variables (from .env or shell):
#   MONAD_RPC_URL          - Monad testnet RPC endpoint
#   PRIVATE_KEY            - Deployer wallet private key (0x-prefixed)
#   ARENA_PROXY_ADDRESS    - HungernadsArena proxy address (default: from CLAUDE.md)
#   HNADS_TOKEN_ADDRESS    - $HNADS ERC20 token address (default: from dashboard env)
#   TREASURY_ADDRESS       - Treasury wallet address (default: oracle/owner address)

set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"

# Defaults from CLAUDE.md / deployed addresses
DEFAULT_ARENA_PROXY="0x45B9151BD350F26eE0ad44395B5555cbA5364DC8"
DEFAULT_HNADS_TOKEN="0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777"
DEFAULT_TREASURY="0x77C037fbF42e85dB1487B390b08f58C00f438812"
DEFAULT_RPC="https://testnet-rpc.monad.xyz"

# ─── Colors ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ─── Flags ─────────────────────────────────────────────────────────
DRY_RUN=false
SKIP_CONTRACTS=false
SKIP_WORKER=false
SKIP_MIGRATION=false
CONTRACTS_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)        DRY_RUN=true ;;
    --skip-contracts) SKIP_CONTRACTS=true ;;
    --skip-worker)    SKIP_WORKER=true ;;
    --skip-migration) SKIP_MIGRATION=true ;;
    --contracts-only) CONTRACTS_ONLY=true; SKIP_MIGRATION=true; SKIP_WORKER=true ;;
    --help|-h)
      echo "Usage: $0 [--dry-run] [--skip-contracts] [--skip-worker] [--skip-migration] [--contracts-only]"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown flag: $arg${NC}"
      exit 1
      ;;
  esac
done

# ─── Helpers ───────────────────────────────────────────────────────
log_step() {
  echo ""
  echo -e "${BOLD}${PURPLE}=== [$1] $2 ===${NC}"
}

log_info() {
  echo -e "  ${CYAN}->$NC $1"
}

log_ok() {
  echo -e "  ${GREEN}OK:$NC $1"
}

log_warn() {
  echo -e "  ${YELLOW}WARN:$NC $1"
}

log_err() {
  echo -e "  ${RED}ERROR:$NC $1"
}

run_cmd() {
  if $DRY_RUN; then
    echo -e "  ${YELLOW}[DRY RUN]$NC $*"
  else
    "$@"
  fi
}

# ─── Load Environment ─────────────────────────────────────────────
log_step "0" "Loading environment"

# Source .env if it exists
if [ -f "$REPO_ROOT/.env" ]; then
  log_info "Loading .env from $REPO_ROOT/.env"
  set -a
  source "$REPO_ROOT/.env"
  set +a
else
  log_warn "No .env file found at $REPO_ROOT/.env"
fi

# Resolve variables with defaults
MONAD_RPC_URL="${MONAD_RPC_URL:-$DEFAULT_RPC}"
ARENA_PROXY_ADDRESS="${ARENA_PROXY_ADDRESS:-$DEFAULT_ARENA_PROXY}"
HNADS_TOKEN_ADDRESS="${HNADS_TOKEN_ADDRESS:-$DEFAULT_HNADS_TOKEN}"
TREASURY_ADDRESS="${TREASURY_ADDRESS:-$DEFAULT_TREASURY}"

echo ""
echo -e "${BOLD}  Configuration:${NC}"
echo -e "  RPC:            ${CYAN}$MONAD_RPC_URL${NC}"
echo -e "  Arena Proxy:    ${CYAN}$ARENA_PROXY_ADDRESS${NC}"
echo -e "  HNADS Token:    ${CYAN}$HNADS_TOKEN_ADDRESS${NC}"
echo -e "  Treasury:       ${CYAN}$TREASURY_ADDRESS${NC}"
echo -e "  Dry Run:        ${CYAN}$DRY_RUN${NC}"
echo -e "  Skip Contracts: ${CYAN}$SKIP_CONTRACTS${NC}"
echo -e "  Skip Worker:    ${CYAN}$SKIP_WORKER${NC}"
echo -e "  Skip Migration: ${CYAN}$SKIP_MIGRATION${NC}"

# ─── Prerequisites Check ──────────────────────────────────────────
log_step "1" "Checking prerequisites"

check_cmd() {
  if command -v "$1" &>/dev/null; then
    log_ok "$1 found ($(command -v "$1"))"
  else
    log_err "$1 not found. Please install it first."
    exit 1
  fi
}

check_cmd forge
check_cmd cast

# wrangler may be a local node_modules binary
if command -v wrangler &>/dev/null; then
  WRANGLER="wrangler"
  log_ok "wrangler found ($(command -v wrangler))"
elif [ -x "$REPO_ROOT/node_modules/.bin/wrangler" ]; then
  WRANGLER="$REPO_ROOT/node_modules/.bin/wrangler"
  log_ok "wrangler found ($WRANGLER) [local]"
else
  log_err "wrangler not found. Run 'npm install' or install globally."
  exit 1
fi

if [ -z "${PRIVATE_KEY:-}" ]; then
  log_err "PRIVATE_KEY not set. Export it or add to .env file."
  exit 1
fi
log_ok "PRIVATE_KEY is set"

# Derive deployer address from private key
DEPLOYER_ADDRESS=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || echo "unknown")
log_info "Deployer address: $DEPLOYER_ADDRESS"

# ─── Phase 1: Run Contract Tests ──────────────────────────────────
if ! $SKIP_CONTRACTS; then
  log_step "2" "Running Foundry tests"
  cd "$CONTRACTS_DIR"
  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: forge test"
  else
    forge test --summary
    if [ $? -ne 0 ]; then
      log_err "Tests failed. Aborting deployment."
      exit 1
    fi
    log_ok "All tests pass"
  fi
  cd "$REPO_ROOT"
fi

# ─── Phase 2: D1 Migration ────────────────────────────────────────
if ! $SKIP_MIGRATION; then
  log_step "3" "Applying D1 migration (0011_lobby_tiers.sql)"
  log_info "This adds tier, hnads_fee_amount, hnads_burned, hnads_treasury, max_epochs columns to battles table"

  cd "$REPO_ROOT"
  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: $WRANGLER d1 migrations apply hungernads-db --remote"
    log_info "Migration file: src/db/migrations/0011_lobby_tiers.sql"
  else
    log_info "Applying migrations to REMOTE D1 database..."
    # Use --remote flag for production D1
    "$WRANGLER" d1 migrations apply hungernads-db --remote
    log_ok "D1 migration applied"
  fi
else
  log_step "3" "D1 migration SKIPPED (--skip-migration)"
fi

# ─── Phase 3: Upgrade Arena Contract ──────────────────────────────
if ! $SKIP_CONTRACTS; then
  log_step "4" "Upgrading HungernadsArena contract"
  log_info "Deploying new implementation with \$HNADS dual-token support"
  log_info "Arena proxy: $ARENA_PROXY_ADDRESS"

  cd "$CONTRACTS_DIR"
  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: forge script script/Upgrade.s.sol:UpgradeArena"
    log_info "  --rpc-url $MONAD_RPC_URL --broadcast --private-key [REDACTED] -vvvv"
  else
    PROXY_ADDRESS="$ARENA_PROXY_ADDRESS" forge script script/Upgrade.s.sol:UpgradeArena \
      --rpc-url "$MONAD_RPC_URL" \
      --broadcast \
      --private-key "$PRIVATE_KEY" \
      -vvvv
    log_ok "Arena contract upgraded"
  fi

  # ─── Phase 4: Configure Arena ($HNADS token + treasury) ──────────
  log_step "5" "Configuring Arena contract"

  # Check if HNADS token is already set
  CURRENT_HNADS=$(cast call "$ARENA_PROXY_ADDRESS" "hnadsToken()(address)" --rpc-url "$MONAD_RPC_URL" 2>/dev/null || echo "0x0000000000000000000000000000000000000000")
  log_info "Current HNADS token on Arena: $CURRENT_HNADS"

  ZERO_ADDR="0x0000000000000000000000000000000000000000"

  if [ "$CURRENT_HNADS" = "$ZERO_ADDR" ] || [ "$CURRENT_HNADS" = "0x0" ]; then
    log_info "Setting HNADS token to $HNADS_TOKEN_ADDRESS"
    if $DRY_RUN; then
      log_info "[DRY RUN] Would run: cast send $ARENA_PROXY_ADDRESS 'setHnadsToken(address)' $HNADS_TOKEN_ADDRESS"
    else
      cast send "$ARENA_PROXY_ADDRESS" \
        "setHnadsToken(address)" "$HNADS_TOKEN_ADDRESS" \
        --rpc-url "$MONAD_RPC_URL" \
        --private-key "$PRIVATE_KEY"
      log_ok "HNADS token set on Arena"
    fi
  else
    log_ok "HNADS token already configured: $CURRENT_HNADS"
  fi

  # Check if treasury is already set
  CURRENT_TREASURY=$(cast call "$ARENA_PROXY_ADDRESS" "treasury()(address)" --rpc-url "$MONAD_RPC_URL" 2>/dev/null || echo "$ZERO_ADDR")
  log_info "Current treasury on Arena: $CURRENT_TREASURY"

  if [ "$CURRENT_TREASURY" = "$ZERO_ADDR" ] || [ "$CURRENT_TREASURY" = "0x0" ]; then
    log_info "Setting treasury to $TREASURY_ADDRESS"
    if $DRY_RUN; then
      log_info "[DRY RUN] Would run: cast send $ARENA_PROXY_ADDRESS 'setTreasury(address)' $TREASURY_ADDRESS"
    else
      cast send "$ARENA_PROXY_ADDRESS" \
        "setTreasury(address)" "$TREASURY_ADDRESS" \
        --rpc-url "$MONAD_RPC_URL" \
        --private-key "$PRIVATE_KEY"
      log_ok "Treasury set on Arena"
    fi
  else
    log_ok "Treasury already configured: $CURRENT_TREASURY"
  fi

  cd "$REPO_ROOT"
else
  log_step "4" "Contract upgrade SKIPPED (--skip-contracts)"
  log_step "5" "Contract configuration SKIPPED (--skip-contracts)"
fi

# ─── Phase 5: Deploy Cloudflare Worker ─────────────────────────────
if ! $SKIP_WORKER; then
  log_step "6" "Deploying Cloudflare Worker"
  log_info "Worker includes tier-aware API routes and arena logic"

  cd "$REPO_ROOT"
  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: $WRANGLER deploy"
  else
    "$WRANGLER" deploy
    log_ok "Worker deployed"
  fi

  # ─── Phase 6: Set Wrangler Secrets ─────────────────────────────────
  log_step "7" "Updating Wrangler secrets"

  # Only set HNADS_TOKEN_ADDRESS if it is not already configured as a secret
  log_info "Checking if HNADS_TOKEN_ADDRESS secret needs updating..."
  if $DRY_RUN; then
    log_info "[DRY RUN] Would check/set secret: HNADS_TOKEN_ADDRESS=$HNADS_TOKEN_ADDRESS"
  else
    # Use echo to pipe the value to wrangler secret put (non-interactive)
    echo "$HNADS_TOKEN_ADDRESS" | "$WRANGLER" secret put HNADS_TOKEN_ADDRESS 2>/dev/null && \
      log_ok "HNADS_TOKEN_ADDRESS secret set" || \
      log_warn "HNADS_TOKEN_ADDRESS secret may already be set (or wrangler secret put failed)"
  fi
else
  log_step "6" "Worker deployment SKIPPED (--skip-worker)"
  log_step "7" "Wrangler secrets SKIPPED (--skip-worker)"
fi

# ─── Phase 7: Verification ────────────────────────────────────────
log_step "8" "Verification"

if ! $DRY_RUN && ! $SKIP_CONTRACTS; then
  log_info "Verifying Arena contract state..."

  # Verify HNADS token
  VERIFY_HNADS=$(cast call "$ARENA_PROXY_ADDRESS" "hnadsToken()(address)" --rpc-url "$MONAD_RPC_URL" 2>/dev/null || echo "FAILED")
  if [ "$VERIFY_HNADS" != "FAILED" ]; then
    log_ok "Arena.hnadsToken() = $VERIFY_HNADS"
  else
    log_err "Failed to read hnadsToken from Arena"
  fi

  # Verify treasury
  VERIFY_TREASURY=$(cast call "$ARENA_PROXY_ADDRESS" "treasury()(address)" --rpc-url "$MONAD_RPC_URL" 2>/dev/null || echo "FAILED")
  if [ "$VERIFY_TREASURY" != "FAILED" ]; then
    log_ok "Arena.treasury() = $VERIFY_TREASURY"
  else
    log_err "Failed to read treasury from Arena"
  fi

  # Verify oracle (should still be set correctly after upgrade)
  VERIFY_ORACLE=$(cast call "$ARENA_PROXY_ADDRESS" "oracle()(address)" --rpc-url "$MONAD_RPC_URL" 2>/dev/null || echo "FAILED")
  if [ "$VERIFY_ORACLE" != "FAILED" ]; then
    log_ok "Arena.oracle() = $VERIFY_ORACLE"
  else
    log_err "Failed to read oracle from Arena"
  fi
else
  log_info "Skipping on-chain verification (dry run or contracts skipped)"
fi

# ─── Summary ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}============================================${NC}"
echo -e "${BOLD}${GREEN}   TIER SYSTEM DEPLOYMENT COMPLETE${NC}"
echo -e "${BOLD}${GREEN}============================================${NC}"
echo ""
echo -e "  ${BOLD}Tier Configuration:${NC}"
echo -e "    FREE   - No fees, 20 epochs, practice mode"
echo -e "    BRONZE - 10 MON + 100 HNADS, 50 epochs, 80% winner share"
echo -e "    SILVER - 50 MON + 500 HNADS, 75 epochs, 80% + kill bonuses"
echo -e "    GOLD   - 100 MON + 1000 HNADS, 100 epochs, 85% + kill + survival bonuses"
echo ""
echo -e "  ${BOLD}Deployed Addresses:${NC}"
echo -e "    Arena Proxy:  ${CYAN}$ARENA_PROXY_ADDRESS${NC}"
echo -e "    HNADS Token:  ${CYAN}$HNADS_TOKEN_ADDRESS${NC}"
echo -e "    Treasury:     ${CYAN}$TREASURY_ADDRESS${NC}"
echo ""

if $DRY_RUN; then
  echo -e "  ${YELLOW}This was a DRY RUN. No changes were made.${NC}"
  echo -e "  ${YELLOW}Run without --dry-run to execute the deployment.${NC}"
  echo ""
fi

echo -e "  ${BOLD}\"May the nads be ever in your favor.\"${NC}"
echo ""
