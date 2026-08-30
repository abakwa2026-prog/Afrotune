/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @afrotune/db ships TypeScript source directly (no separate build step in
  // this monorepo) - Next needs to know to compile it rather than treating
  // it as pre-built node_modules code.
  transpilePackages: ["@afrotune/db", "@afrotune/core"],
};

export default nextConfig;
