'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[HUNGERNADS] Route error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      {/* Blood-red glow circle */}
      <div
        className="mb-6 flex h-24 w-24 items-center justify-center rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(220,38,38,0.15) 0%, transparent 70%)',
          boxShadow: '0 0 60px rgba(220,38,38,0.2), 0 0 120px rgba(220,38,38,0.08)',
        }}
      >
        <span className="text-5xl" style={{ color: '#dc2626' }}>
          &#x2620;
        </span>
      </div>

      <h1
        className="font-cinzel text-2xl font-bold uppercase tracking-wider sm:text-3xl"
        style={{ color: '#dc2626' }}
      >
        A Gladiator Has Fallen
      </h1>

      <p
        className="mt-3 max-w-md text-sm leading-relaxed sm:text-base"
        style={{ color: '#a89870' }}
      >
        The arena encountered an unexpected blow. The battle may continue, but
        this path has been severed.
      </p>

      {error.digest && (
        <p className="mt-2 font-mono text-xs text-gray-600">
          Error ID: {error.digest}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          onClick={reset}
          className="rounded-lg bg-gradient-to-r from-blood-dark via-blood to-blood-light px-8 py-3 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition-all hover:shadow-blood/40 active:scale-[0.97]"
          style={{
            boxShadow: '0 0 20px rgba(220,38,38,0.2)',
          }}
        >
          Rise Again
        </button>

        <Link
          href="/"
          className="rounded-lg border border-gold/30 bg-gold/5 px-8 py-3 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/10 active:scale-[0.97]"
        >
          Return to Arena
        </Link>
      </div>

      <p className="mt-10 text-[11px] text-gray-700">
        &quot;Even the mightiest gladiator stumbles.&quot;
      </p>
    </div>
  );
}
