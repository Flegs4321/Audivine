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
            value: "microphone=(self), on-device-speech-recognition=(self)",
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig

