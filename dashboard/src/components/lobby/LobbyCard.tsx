import Link from 'next/link';

export interface LobbyData {
  battleId: string;
  status: 'LOBBY' | 'COUNTDOWN';
  playerCount: number;
  maxPlayers: number;
  countdownEndsAt?: string;
  createdAt: string;
  feeAmount?: string;
  /** Lobby tier: FREE, BRONZE, SILVER, or GOLD. */
  tier?: string;
  /** $HNADS entry fee for this tier. */
  hnadsFee?: string;
  /** Max epochs allowed for this tier. */
  maxEpochs?: number;
}

// ─── Tier Display Config ──────────────────────────────────────────────

type LobbyTier = 'FREE' | 'IRON' | 'BRONZE' | 'SILVER' | 'GOLD';

const TIER_COLORS: Record<LobbyTier, string> = {
  FREE: '#6b7280',
  IRON: '#8b8b8b',
  BRONZE: '#cd7f32',
  SILVER: '#c0c0c0',
  GOLD: '#f59e0b',
};

const TIER_LABELS: Record<LobbyTier, string> = {
  FREE: 'Free',
  IRON: 'Iron',
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
};

/** Winner share per tier (mirrors backend tiers.ts). */
const TIER_WINNER_SHARE: Record<LobbyTier, number> = {
  FREE: 0,
  IRON: 0.8,
  BRONZE: 0.8,
  SILVER: 0.8,
  GOLD: 0.85,
};

function formatCountdown(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return '0:00';
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Estimate the winner's MON payout for this lobby. */
function estimatePrizePool(
  tier: LobbyTier,
  monFee: string,
  maxPlayers: number,
): string {
  const fee = parseFloat(monFee);
  if (!fee || fee === 0) return '0';
  const totalPool = fee * maxPlayers;
  const winnerPayout = totalPool * (TIER_WINNER_SHARE[tier] ?? 0.8);
  // Format: remove trailing zeros
  return winnerPayout % 1 === 0
    ? winnerPayout.toFixed(0)
    : winnerPayout.toFixed(1);
}

export default function LobbyCard({ lobby }: { lobby: LobbyData }) {
  const { battleId, status, playerCount, maxPlayers, countdownEndsAt, feeAmount, tier: rawTier, hnadsFee } = lobby;
  const isFull = playerCount >= maxPlayers;
  const fillPercent = Math.min(100, (playerCount / maxPlayers) * 100);
  const tier = (rawTier as LobbyTier) ?? 'FREE';
  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS.FREE;
  const tierLabel = TIER_LABELS[tier] ?? 'Free';
  const hasFee = feeAmount && feeAmount !== '0';
  const hasHnadsFee = hnadsFee && hnadsFee !== '0';
  const prizeEstimate = hasFee ? estimatePrizePool(tier, feeAmount!, maxPlayers) : '0';

  return (
    <div className="card group relative border-gold/20 transition-colors hover:border-gold/50">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Tier Badge */}
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
            style={{ backgroundColor: `${tierColor}20`, color: tierColor }}
          >
            {tierLabel}
          </span>
          <span className="text-sm font-bold text-gray-200">
            #{battleId.slice(0, 8)}
          </span>
          {status === 'COUNTDOWN' ? (
            <span className="rounded bg-blood/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-blood">
              Starting
            </span>
          ) : (
            <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-gold">
              Open
            </span>
          )}
        </div>
      </div>

      {/* Dual Fees */}
      {(hasFee || hasHnadsFee) && (
        <div className="mb-2 flex items-center gap-3 text-[11px]">
          {hasFee && (
            <span className="text-gray-400">
              <span className="font-bold text-gray-200">{feeAmount}</span> MON
            </span>
          )}
          {hasHnadsFee && (
            <span className="text-gray-400">
              <span className="font-bold text-gray-200">{hnadsFee}</span> $HNADS
            </span>
          )}
          {prizeEstimate !== '0' && (
            <span className="ml-auto text-[10px]" style={{ color: tierColor }}>
              ~{prizeEstimate} MON prize
            </span>
          )}
        </div>
      )}

      {/* Player count bar */}
      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">
            {playerCount}/{maxPlayers} gladiators
          </span>
          {isFull && (
            <span className="rounded bg-blood/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-blood">
              Full
            </span>
          )}
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-colosseum-surface-light">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${fillPercent}%`, backgroundColor: tierColor }}
          />
        </div>
      </div>

      {/* Status / Countdown */}
      <div className="mb-3 text-xs">
        {status === 'COUNTDOWN' && countdownEndsAt ? (
          <span className="font-bold text-blood-light">
            Battle starts in {formatCountdown(countdownEndsAt)}
          </span>
        ) : (
          <span className="text-gray-500">
            Waiting for gladiators...
          </span>
        )}
      </div>

      {/* Action */}
      <div className="flex items-center justify-end">
        <Link
          href={`/lobby/${battleId}`}
          className={`rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
            isFull
              ? 'cursor-not-allowed border border-colosseum-surface-light bg-colosseum-surface-light text-gray-600'
              : 'border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 active:scale-[0.97]'
          }`}
          aria-disabled={isFull}
          tabIndex={isFull ? -1 : undefined}
          onClick={isFull ? (e) => e.preventDefault() : undefined}
        >
          {isFull ? 'Full' : 'Join Battle'}
        </Link>
      </div>
    </div>
  );
}
