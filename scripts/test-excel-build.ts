import fs from 'node:fs';
import path from 'node:path';
import { buildScenarioWorkbook } from '../lib/excel/build';
import { ExtractionResult } from '../lib/ai/schema';

async function main() {
  const fixturePath = path.join(process.cwd(), 'fixture.json');
  const extraction = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as ExtractionResult;

  const { buffer, scenarioCount, stepCount } = await buildScenarioWorkbook({
    extraction,
    sourceFilename: '땡겨요_로그인회원가입_V.0.72_20260825.pdf',
    author: '김태훈',
    today: '2026-08-26',
  });

  const outPath = path.join(process.cwd(), 'test-output.xlsx');
  fs.writeFileSync(outPath, buffer);
  console.log('scenarioCount:', scenarioCount, 'stepCount:', stepCount);
  console.log('wrote', outPath, buffer.byteLength, 'bytes');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
