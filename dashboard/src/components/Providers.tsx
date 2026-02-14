/**
 * HUNGERNADS - Client-side Providers
 *
 * Wraps the app with RainbowKit (wallet UI), wagmi (wallet hooks),
 * react-query (caching), and BurnCounter (sponsorship burn tracking).
 * This is a client component because providers use React context.
 * Must be placed inside the root layout body.
 */

'use client';

import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig, queryClient, monadChain } from '@/lib/wallet';
import { BurnCounterProvider } from '@/contexts/BurnCounterContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={monadChain}
          theme={darkTheme({
            accentColor: '#f59e0b', // gold to match colosseum theme
            borderRadius: 'medium',
          })}
        >
          <BurnCounterProvider>
            {children}
          </BurnCounterProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
