'use client';

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      {/* Tombstone / fallen gladiator glow */}
      <div
        className="mb-6 flex h-28 w-28 items-center justify-center rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(245,158,11,0.1) 0%, transparent 70%)',
          boxShadow: '0 0 60px rgba(245,158,11,0.12), 0 0 120px rgba(245,158,11,0.05)',
        }}
      >
        <span
          className="font-cinzel text-6xl font-bold"
          style={{
            color: '#f59e0b',
            textShadow: '0 0 30px rgba(245,158,11,0.3)',
          }}
        >
          404
        </span>
      </div>

      <h1
        className="font-cinzel text-xl font-bold uppercase tracking-wider sm:text-2xl"
        style={{ color: '#f59e0b' }}
      >
        This Gladiator Has Fallen
      </h1>

      <p
        className="mt-3 max-w-md text-sm leading-relaxed sm:text-base"
        style={{ color: '#a89870' }}
      >
        The path you seek leads to an empty cell in the colosseum. This
        gladiator never existed, or has already been claimed by the arena.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/"
          className="rounded-lg bg-gradient-to-r from-gold-dark via-gold to-gold-light px-8 py-3 text-xs font-bold uppercase tracking-wider text-colosseum-bg shadow-lg transition-all hover:shadow-gold/40 active:scale-[0.97]"
          style={{
            boxShadow: '0 0 20px rgba(245,158,11,0.2)',
          }}
        >
          Return to Arena
        </Link>

        <button
          onClick={() => window.history.back()}
          className="rounded-lg border border-colosseum-surface-light bg-colosseum-surface px-8 py-3 text-xs font-bold uppercase tracking-wider text-gray-400 transition-all hover:border-gold/30 hover:text-gold active:scale-[0.97]"
        >
          Go Back
        </button>
      </div>

      {/* Decorative separator */}
      <div className="mt-10 flex items-center gap-3">
        <div className="h-px w-12 bg-colosseum-surface-light" />
        <span className="text-xs text-gray-700">R.I.P.</span>
        <div className="h-px w-12 bg-colosseum-surface-light" />
      </div>

      <p className="mt-4 text-[11px] text-gray-700">
        &quot;Not all who enter the arena find their way. Some paths were never
        meant to be walked.&quot;
      </p>
    </div>
  );
}
