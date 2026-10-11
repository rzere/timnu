import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // The animated teaser is a static page; the app lives at /oracle.
    return { beforeFiles: [{ source: "/", destination: "/teaser.html" }], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
