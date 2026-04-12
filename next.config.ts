import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // maplibre-gl and deck.gl all ship as ESM-only; Next.js needs to transpile
  // them so they work in both server and client bundles.
  transpilePackages: [
    "maplibre-gl",
    "@deck.gl/core",
    "@deck.gl/layers",
    "@deck.gl/react",
    "@deck.gl/mapbox",
    "@luma.gl/core",
    "@luma.gl/webgl",
    "@luma.gl/shadertools",
    "@math.gl/core",
    "@math.gl/web-mercator",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
