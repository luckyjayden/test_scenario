// Regenerates lib/excel/templateData.ts from assets/template.xlsx.
// Run this after replacing assets/template.xlsx with an updated format file:
//   node scripts/regen-template-data.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const srcPath = path.join(root, 'assets', 'template.xlsx');
const outPath = path.join(root, 'lib', 'excel', 'templateData.ts');

const bytes = fs.readFileSync(srcPath);
const b64 = bytes.toString('base64');

const content =
  '// Base64-embedded copy of the fixed test-scenario Excel template.\n' +
  '// Embedded directly (not read via fs at runtime) so it survives\n' +
  '// Vercel serverless file tracing without any extra config.\n' +
  '//\n' +
  '// Regenerate with: node scripts/regen-template-data.mjs\n' +
  `export const TEMPLATE_XLSX_BASE64 = "${b64}";\n`;

fs.writeFileSync(outPath, content);
console.log(`wrote ${outPath} (${b64.length} base64 chars, from ${bytes.length} byte source)`);
