/**
 * HUNGERNADS - Token Page
 *
 * Dashboard for $HNADS token with:
 *   - Token hero: price, graduation progress, 24h stats
 *   - Buy CTA linking to nad.fun
 *   - Burn counter: total HNADS burned from sponsorships
 *   - Faucet: 3-tier claim system with eligibility status
 *   - Token utility explainer cards
 *   - Token distribution breakdown
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import Link from 'next/link';
import {
  Flame,
  Droplets,
  TrendingUp,
  ExternalLink,
  Coins,
  Heart,
  Trophy,
  Gift,
  ShieldCheck,
  Lock,
  Check,
  Clock,
  AlertCircle,
} from 'lucide-react';
import useTokenPrice from '@/hooks/useTokenPrice';
import { useFetch } from '@/hooks/useFetch';
import { HNADS_TOKEN_ADDRESS } from '@/lib/wallet';
import { ConnectButton } from '@rainbow-me/rainbowkit';

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface TokenStatsResponse {
  burned: {
    totalAmount: number;
    totalSponsorships: number;
  };
  faucet: {
    totalDistributed: number;
    totalClaims: number;
  };
}

interface FaucetTierStatus {
  tier: number;
  label: string;
  amount: number;
  eligible: boolean;
  nextClaimAt: string | null;
  requirementsMet: boolean;
  requirements: {
    betsNeeded?: number;
    betsPlaced?: number;
    sponsorsNeeded?: number;
    sponsorsPlaced?: number;
  } | null;
}

interface FaucetStatusResponse {
  walletAddress: string;
  tiers: FaucetTierStatus[];
  totalClaimable: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

const NADFUN_BASE_URL = 'https://testnet.nad.fun/token';

/** When set, enables the "Buy $HNADS on nad.fun" CTA across the page. */
const NADFUN_TOKEN_URL = process.env.NEXT_PUBLIC_NADFUN_TOKEN_URL ?? '';

const TIER_ICONS: Record<number, React.ComponentType<{ className?: string; size?: number }>> = {
  1: Droplets,
  2: Coins,
  3: Trophy,
};

