/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // postgres + the OpenAI SDK are server-only; keep them out of the bundle.
    serverComponentsExternalPackages: ["postgres"],
  },
};

export default nextConfig;
