/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            // Cloud Web Speech needs microphone; avoid extra directives that can confuse policy checks.
            value: "microphone=(self)",
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig

