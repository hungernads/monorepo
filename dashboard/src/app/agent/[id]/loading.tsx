export default function AgentProfileLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Stats Header skeleton */}
      <div className="card">
        {/* Name and class */}
        <div className="mb-6 flex items-center gap-4">
          <div className="h-14 w-14 rounded-lg bg-colosseum-surface-light" />
          <div>
            <div className="h-7 w-48 rounded bg-colosseum-surface-light" />
            <div className="mt-2 h-4 w-20 rounded bg-colosseum-surface-light/50" />
          </div>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-md bg-colosseum-bg px-3 py-2">
              <div className="h-2.5 w-16 rounded bg-colosseum-surface-light/40" />
              <div className="mt-2 h-6 w-20 rounded bg-colosseum-surface-light/60" />
            </div>
          ))}
        </div>
      </div>

      {/* Lessons section skeleton */}
      <div className="card">
        <div className="mb-1 flex items-center justify-between">
          <div className="h-4 w-32 rounded bg-colosseum-surface-light" />
          <div className="h-3 w-20 rounded bg-colosseum-surface-light/40" />
        </div>
        <div className="mb-4 h-3 w-64 rounded bg-colosseum-surface-light/30" />

        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-colosseum-surface-light bg-colosseum-bg p-4"
            >
              {/* Lesson header */}
              <div className="mb-3 flex items-center justify-between">
                <div className="h-2.5 w-16 rounded bg-colosseum-surface-light/40" />
                <div className="h-2.5 w-20 rounded bg-colosseum-surface-light/30" />
              </div>
              {/* Context */}
              <div className="mb-2">
                <div className="h-2.5 w-12 rounded bg-colosseum-surface-light/40" />
                <div className="mt-1.5 h-4 w-full rounded bg-colosseum-surface-light/30" />
              </div>
              {/* Outcome */}
              <div className="mb-2">
                <div className="h-2.5 w-14 rounded bg-colosseum-surface-light/40" />
                <div className="mt-1.5 h-4 w-3/4 rounded bg-colosseum-surface-light/30" />
              </div>
              {/* Learning */}
              <div className="rounded-md border border-colosseum-surface-light/20 bg-colosseum-surface-light/5 px-3 py-2">
                <div className="h-2.5 w-14 rounded bg-colosseum-surface-light/40" />
                <div className="mt-1.5 h-4 w-5/6 rounded bg-colosseum-surface-light/30" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Matchups + Death Causes skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Matchup chart skeleton */}
        <div className="card">
          <div className="mb-4 h-4 w-36 rounded bg-colosseum-surface-light" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 w-20 rounded bg-colosseum-surface-light/40" />
                <div className="h-4 flex-1 rounded bg-colosseum-surface-light/20" />
                <div className="h-4 w-12 rounded bg-colosseum-surface-light/30" />
              </div>
            ))}
          </div>
        </div>

        {/* Death causes skeleton */}
        <div className="card">
          <div className="mb-4 h-4 w-28 rounded bg-colosseum-surface-light" />
          <div className="flex items-center justify-center py-8">
            <div className="h-32 w-32 rounded-full bg-colosseum-surface-light/20" />
          </div>
        </div>
      </div>
    </div>
  );
}
