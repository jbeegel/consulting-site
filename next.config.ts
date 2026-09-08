import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Spread Hunter dashboard is a static single-page app synced into public/spread by scripts/sync-spread-ui.mjs
    return [{ source: "/spread", destination: "/spread/index.html" }];
  },
};

export default nextConfig;
