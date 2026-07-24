/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // `next lint` defaults to app/pages/components/lib/src only, which silently
    // skipped the seed, the test suites and the Cypress specs.
    dirs: ["app", "lib", "db", "tests", "cypress", "scripts", "kb", "evals"],
  },
  experimental: {
    // postgres + the OpenAI SDK are server-only; keep them out of the bundle.
    serverComponentsExternalPackages: ["postgres"],
  },
};

export default nextConfig;
