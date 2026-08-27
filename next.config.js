/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['exceljs', 'pdf-to-img', 'pdfjs-dist'],
  },
};

module.exports = nextConfig;
