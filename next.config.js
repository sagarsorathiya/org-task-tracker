/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  
  async headers() {
    // Permissive headers for the Outlook add-in task pane (applied last so they override)
    const addinHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Remove X-Frame-Options so Outlook can embed the task pane in its frame
      { key: 'X-Frame-Options', value: '' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://appsforoffice.microsoft.com https://appsforoffice.microsoft.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self' ws: wss: https://appsforoffice.microsoft.com https://*.oaspapps.com",
          "frame-src 'self' https://appsforoffice.microsoft.com https://*.oaspapps.com",
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'self' https://outlook.office.com https://outlook.office365.com https://outlook.live.com",
        ].join('; '),
      },
    ];

    return [
      // ── Step 1: strict defaults for all routes
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              isProd
                ? "script-src 'self' 'unsafe-inline'"
                : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              isProd
                ? "connect-src 'self'"
                : "connect-src 'self' ws: wss:",
              "object-src 'none'",
              "form-action 'self'",
            ].join('; '),
          },
          ...(isProd
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' }]
            : []),
        ],
      },
      // ── Step 2: override for the static task pane HTML (served from /public)
      {
        source: '/outlook-addin/taskpane.html',
        headers: addinHeaders,
      },
      // ── Step 3: override for the Next.js addin route (browser preview)
      {
        source: '/addin/:path*',
        headers: addinHeaders,
      },
      // ── Step 4: override for the attachment inline-preview endpoint — PDFs/images
      // are rendered in a same-origin <iframe>/<img> by AttachmentPreviewModal, which
      // the Step 1 frame-ancestors 'none' default would otherwise block from framing.
      {
        source: '/api/attachments/:id/view',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      // ── Step 4b: same override for Transaction Reminder attachment previews —
      // AttachmentPreviewModal is shared between Tasks and Transaction Reminders.
      {
        source: '/api/transaction-attachments/:id/view',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },

  experimental: {
    serverComponentsExternalPackages: ['pg', 'ldapjs', 'pino', 'nodemailer', 'node-schedule'],
  },

  webpack: (config, { nextRuntime }) => {
    // Edge runtime (middleware) uses eval source maps by default, but the
    // production EdgeRuntime VM sandbox disables code generation from strings.
    // Next.js adds EvalDevToolModulePlugin to the plugins array BEFORE calling
    // this callback, so setting devtool=false alone is insufficient — we must
    // also remove the plugin explicitly.
    if (nextRuntime === 'edge') {
      config.devtool = false;
      config.plugins = (config.plugins ?? []).filter(
        (p) => {
          const n = p?.constructor?.name ?? '';
          return n !== 'EvalDevToolModulePlugin' && n !== 'EvalSourceMapDevToolPlugin';
        }
      );
    }
    return config;
  },
};

module.exports = nextConfig;
