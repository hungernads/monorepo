import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip ESLint errors during build (warnings only)
  eslint: {
    ignoreDuringBuilds: true,
  },

  webpack: (config, { isServer }) => {
    // Fix wagmi connector optional peer deps that aren't installed
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }

    // Externalize optional wagmi connector packages that aren't installed
    // These are optional peer deps of @wagmi/connectors
    config.externals = [
      ...(Array.isArray(config.externals) ? config.externals : []),
      ...(isServer
        ? [
            "@safe-global/safe-apps-provider",
            "@safe-global/safe-apps-sdk",
            "@walletconnect/ethereum-provider",
            "@coinbase/wallet-sdk",
            "@metamask/sdk",
            "@gemini-wallet/core",
            "@base-org/account",
            "porto/internal",
          ]
        : []),
    ];

    return config;
  },
};

export default nextConfig;
