import Link from 'next/link';

export interface LobbyData {
  battleId: string;
  status: 'LOBBY' | 'COUNTDOWN';
  playerCount: number;
  maxPlayers: number;
  countdownEndsAt?: string;
  createdAt: string;
  feeAmount?: string;
}

function formatCountdown(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return '0:00';
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function LobbyCard({ lobby }: { lobby: LobbyData }) {
  const { battleId, status, playerCount, maxPlayers, countdownEndsAt, feeAmount } = lobby;
  const isFull = playerCount >= maxPlayers;
  const fillPercent = Math.min(100, (playerCount / maxPlayers) * 100);

  return (
    <div className="card group relative border-gold/20 transition-colors hover:border-gold/50">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-200">
            ARENA #{battleId.slice(0, 8)}
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
        {feeAmount && feeAmount !== '0' && (
          <span className="text-xs text-gold">
            Fee: {feeAmount} MON
          </span>
        )}
      </div>

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
            className="h-full rounded-full bg-gold transition-all duration-500"
            style={{ width: `${fillPercent}%` }}
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
