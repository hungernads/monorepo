/**
 * HUNGERNADS - Mobile Bottom Tab Bar
 *
 * Game-style bottom navigation for mobile viewports.
 * Fixed to the bottom of the screen with 4 primary tabs:
 *   ARENA  - Live battles, start battle
 *   BETS   - Betting panel, history, odds
 *   AGENTS - Leaderboard, search, profiles
 *   TOKEN  - $HNADS price, buy, faucet
 *
 * Uses lucide-react icons. Active tab highlighted with gold accent.
 * Hidden on desktop (md: breakpoint and above).
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Swords, Coins, BookOpen } from 'lucide-react';

interface Tab {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  /** Match path prefixes to determine active state */
  matchPrefixes: string[];
}

const tabs: Tab[] = [
  {
    label: 'ARENA',
    href: '/',
    icon: Swords,
    matchPrefixes: ['/', '/battle'],
  },
  {
    label: 'BETS',
    href: '/bets',
    icon: Coins,
    matchPrefixes: ['/bets'],
  },
  {
    label: 'GUIDE',
    href: '/guide',
    icon: BookOpen,
    matchPrefixes: ['/guide'],
  },
];

function isTabActive(pathname: string, tab: Tab): boolean {
  // Exact match for home
  if (tab.href === '/' && pathname === '/') return true;
  if (tab.href === '/') return false;

  return tab.matchPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

export default function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-colosseum-surface-light bg-colosseum-bg/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch justify-around">
        {tabs.map((tab) => {
          const active = isTabActive(pathname, tab);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.label}
              href={tab.href}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                active
                  ? 'text-gold'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              {/* Active indicator bar */}
              {active && (
                <span className="absolute -top-px left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-gold shadow-[0_0_8px_rgba(245,158,11,0.4)]" />
              )}

              <Icon
                size={20}
                className={active ? 'drop-shadow-[0_0_4px_rgba(245,158,11,0.3)]' : ''}
              />
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  active ? 'text-gold' : ''
                }`}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
