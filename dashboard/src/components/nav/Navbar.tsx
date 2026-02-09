/**
 * HUNGERNADS - Desktop Navigation Bar
 *
 * Game-style top navigation with:
 *   - Logo + brand name (left)
 *   - Icon+label tab navigation (center)
 *   - Notification bell + TokenInfo + wallet/profile (right)
 *
 * On mobile, the tab links are hidden (BottomTabs handles navigation).
 * The logo, notification bell, and wallet button remain visible on mobile.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount, useDisconnect } from 'wagmi';
import {
  Swords,
  Coins,
  Users,
  TrendingUp,
  Bell,
  LogOut,
  History,
  Trophy,
} from 'lucide-react';
import TokenInfo from '@/components/TokenInfo';
import WalletConnect from '@/components/WalletConnect';
import BurnCounterBadge from '@/components/nav/BurnCounterBadge';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

interface NavTab {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  matchPrefixes: string[];
}

const navTabs: NavTab[] = [
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
    label: 'AGENTS',
    href: '/agents',
    icon: Users,
    matchPrefixes: ['/agents', '/agent', '/leaderboard'],
  },
  {
    label: 'TOKEN',
    href: '/token',
    icon: TrendingUp,
    matchPrefixes: ['/token'],
  },
];

function isTabActive(pathname: string, tab: NavTab): boolean {
  if (tab.href === '/' && pathname === '/') return true;
  if (tab.href === '/') return false;
  return tab.matchPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Profile Dropdown
// ---------------------------------------------------------------------------

function ProfileMenu({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { disconnect } = useDisconnect();

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-colosseum-surface-light bg-colosseum-surface px-3 py-1.5 text-xs font-mono transition-colors hover:border-gold/30 hover:bg-colosseum-surface-light"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        <span className="text-gray-300">{truncateAddress(address)}</span>
        <svg
          className={`h-3 w-3 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-lg border border-colosseum-surface-light bg-colosseum-surface shadow-xl shadow-black/40">
          {/* Header */}
          <div className="border-b border-colosseum-surface-light px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Gladiator
            </p>
            <p className="mt-0.5 font-mono text-xs text-gray-300">
              {truncateAddress(address)}
            </p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <Link
              href="/bets"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-400 transition-colors hover:bg-colosseum-surface-light hover:text-gray-200"
            >
              <History size={14} />
              My Bets
            </Link>
            <Link
              href="/leaderboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-400 transition-colors hover:bg-colosseum-surface-light hover:text-gray-200"
            >
              <Trophy size={14} />
              Leaderboard
            </Link>
          </div>

          {/* Disconnect */}
          <div className="border-t border-colosseum-surface-light py-1">
            <button
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs text-blood-light transition-colors hover:bg-blood/10"
            >
              <LogOut size={14} />
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification Bell
// ---------------------------------------------------------------------------

function NotificationBell() {
  // Placeholder: no real notification count yet
  const hasNotifications = false;

  return (
    <button
      className="relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-colosseum-surface hover:text-gray-300"
      title="Notifications"
    >
      <Bell size={18} />
      {hasNotifications && (
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-blood shadow-[0_0_6px_rgba(220,38,38,0.5)]" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Navbar
// ---------------------------------------------------------------------------

export default function Navbar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { address, isConnected } = useAccount();

  useEffect(() => setMounted(true), []);

  return (
    <nav className="sticky top-0 z-50 border-b border-colosseum-surface-light bg-colosseum-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* ── Left: Logo ── */}
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="HUNGERNADS"
            width={36}
            height={36}
            className="drop-shadow-[0_0_6px_rgba(245,158,11,0.3)]"
          />
          <span className="font-cinzel text-base font-black tracking-widest text-gold sm:text-xl">
            HUNGERNADS
          </span>
          <span className="hidden text-[10px] font-medium uppercase tracking-wider text-gold-dark/60 lg:inline">
            AI Colosseum
          </span>
        </Link>

        {/* ── Center: Tab navigation (desktop only) ── */}
        <div className="hidden items-center gap-1 md:flex">
          {navTabs.map((tab) => {
            const active = isTabActive(pathname, tab);
            const Icon = tab.icon;

            return (
              <Link
                key={tab.label}
                href={tab.href}
                className={`relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                  active
                    ? 'bg-gold/10 text-gold'
                    : 'text-gray-500 hover:bg-colosseum-surface hover:text-gray-300'
                }`}
              >
                <Icon
                  size={16}
                  className={
                    active
                      ? 'drop-shadow-[0_0_4px_rgba(245,158,11,0.3)]'
                      : ''
                  }
                />
                {tab.label}

                {/* Active indicator dot */}
                {active && (
                  <span className="absolute -bottom-[9px] left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-gold shadow-[0_0_6px_rgba(245,158,11,0.4)]" />
                )}
              </Link>
            );
          })}
        </div>

        {/* ── Right: Burn Counter + Notification + Token + Wallet/Profile ── */}
        <div className="flex items-center gap-2">
          <BurnCounterBadge />

          <NotificationBell />

          <div className="hidden border-l border-colosseum-surface-light pl-3 lg:block">
            <TokenInfo />
          </div>

          <div className="border-l border-colosseum-surface-light pl-3">
            {mounted && isConnected && address ? (
              <ProfileMenu address={address} />
            ) : (
              <WalletConnect />
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
