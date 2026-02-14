/**
 * HUNGERNADS - Wallet Configuration
 *
 * Wagmi + viem configuration for connecting to Monad.
 * Set NEXT_PUBLIC_CHAIN=mainnet to switch to Monad mainnet.
 * Supports injected wallets (MetaMask, etc.) and WalletConnect.
 *
 * Usage:
 *   Import `wagmiConfig` and wrap the app with WagmiProvider + QueryClientProvider.
 */

import { http } from 'wagmi';
import { getDefaultConfig, type Chain } from '@rainbow-me/rainbowkit';
import { QueryClient } from '@tanstack/react-query';

// ─── Chain Definitions ─────────────────────────────────────────────

const monadTestnet: Chain = {
  id: 10143,
  name: 'Monad Testnet',
  iconUrl: '/monad-icon.png',
  iconBackground: '#836EF9',
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC ?? 'https://testnet-rpc.monad.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: 'https://testnet.monadexplorer.com',
    },
  },
  testnet: true,
};

const monadMainnet: Chain = {
  id: 10143, // TODO: update when Monad mainnet launches
  name: 'Monad',
  iconUrl: '/monad-icon.png',
  iconBackground: '#836EF9',
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MONAD_MAINNET_RPC ?? 'https://rpc.monad.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: 'https://monadexplorer.com',
    },
  },
  testnet: false,
};

// ─── Active Chain (env-driven) ─────────────────────────────────────

const isMainnet = process.env.NEXT_PUBLIC_CHAIN === 'mainnet';

/** The active Monad chain. All components should use this. */
export const monadChain: Chain = isMainnet ? monadMainnet : monadTestnet;

// ─── Wagmi + RainbowKit Config ──────────────────────────────────────

export const wagmiConfig = getDefaultConfig({
  appName: 'HUNGERNADS',
  // WalletConnect projectId — get one free at https://cloud.walletconnect.com
  // Injected wallets (MetaMask) work without it; WalletConnect QR requires it.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'hungernads-dev',
  chains: [monadChain],
  transports: {
    [monadChain.id]: http(monadChain.rpcUrls.default.http[0]),
  },
});

// ─── React Query Client ─────────────────────────────────────────────

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 2,
    },
  },
});

// ─── Contract Addresses ─────────────────────────────────────────────
// Pulled from environment variables at build time.
// In Next.js, only NEXT_PUBLIC_ prefixed vars are exposed to the client.

export const ARENA_ADDRESS =
  (process.env.NEXT_PUBLIC_ARENA_CONTRACT_ADDRESS as `0x${string}`) ??
  '0x0000000000000000000000000000000000000000';

export const BETTING_ADDRESS =
  (process.env.NEXT_PUBLIC_BETTING_CONTRACT_ADDRESS as `0x${string}`) ??
  '0x0000000000000000000000000000000000000000';

export const HNADS_TOKEN_ADDRESS =
  (process.env.NEXT_PUBLIC_HNADS_TOKEN_ADDRESS as `0x${string}`) ??
  '0x0000000000000000000000000000000000000000';

export const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? 'wss://hungernads.amr-robb.workers.dev';
