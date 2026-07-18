import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // The consulting homepage is a hand-crafted static page; it lives in
    // public/index.html and serves at / untouched. The Next app owns /audit.
    return [{ source: "/", destination: "/index.html" }];
  },
};

export default nextConfig;
