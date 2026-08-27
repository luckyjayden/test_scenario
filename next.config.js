/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // '@napi-rs/canvas' ships platform-specific native .node binaries that
    // webpack can't bundle — without listing it here too, webpack silently
    // drops it, and pdfjs-dist's runtime `require("@napi-rs/canvas")` (used
    // to rasterize PDF pages) fails with "Cannot find module" in production
    // even though it works locally.
    serverComponentsExternalPackages: ['exceljs', 'pdf-to-img', 'pdfjs-dist', '@napi-rs/canvas'],
    // Belt-and-suspenders: @vercel/nft's static trace misses several files
    // these packages resolve at runtime (require.resolve('pdfjs-dist/package.json'),
    // the platform-specific @napi-rs/canvas binary chosen by
    // process.platform/arch, etc.) — force-include each package wholesale
    // for the one route that needs them rather than chase individual files.
    outputFileTracingIncludes: {
      '/api/generate': [
        './node_modules/pdf-to-img/**/*',
        './node_modules/pdfjs-dist/**/*',
        './node_modules/@napi-rs/canvas/**/*',
        './node_modules/@napi-rs/canvas-linux-x64-gnu/**/*',
      ],
    },
  },
};

module.exports = nextConfig;
