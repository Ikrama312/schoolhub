/** @type {import('next').NextConfig} */
// ponytail: `next dev` needs eval (React Refresh) + inline RSC bootstrap scripts; prod stays strict.
// Prod will need a per-request nonce in middleware for Next's inline scripts.
const DEV_SCRIPT = process.env.NODE_ENV === 'development' ? " 'unsafe-eval' 'unsafe-inline'" : '';
const CSP = `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'self'${DEV_SCRIPT};`;

const headersWith = (frameOptions, csp) => [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: frameOptions },
  { key: 'Content-Security-Policy', value: csp },
];

const nextConfig = {
  reactStrictMode: true,
  // SH-9 TASK-1 (ADR-2 follow-up): webpack resolves '@mui/x-internals/useFirstRender' to its CJS build,
  // whose Object.keys re-export it can't analyse, so x-data-grid's `export *` of it fails to compile.
  // Point the specifier at the ESM file. Remove once MUI X is upgraded past the break.
  webpack(config) {
    config.resolve.alias['@mui/x-internals/useFirstRender$'] = require.resolve(
      './node_modules/@mui/x-data-grid/node_modules/@mui/x-internals/useFirstRender/useFirstRender.mjs',
    );
    return config;
  },
  async headers() {
    return [
      // Everything except file downloads: never framed.
      { source: '/((?!api/files/).*)', headers: headersWith('DENY', CSP) },
      // PRD-09 D11: our own pages may frame /api/files/:id?inline=1 for the PDF preview (FR-29).
      // The route still runs canAccessFile and sends nosniff.
      { source: '/api/files/:id', headers: headersWith('SAMEORIGIN', `${CSP} frame-ancestors 'self';`) },
    ];
  },
};

module.exports = nextConfig;