const TIER_COLORS: Record<number, { border: string; bg: string; text: string; glow: string }> = {
  1: {
    border: 'border-gray-500/30',
    bg: 'bg-gray-500/10',
    text: 'text-gray-400',
    glow: '',
  },
  2: {
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    glow: 'shadow-[0_0_12px_rgba(59,130,246,0.15)]',
  },
  3: {
    border: 'border-gold/30',
    bg: 'bg-gold/10',
    text: 'text-gold',
    glow: 'shadow-[0_0_12px_rgba(245,158,11,0.15)]',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(price: number): string {
  if (price < 0.000001) return '<0.000001';
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function timeUntil(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function TokenHero({
  pricePerToken,
  tokensPerMon,
  graduated,
  graduationPercent,
  loading,
}: {
  pricePerToken: number | null;
  tokensPerMon: number | null;
  graduated: boolean | null;
  graduationPercent: number | null;
  loading: boolean;
}) {
  const tokenAddress = HNADS_TOKEN_ADDRESS;
  const isConfigured =
    tokenAddress !== '0x0000000000000000000000000000000000000000';

  return (
    <section className="relative flex flex-col items-center py-8 text-center sm:py-12">
      {/* Glow */}
      <div className="absolute top-4 h-32 w-64 rounded-full bg-gold/20 blur-3xl sm:w-96" />

      {/* Token badge */}
      <div className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-full border-2 border-gold/40 bg-colosseum-surface shadow-[0_0_30px_rgba(245,158,11,0.2)]">
        <span className="font-cinzel text-2xl font-black text-gold">$H</span>
      </div>

      <h1 className="font-cinzel relative mb-1 text-3xl font-black uppercase tracking-widest text-gold drop-shadow-[0_0_30px_rgba(245,158,11,0.5)] sm:text-4xl">
        $HNADS
      </h1>
      <p className="mb-4 text-sm text-gray-500">
        The blood currency of the Colosseum
      </p>

      {/* Price */}
      {loading ? (
        <div className="h-8 w-40 animate-pulse rounded bg-colosseum-surface-light" />
      ) : pricePerToken !== null ? (
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">
              {formatPrice(pricePerToken)}
            </span>
            <span className="text-sm text-gray-500">MON / HNADS</span>
          </div>
          {tokensPerMon !== null && (
            <span className="text-xs text-gray-600">
              1 MON = {formatNumber(tokensPerMon)} HNADS
            </span>
          )}
        </div>
      ) : (
        <span className="text-sm text-gray-600">Price unavailable</span>
      )}

      {/* Graduation progress */}
      {graduated === false && graduationPercent !== null && (
        <div className="mt-4 w-full max-w-xs">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-500">
            <span>Bonding Curve</span>
            <span>{graduationPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-colosseum-surface-light">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-dark to-gold transition-all duration-700"
              style={{ width: `${Math.min(graduationPercent, 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-gray-600">
            Graduates to DEX at 100%
          </p>
        </div>
      )}

      {graduated === true && (
        <div className="mt-3 flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1">
          <Check size={12} className="text-green-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-green-400">
            Graduated to DEX
          </span>
        </div>
      )}

      {/* Buy CTA — prefer explicit env URL, fall back to constructed URL */}
      {(NADFUN_TOKEN_URL || isConfigured) && (
        <a
          href={NADFUN_TOKEN_URL || `${NADFUN_BASE_URL}/${tokenAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-8 py-3 text-sm font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] active:scale-[0.98]"
        >
          Buy $HNADS on nad.fun
          <ExternalLink size={14} />
        </a>
      )}
    </section>
  );
}

function BurnCounter({
  totalBurned,
  totalSponsorships,
  loading,
}: {
  totalBurned: number;
  totalSponsorships: number;
  loading: boolean;
}) {
  return (
    <div className="card relative overflow-hidden">
      {/* Background fire glow */}
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-blood/10 blur-2xl" />

      <div className="mb-3 flex items-center gap-2">
        <Flame size={18} className="text-blood" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">
          Burn Counter
        </h2>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-10 w-48 animate-pulse rounded bg-colosseum-surface-light" />
          <div className="h-4 w-32 animate-pulse rounded bg-colosseum-surface-light" />
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums text-blood-light">
              {formatNumber(totalBurned)}
            </span>
            <span className="text-sm text-gray-500">$HNADS burned</span>
          </div>
          <p className="mt-1 text-xs text-gray-600">
            From {totalSponsorships.toLocaleString()} sponsorship
            {totalSponsorships !== 1 ? 's' : ''} — sent to 0xdEaD
          </p>
          <p className="mt-3 text-[10px] text-gray-700">
            Every sponsorship burns tokens permanently. The more the crowd
            supports gladiators, the scarcer $HNADS becomes.
          </p>
        </>
      )}
    </div>
  );
}

function FaucetSection({
  address,
  isConnected,
}: {
  address: string | undefined;
  isConnected: boolean;
}) {
  const {
    data: faucetStatus,
    loading: statusLoading,
    refetch: refetchStatus,
  } = useFetch<FaucetStatusResponse>(
    `/faucet/status/${address}`,
    { skip: !isConnected || !address },
  );

  const [claimingTier, setClaimingTier] = useState<number | null>(null);
  const [claimResult, setClaimResult] = useState<{
    tier: number;
    ok: boolean;
    message: string;
  } | null>(null);

  const handleClaim = useCallback(
    async (tier: number) => {
      if (!address || claimingTier !== null) return;

      setClaimingTier(tier);
      setClaimResult(null);

      try {
        const res = await fetch(`${API_BASE}/faucet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: address, tier }),
        });

        const data = await res.json();

        if (res.ok) {
          setClaimResult({
            tier,
            ok: true,
            message: `Claimed ${(data as { claim: { amount: number } }).claim.amount} $HNADS!`,
          });
          refetchStatus();
        } else {
          setClaimResult({
            tier,
            ok: false,
            message: (data as { error: string }).error ?? 'Claim failed',
          });
        }
      } catch {
        setClaimResult({
          tier,
          ok: false,
          message: 'Network error. Try again.',
        });
      } finally {
        setClaimingTier(null);
      }
    },
    [address, claimingTier, refetchStatus],
  );

  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-2">
        <Droplets size={18} className="text-blue-400" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">
          Faucet
        </h2>
        <span className="ml-auto text-[10px] text-gray-600">
          Claim free $HNADS daily
        </span>
      </div>

      {!isConnected ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <Lock size={24} className="text-gray-600" />
          <p className="text-sm text-gray-500">
            Connect your wallet to claim tokens
          </p>
          <ConnectButton />
        </div>
      ) : statusLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg bg-colosseum-surface-light/50"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(faucetStatus?.tiers ?? []).map((tier) => {
            const Icon = TIER_ICONS[tier.tier] ?? Droplets;
            const colors = TIER_COLORS[tier.tier] ?? TIER_COLORS[1];
            const isClaimable = tier.eligible && tier.requirementsMet;

            return (
              <div
                key={tier.tier}
                className={`rounded-lg border ${colors.border} ${colors.bg} p-4 ${colors.glow}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Icon size={16} className={colors.text} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${colors.text}`}>
                          Tier {tier.tier}: {tier.label}
                        </span>
                        <span className="rounded bg-colosseum-surface px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-gray-400">
                          {tier.amount} HNADS
                        </span>
                      </div>
                      {/* Requirements */}
                      {tier.requirements && (
                        <div className="mt-1 text-[10px] text-gray-600">
                          {tier.requirements.betsNeeded != null && (
                            <span
                              className={
                                tier.requirementsMet
                                  ? 'text-green-500'
                                  : 'text-gray-500'
                              }
                            >
                              {tier.requirementsMet ? (
                                <Check
                                  size={10}
                                  className="mr-0.5 inline"
                                />
                              ) : null}
                              {tier.requirements.betsPlaced}/
                              {tier.requirements.betsNeeded} bets placed
                            </span>
                          )}
                          {tier.requirements.sponsorsNeeded != null && (
                            <span
                              className={
                                tier.requirementsMet
                                  ? 'text-green-500'
                                  : 'text-gray-500'
                              }
                            >
                              {tier.requirementsMet ? (
                                <Check
                                  size={10}
                                  className="mr-0.5 inline"
                                />
                              ) : null}
                              {tier.requirements.sponsorsPlaced}/
                              {tier.requirements.sponsorsNeeded} sponsorships
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Claim button */}
                  <button
                    onClick={() => handleClaim(tier.tier)}
                    disabled={!isClaimable || claimingTier !== null}
                    className={`rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                      isClaimable
                        ? `border ${colors.border} ${colors.text} hover:bg-white/5 active:scale-[0.97]`
                        : 'cursor-not-allowed text-gray-600'
                    }`}
                  >
                    {claimingTier === tier.tier
                      ? 'Claiming...'
                      : isClaimable
                        ? 'Claim'
                        : !tier.requirementsMet
                          ? 'Locked'
                          : 'Cooldown'}
                  </button>
                </div>

                {/* Cooldown timer */}
                {!tier.eligible && tier.requirementsMet && tier.nextClaimAt && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-600">
                    <Clock size={10} />
                    <span>Next claim in {timeUntil(tier.nextClaimAt)}</span>
                  </div>
                )}

                {/* Claim result message */}
                {claimResult && claimResult.tier === tier.tier && (
                  <div
                    className={`mt-2 flex items-center gap-1 text-xs ${
                      claimResult.ok ? 'text-green-400' : 'text-blood-light'
                    }`}
                  >
                    {claimResult.ok ? (
                      <Check size={12} />
                    ) : (
                      <AlertCircle size={12} />
                    )}
                    <span>{claimResult.message}</span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Total claimable summary */}
          {faucetStatus && faucetStatus.totalClaimable > 0 && (
            <p className="text-center text-xs text-green-400">
              {faucetStatus.totalClaimable} $HNADS available to claim now
            </p>
          )}

          {/* Buy more CTA — only when nad.fun token URL is configured */}
          {NADFUN_TOKEN_URL && (
            <div className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-center">
              <p className="mb-2 text-xs text-gray-500">
                Want more $HNADS? Skip the cooldown.
              </p>
              <a
                href={NADFUN_TOKEN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 hover:shadow-[0_0_16px_rgba(245,158,11,0.15)] active:scale-[0.98]"
              >
                Buy $HNADS on nad.fun
                <ExternalLink size={12} />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TokenUtility() {
  const utilities = [
    {
      icon: Coins,
      title: 'Betting',
      description:
        'Wager $HNADS on gladiator battles. Pick winners, study agent learning patterns, and profit from your knowledge.',
      color: 'text-gold',
    },
    {
      icon: Heart,
      title: 'Sponsorships',
      description:
        'Send supplies to your favorite gladiator mid-battle. All sponsorship tokens are burned permanently.',
      color: 'text-blood-light',
    },
    {
      icon: Flame,
      title: 'Burns',
      description:
        'Every sponsorship burns tokens via 0xdEaD. More drama in the arena = more tokens removed forever.',
      color: 'text-orange-400',
    },
    {
      icon: ShieldCheck,
      title: 'Governance (Future)',
      description:
        'Vote on arena rules, new agent classes, and tournament formats. The crowd shapes the Colosseum.',
      color: 'text-accent-light',
    },
  ];

  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-2">
        <Gift size={18} className="text-gold" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">
          Token Utility
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {utilities.map((util) => {
          const Icon = util.icon;
          return (
            <div
              key={util.title}
              className="rounded-lg border border-colosseum-surface-light bg-colosseum-bg p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <Icon size={16} className={util.color} />
                <span className="text-sm font-bold text-gray-300">
                  {util.title}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-gray-500">
                {util.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TokenDistribution() {
  const segments = [
    { label: 'Bonding Curve', pct: 80, color: 'bg-gold' },
    { label: 'Treasury', pct: 10, color: 'bg-accent' },
    { label: 'Team', pct: 5, color: 'bg-blue-500' },
    { label: 'Faucet Pool', pct: 5, color: 'bg-green-500' },
  ];

  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp size={18} className="text-gray-400" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">
          Token Distribution
        </h2>
      </div>

      {/* Bar */}
      <div className="mb-4 flex h-3 overflow-hidden rounded-full">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={`${seg.color} transition-all duration-500`}
            style={{ width: `${seg.pct}%` }}
            title={`${seg.label}: ${seg.pct}%`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${seg.color}`} />
            <span className="text-[10px] text-gray-500">{seg.label}</span>
            <span className="text-[10px] font-bold tabular-nums text-gray-400">
              {seg.pct}%
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[10px] leading-relaxed text-gray-600">
        $HNADS launched on nad.fun with 80% allocated to the bonding curve for
        fair price discovery. As the token graduates to the DEX, liquidity is
        permanently locked. Sponsorship burns are deflationary by design.
      </p>
    </div>
  );
}

function FaucetStats({
  totalDistributed,
  totalClaims,
  loading,
}: {
  totalDistributed: number;
  totalClaims: number;
  loading: boolean;
}) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <Droplets size={18} className="text-blue-400" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">
          Faucet Stats
        </h2>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-8 w-32 animate-pulse rounded bg-colosseum-surface-light" />
          <div className="h-4 w-24 animate-pulse rounded bg-colosseum-surface-light" />
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-blue-400">
              {formatNumber(totalDistributed)}
            </span>
            <span className="text-sm text-gray-500">$HNADS distributed</span>
          </div>
          <p className="mt-1 text-xs text-gray-600">
            Across {totalClaims.toLocaleString()} faucet claim
            {totalClaims !== 1 ? 's' : ''}
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TokenPage() {
  const [mounted, setMounted] = useState(false);
  const { address, isConnected } = useAccount();

  useEffect(() => setMounted(true), []);

  const {
    pricePerToken,
    tokensPerMon,
    graduated,
    graduationPercent,
    loading: priceLoading,
  } = useTokenPrice();

  const {
    data: statsData,
    loading: statsLoading,
  } = useFetch<TokenStatsResponse>('/token/stats', { pollInterval: 60_000 });

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2 flex items-center gap-3">
        <Link
          href="/"
          className="text-xs text-gray-600 transition-colors hover:text-gold"
        >
          Home
        </Link>
        <span className="text-xs text-gray-700">/</span>
        <span className="text-xs text-gray-400">Token</span>
      </div>

      {/* Hero */}
      <TokenHero
        pricePerToken={pricePerToken}
        tokensPerMon={tokensPerMon}
        graduated={graduated}
        graduationPercent={graduationPercent}
        loading={priceLoading}
      />

      {/* Main grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column: Burn + Faucet Stats */}
        <div className="space-y-6">
          <BurnCounter
            totalBurned={statsData?.burned.totalAmount ?? 0}
            totalSponsorships={statsData?.burned.totalSponsorships ?? 0}
            loading={statsLoading}
          />
          <FaucetStats
            totalDistributed={statsData?.faucet.totalDistributed ?? 0}
            totalClaims={statsData?.faucet.totalClaims ?? 0}
            loading={statsLoading}
          />
          <TokenDistribution />
        </div>

        {/* Right column: Faucet + Utility */}
        <div className="space-y-6">
          {mounted && (
            <FaucetSection
              address={address}
              isConnected={isConnected}
            />
          )}
          <TokenUtility />
        </div>
      </div>

      {/* Contract info footer */}
      <div className="mt-8 rounded-lg border border-colosseum-surface-light bg-colosseum-surface p-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          Contract Info
        </h3>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Token Address</span>
            <a
              href={`https://testnet.monadexplorer.com/address/${HNADS_TOKEN_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mono text-gray-400 transition-colors hover:text-gold"
            >
              {HNADS_TOKEN_ADDRESS.slice(0, 6)}...{HNADS_TOKEN_ADDRESS.slice(-4)}
              <ExternalLink size={10} />
            </a>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Network</span>
            <span className="text-gray-400">Monad Testnet (Chain ID: 10143)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Standard</span>
            <span className="text-gray-400">ERC-20</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Launch Platform</span>
            <a
              href="https://testnet.nad.fun"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-gray-400 transition-colors hover:text-gold"
            >
              nad.fun
              <ExternalLink size={10} />
            </a>
          </div>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-gray-700">
        <p>All sponsorship tokens are burned permanently via 0xdEaD.</p>
        <p className="mt-1">May the nads be ever in your favor.</p>
      </div>
    </div>
  );
}
