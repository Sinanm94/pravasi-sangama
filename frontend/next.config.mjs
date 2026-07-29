/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // @pravasi/shared ships compiled ESM from the workspace, not from npm.
  // Without this, Next will not process it through its own pipeline.
  transpilePackages: ['@pravasi/shared'],
};

export default nextConfig;
