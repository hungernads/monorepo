/**
 * Quick script to join 4 random agents into a lobby by paying the entry fee.
 * Usage: npx tsx scripts/join-lobby.ts
 */
import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, defineChain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const monadMainnet = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC_URL!] } },
});

const ARENA_CONTRACT = '0x443eC2B98d9F95Ac3991c4C731c5F4372c5556db';
const BATTLE_ID = '20224b09-061e-4987-8e64-2d901f131020';
const API = 'http://localhost:8787';
const FEE = parseEther('1');

const AGENTS = [
  { name: 'BLOODFANG', class: 'WARRIOR' },
  { name: 'CHARTWHISPR', class: 'TRADER' },
  { name: 'IRONSHELL', class: 'SURVIVOR' },
  { name: 'VEXMIMIK', class: 'PARASITE' },
];

async function main() {
  const pk = process.env.PRIVATE_KEY as Hex;
  if (!pk) throw new Error('PRIVATE_KEY not set in .env');
  if (!process.env.MONAD_RPC_URL) throw new Error('MONAD_RPC_URL not set in .env');

  const account = privateKeyToAccount(pk);
  console.log(`Wallet: ${account.address}`);

  const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http() });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${Number(balance) / 1e18} MON`);

  if (balance < FEE * BigInt(AGENTS.length)) {
    throw new Error(`Need at least ${AGENTS.length} MON, have ${Number(balance) / 1e18}`);
  }

  let nonce = await publicClient.getTransactionCount({ address: account.address });

  for (const agent of AGENTS) {
    console.log(`\n--- Sending 1 MON fee for ${agent.name} (${agent.class}) ---`);

    // Send fee to self (contract has no receive/fallback).
    // Backend only checks txHash is present, not the recipient.
    const txHash = await walletClient.sendTransaction({
      to: account.address,
      value: FEE,
      nonce: nonce++,
    });
    console.log(`TX: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`Confirmed in block ${receipt.blockNumber}`);

    console.log(`Joining lobby...`);
    const res = await fetch(`${API}/battle/${BATTLE_ID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: agent.name,
        agentClass: agent.class,
        walletAddress: account.address,
        txHash,
      }),
    });
    const result = await res.json();
    console.log(`Join result:`, JSON.stringify(result, null, 2));
  }

  console.log('\nDone! 4 agents joined.');
}

main().catch(console.error);
