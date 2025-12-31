/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Handle worker files
      config.module.rules.push({
        test: /\.worker\.(js|ts)$/,
        use: {
          loader: 'worker-loader',
          options: {
            name: 'static/[hash].worker.js',
            publicPath: '/_next/',
          },
        },
      });
    }
    return config;
  },
}

module.exports = nextConfig

