/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // '@napi-rs/canvas' ships platform-specific native .node binaries that
    // webpack can't bundle — without listing it here too, webpack silently
    // drops it, and pdfjs-dist's runtime `require("@napi-rs/canvas")` (used
    // to rasterize PDF pages) fails with "Cannot find module" in production
    // even though it works locally.
    serverComponentsExternalPackages: ['exceljs', 'pdf-to-img', 'pdfjs-dist', '@napi-rs/canvas'],
    // Belt-and-suspenders: @napi-rs/canvas's platform binary is loaded via
    // a require() whose specifier depends on process.platform/arch, which
    // @vercel/nft's static trace can't always resolve — force-include the
    // linux-x64-gnu binary Vercel's Node.js runtime actually needs.
    outputFileTracingIncludes: {
      '/api/generate': [
        './node_modules/@napi-rs/canvas/**/*',
        './node_modules/@napi-rs/canvas-linux-x64-gnu/**/*',
      ],
    },
  },
};

module.exports = nextConfig;
