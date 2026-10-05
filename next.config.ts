import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "26mb",
    serverActions: {
      bodySizeLimit: "26mb",
    },
  },
};

export default nextConfig;
