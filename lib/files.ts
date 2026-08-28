// Shared with client components (app/page.tsx, app/review/(tabs)/copy/page.tsx)
// so oversized PDFs get rejected the moment a file is selected, before any
// upload starts — this file has no server-only dependencies, unlike
// lib/ai/extract.ts (which re-exports the same value for server-side checks).
export const MAX_PDF_BYTES = 32 * 1024 * 1024;

export function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}
