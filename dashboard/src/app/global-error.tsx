'use client';

/**
 * Root-level error boundary. This catches errors in the root layout itself.
 * It must render its own <html>/<body> tags since the root layout may have
 * failed to render.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0f',
          color: '#d4c5a0',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '480px' }}>
          <div
            style={{
              fontSize: '3rem',
              color: '#dc2626',
              marginBottom: '1rem',
              textShadow: '0 0 30px rgba(220,38,38,0.4)',
            }}
          >
            &#x2620;
          </div>

          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#dc2626',
              margin: '0 0 0.75rem',
            }}
          >
            The Arena Has Collapsed
          </h1>

          <p style={{ fontSize: '0.875rem', color: '#a89870', lineHeight: 1.6 }}>
            A catastrophic error has struck the colosseum. The entire arena must
            be rebuilt from the ashes.
          </p>

          {error.digest && (
            <p
              style={{
                marginTop: '0.5rem',
                fontSize: '0.7rem',
                color: '#4a4a6a',
              }}
            >
              Error ID: {error.digest}
            </p>
          )}

          <div
            style={{
              marginTop: '2rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: '0.75rem 2rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#fff',
                backgroundColor: '#dc2626',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                boxShadow: '0 0 20px rgba(220,38,38,0.3)',
                transition: 'box-shadow 0.2s',
              }}
            >
              Rebuild the Arena
            </button>

            <a
              href="/"
              style={{
                padding: '0.75rem 2rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#f59e0b',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: '0.5rem',
                textDecoration: 'none',
                backgroundColor: 'rgba(245,158,11,0.05)',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
            >
              Return to Arena
            </a>
          </div>

          <p
            style={{
              marginTop: '2.5rem',
              fontSize: '0.65rem',
              color: '#4a4a6a',
            }}
          >
            &quot;From the ashes of the fallen, the colosseum rises anew.&quot;
          </p>
        </div>
      </body>
    </html>
  );
}
