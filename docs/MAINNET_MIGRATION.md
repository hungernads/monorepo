# Monad Mainnet Migration Checklist

## Deployed Mainnet Addresses (Chain 143)

```
Arena Proxy:    0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db
Arena Impl:     0x998Bbb06e6313FE48BD040B4247aeE67bD46fE52
Betting Proxy:  0x6F677989784Cc214E4Ee02257Fad3fc4374dD383
Betting Impl:   0xE61Cb4adB78f4aD4D36cf2A262532Ed3Ba9E8941
Oracle/Owner:   0x1E7EC0af660e34Aa6d5b990D8a6aFB62A3fCf801
Treasury:       0x8757F328371E571308C1271BD82B91882253FDd1
$HNADS Token:   0x553C2F72D34c9b4794A04e09C6714D47Dc257777
Chain ID:       143
Public RPC:     https://monad.drpc.org
```

---

## 1. Smart Contracts — ✅ DONE

Deployed via `forge script script/Deploy.s.sol` to Monad mainnet (chain 143).

Verify on explorer:
```bash
forge verify-contract 0x998Bbb06e6313FE48BD040B4247aeE67bD46fE52 HungernadsArena --rpc-url https://monad.drpc.org
forge verify-contract 0xE61Cb4adB78f4aD4D36cf2A262532Ed3Ba9E8941 HungernadsBetting --rpc-url https://monad.drpc.org
```

## 2. Oracle Wallet Setup — ✅ DONE

Oracle/Owner: `0x1E7EC0af660e34Aa6d5b990D8a6aFB62A3fCf801`
Treasury: `0x8757F328371E571308C1271BD82B91882253FDd1`

- [x] Fund oracle wallet with MON for gas

## 3. Configure Arena Contract

```bash
# Set $HNADS token on Arena
cast send 0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db \
  "setHnadsToken(address)" 0x553C2F72D34c9b4794A04e09C6714D47Dc257777 \
  --rpc-url https://monad.drpc.org --private-key $PRIVATE_KEY

# Set treasury on Arena
cast send 0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db \
  "setTreasury(address)" 0x8757F328371E571308C1271BD82B91882253FDd1 \
  --rpc-url https://monad.drpc.org --private-key $PRIVATE_KEY
```

- [ ] `setHnadsToken()` called on Arena
- [ ] `setTreasury()` called on Arena

## 4. Wrangler Secrets

```bash
echo "https://monad-mainnet.g.alchemy.com/v2/<YOUR_KEY>" | npx wrangler secret put MONAD_RPC_URL
echo "<oracle-private-key>" | npx wrangler secret put PRIVATE_KEY
echo "0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db" | npx wrangler secret put ARENA_CONTRACT_ADDRESS
echo "0x6F677989784Cc214E4Ee02257Fad3fc4374dD383" | npx wrangler secret put BETTING_CONTRACT_ADDRESS
echo "0x553C2F72D34c9b4794A04e09C6714D47Dc257777" | npx wrangler secret put HNADS_TOKEN_ADDRESS
```

- [ ] All secrets updated

## 5. Backend Code Changes — ✅ DONE

- [x] `src/chain/client.ts` — mainnet chain definition (id: 143), auto-detects from RPC URL
- [x] Skills use public RPC (`https://monad.drpc.org`) with `MONAD_RPC_URL` env override

## 6. Dashboard Changes — ✅ DONE

- [x] `dashboard/.env.local` — all contract addresses updated
- [x] `dashboard/src/lib/wallet.ts` — chain ID 143
- [x] `dashboard/src/app/guide/page.tsx` — addresses + chain text

## 7. Skills — ✅ DONE

All skills updated with:
- Public RPC default (`https://monad.drpc.org`) instead of exposed Alchemy key
- `${RPC_URL}` variable in all `cast` commands
- Correct mainnet contract addresses

## 8. Documentation — ✅ DONE

- [x] `CLAUDE.md` — mainnet addresses, chain 143, $HNADS token marked launched
- [x] Skills files — addresses + RPC updated

## 9. Deploy

```bash
# Deploy worker
npx wrangler deploy

# Deploy dashboard (Vercel)
cd dashboard && npm run build
```

- [ ] Worker deployed with mainnet secrets
- [ ] Dashboard deployed with mainnet env vars

## 10. Post-Deploy Verification

- [ ] Create FREE lobby → verify on dashboard
- [ ] Create paid lobby → verify on-chain registration (`cast call`)
- [ ] Join with agent → `payEntryFee` succeeds
- [ ] Join with $HNADS → `depositHnadsFee` succeeds
- [ ] 5+ agents → countdown triggers
- [ ] Battle completes → `distributePrize` works
- [ ] Betting: place bet → settle → payout
- [ ] Skills: `/hnads-compete` full flow works
- [ ] WebSocket live updates work

## Previous Testnet Addresses (for reference)

```
Arena Proxy:     0x45B9151BD350F26eE0ad44395B5555cbA5364DC8
Betting Proxy:   0xEfA79f90A2a9400A32De384b742d22524c4A69d5
Arena Impl:      0x6811b65C31325D0abC0B59aD9be0D8ADd8299dCF
Betting Impl:    0x36Cd512c939af6a9340bC826c70af947a7c86845
Oracle/Treasury: 0x77C037fbF42e85dB1487B390b08f58C00f438812
$HNADS Token:    0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777
Chain ID:        10143
RPC:             https://testnet-rpc.monad.xyz
```
