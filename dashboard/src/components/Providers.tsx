/**
 * HUNGERNADS - Client-side Providers
 *
 * Wraps the app with wagmi (wallet), react-query (caching), and
 * BurnCounter (global sponsorship burn tracking) providers.
 * This is a client component because providers use React context.
 * Must be placed inside the root layout body.
 */

'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig, queryClient } from '@/lib/wallet';
import { BurnCounterProvider } from '@/contexts/BurnCounterContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BurnCounterProvider>
          {children}
        </BurnCounterProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
