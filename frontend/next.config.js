// Baseline security headers for every page. See docs/DECISIONS.md
// (2026-11-21, frontend UI pass) for why each one is here.
const securityHeaders = [
  // Invite links carry the candidate's token in the path; never leak it to
  // another origin via the Referer header.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // No framing: consent, erasure and review buttons must not be
  // clickjackable.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Microphone only for this origin (voice interviews); nothing else.
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self), payment=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
