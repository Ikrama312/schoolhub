'use client';

// global-error replaces the root layout on failure, so it must render its
// own <html>/<body> — it cannot rely on the MUI provider tree in layout.tsx.
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <h1>Something went wrong</h1>
            <p>{error.message || 'An unexpected error occurred.'}</p>
            <button onClick={() => reset()}>Try again</button>
          </div>
        </div>
      </body>
    </html>
  );
}
