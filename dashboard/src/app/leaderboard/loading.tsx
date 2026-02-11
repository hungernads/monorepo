export default function LeaderboardLoading() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-3">
          <div className="h-3 w-10 rounded bg-colosseum-surface-light/40" />
          <div className="h-3 w-2 rounded bg-colosseum-surface-light/20" />
          <div className="h-3 w-20 rounded bg-colosseum-surface-light/40" />
        </div>
        <div className="h-9 w-52 rounded bg-colosseum-surface-light" />
        <div className="mt-2 h-4 w-80 rounded bg-colosseum-surface-light/30" />
      </div>

      {/* Season selector placeholder */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-8 w-24 rounded-lg bg-colosseum-surface-light/30"
            />
          ))}
        </div>
      </div>

      {/* Table card */}
      <div className="card">
        {/* Tabs */}
        <div className="mb-4 flex items-center gap-1 border-b border-colosseum-surface-light">
          <div className="h-5 w-24 rounded bg-colosseum-surface-light/50 px-4 py-3" />
          <div className="h-5 w-20 rounded bg-colosseum-surface-light/30 px-4 py-3" />
        </div>

        {/* Filters placeholder */}
        <div className="mb-4 flex items-center gap-3">
          <div className="h-8 w-48 rounded-lg bg-colosseum-surface-light/20" />
          <div className="h-8 w-28 rounded-lg bg-colosseum-surface-light/20" />
          <div className="h-8 w-28 rounded-lg bg-colosseum-surface-light/20" />
        </div>

        {/* Skeleton rows */}
        <div className="space-y-1.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded border border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-2.5"
            >
              <div className="h-4 w-7 rounded bg-colosseum-surface-light" />
              <div className="h-4 w-6 rounded bg-colosseum-surface-light" />
              <div className="h-4 flex-1 rounded bg-colosseum-surface-light/50" />
              <div className="hidden h-4 w-28 rounded bg-colosseum-surface-light/30 sm:block" />
              <div className="hidden h-8 w-36 rounded bg-colosseum-surface-light/20 md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
