/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @afrotune/db ships TypeScript source directly (no separate build step in
  // this monorepo) - Next needs to know to compile it rather than treating
  // it as pre-built node_modules code.
  transpilePackages: ["@afrotune/db", "@afrotune/core"],
  // @afrotune/db and @afrotune/core use NodeNext-style relative imports
  // (e.g. "./repositories/songRequests.js") that point at .ts source files -
  // tsx resolves that pattern for apps/api and apps/worker, but webpack
  // doesn't by default, so it fails to resolve them when bundling for
  // apps/web. This tells webpack to try .ts/.tsx before falling back to .js.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
