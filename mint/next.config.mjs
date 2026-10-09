/** @type {import('next').NextConfig} */
// Static export: `npm run build` writes a plain-files site to out/ that any
// host can serve — Vercel, or a folder on bryanbrinkman.com.
// Hosting in a subfolder (e.g. bryanbrinkman.com/paint-smear)? Set
// NEXT_PUBLIC_BASE_PATH=/paint-smear before building.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const nextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: {unoptimized: true},
};
export default nextConfig;
