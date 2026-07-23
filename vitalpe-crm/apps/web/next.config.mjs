/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The domain package is TypeScript source shared through the workspace.
    externalDir: true,
  },
  // PGlite ships a WASM binary; it must stay external to the server bundle.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
