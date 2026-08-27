import ExcelJS from 'exceljs';
import { ExtractionResult } from '../ai/schema';
import { TEMPLATE_XLSX_BASE64 } from './templateData';

// Faithful TypeScript/ExcelJS port of the Python openpyxl build script used
// to hand-produce the first 땡겨요 로그인/회원가입 deliverable. Every rule
// referenced in comments below comes from the "0. 서식 보존 원칙" section of
// the internal process guide — see the guide for the full rationale.
//
// The template is embedded as a base64 constant (lib/excel/templateData.ts)
// rather than read from disk at runtime: a dynamic fs.readFile path is easy
// to lose track of during Vercel's serverless file-tracing step, while an
// imported constant is bundled by Next.js like any other module dependency.

const DATA_COLS = 'BCDEFGHIJKLMNOPQRSTUVW'.split('');

function cloneStyle(v: unknown) {
  return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v));
}

function mergesOf(ws: ExcelJS.Worksheet): string[] {
  // ExcelJS keeps merges as a map keyed by the top-left address on
  // ws.model.merges (array of range strings) — this is the most reliable
  // read-back across versions.
  return [...(ws.model.merges || [])];
}

export type BuildInput = {
  extraction: ExtractionResult;
  sourceFilename: string;
  author: string;
  today: string; // YYYY-MM-DD
};

export type BuildOutput = {
  buffer: Buffer;
  scenarioCount: number;
  stepCount: number;
};

export async function buildScenarioWorkbook(input: BuildInput): Promise<BuildOutput> {
  const { extraction, sourceFilename, author, today } = input;

  const templateBytes = Buffer.from(TEMPLATE_XLSX_BASE64, 'base64');
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs's
  // bundled Buffer typings predate current @types/node's generic Buffer<T>
  await wb.xlsx.load(templateBytes as any);

  const titleService = extraction.service_name?.trim() || '(서비스명 미확인)';
  const titleScope = extraction.screen_scope_name?.trim() || '(화면 범위 미확인)';

  // ---------------------------------------------------------------
  // 1. 표지
  // ---------------------------------------------------------------
  const cover = requireSheet(wb, '표지');
  cover.getCell('B2').value = `${titleService} ${titleScope} 테스트 시나리오`;
  cover.getCell('B4').value = `${titleService} ${titleScope} Test Scenario`;
  cover.getCell('C7').value = `${titleService} ${titleScope} 화면설계서 기반 테스트 시나리오`;
  cover.getCell('C8').value = sourceFilename;
  cover.getCell('C9').value = 'v1.0';
  cover.getCell('C10').value = author;
  cover.getCell('C11').value = today;
  cover.getCell('C12').value = '';
  cover.getCell('C13').value = '';
  cover.getCell('C14').value =
    `본 시나리오는 화면설계서(${sourceFilename})에 명시된 내용만 기반으로 작성했습니다.\n` +
    `설계서에 없는 내용은 '예상결과' 열에 '[추가 확인 필요]'로 표기했으니 기획팀 확인 후 반영해 주세요.`;
  cover.getRow(14).height = 65;

  // ---------------------------------------------------------------
  // 2. 변경 히스토리
  // ---------------------------------------------------------------
  const history = requireSheet(wb, '변경 히스토리');
  history.getCell('B3').value = 'v1.0';
  history.getCell('C3').value = author;
  history.getCell('D3').value = `${sourceFilename} 화면설계서 기반 테스트 시나리오 최초 작성`;
  history.getCell('E3').value = today;

  // ---------------------------------------------------------------
  // 3. 테스트 시나리오 시트 재구성
  // ---------------------------------------------------------------
  const scenario = requireSheet(wb, '테스트 시나리오');

  // capture master per-column style from the anchor row (row 4) BEFORE
  // touching anything -- row4 carries clean/complete formatting for every
  // column (B/C merge anchors included).
  type StyleTmpl = { font: any; fill: any; border: any; alignment: any; numFmt: any };
  const styleTemplate: Record<string, StyleTmpl> = {};
  for (const col of DATA_COLS) {
    const c = scenario.getCell(`${col}4`);
    styleTemplate[col] = {
      font: cloneStyle(c.font),
      fill: cloneStyle(c.fill),
      border: cloneStyle(c.border),
      alignment: cloneStyle(c.alignment),
      numFmt: c.numFmt,
    };
  }
  const greyFill = cloneStyle(scenario.getCell('D5').fill);
  const whiteFillOf = (col: string) => cloneStyle(styleTemplate[col].fill);

  // remove the two example merges inside rows 4-6, then delete those rows.
  // ExcelJS's spliceRows does not touch merge state on its own, so any
  // merge touching the deleted range must be unmerged first (mirrors the
  // openpyxl `delete_rows` merged-cell bug documented in the guide).
  for (const rng of ['B4:B5', 'C4:C6']) {
    try {
      scenario.unMergeCells(rng);
    } catch {
      /* not merged — fine */
    }
  }
  scenario.spliceRows(4, 3);

  function setCell(row: number, col: string, value: unknown, fillWhite: boolean) {
    const cell = scenario.getCell(`${col}${row}`);
    cell.value = value as any;
    const tmpl = styleTemplate[col];
    // The template's example rows (B4/D4) are styled italic + gray to read
    // as placeholder text — that's not meant to carry over to the actual
    // generated content, which should render as normal black text.
    const font = cloneStyle(tmpl.font);
    if (font) {
      font.italic = false;
      font.color = { argb: 'FF000000' };
    }
    cell.font = font;
    cell.fill = fillWhite ? whiteFillOf(col) : cloneStyle(greyFill);
    cell.border = cloneStyle(tmpl.border);
    cell.alignment = cloneStyle(tmpl.alignment);
    cell.numFmt = tmpl.numFmt;
    return cell;
  }

  let rowPtr = 4;
  let overallIdx = 0;
  const merges: Array<[number, number, string]> = [];
  let stepCount = 0;

  for (const stage of extraction.stages) {
    const stageStart = rowPtr;
    let pageRunStart: number | null = null;
    let pageRunValue: string | null = null;

    stage.rows.forEach((row, i) => {
      const r = rowPtr;
      const fillWhite = overallIdx % 2 === 0;

      const lines = [row.step, ...row.results.map((res) => `- ${res}`)];
      const dValue = lines.join('\n');
      scenario.getRow(r).height = lines.length * 24 + 16;

      setCell(r, 'B', i === 0 ? stage.stage_name : null, fillWhite);

      setCell(r, 'C', row.page, fillWhite);
      if (pageRunValue === null) {
        pageRunValue = row.page;
        pageRunStart = r;
      } else if (row.page !== pageRunValue) {
        if (pageRunStart !== null && r - 1 > pageRunStart) merges.push([pageRunStart, r - 1, 'C']);
        pageRunValue = row.page;
        pageRunStart = r;
      }

      setCell(r, 'D', dValue, fillWhite);

      for (const col of 'EFGHIJKLMNOPQRSTUVW'.split('')) {
        setCell(r, col, null, fillWhite);
      }

      // hidden helper column X: repeats the stage name on EVERY row (never
      // merged) so the 요약 대시보드 COUNTIF can count actual step-rows per
      // stage. B열은 가이드 규칙대로 계속 병합 상태를 유지하되, 병합된 셀은
      // 앵커 외에는 값이 비어 있어 COUNTIF가 병합 그룹당 1건만 세는 문제가
      // 있어 화면에는 보이지 않는 이 보조열로 집계 기준을 분리한다.
      const xcell = scenario.getCell(`X${r}`);
      xcell.value = stage.stage_name;
      xcell.font = cloneStyle(styleTemplate['B'].font);
      xcell.alignment = cloneStyle(styleTemplate['D'].alignment);

      rowPtr += 1;
      overallIdx += 1;
      stepCount += 1;
    });

    if (pageRunValue !== null && pageRunStart !== null && rowPtr - 1 > pageRunStart) {
      merges.push([pageRunStart, rowPtr - 1, 'C']);
    }

    const stageEnd = rowPtr - 1;
    if (stageEnd > stageStart) merges.push([stageStart, stageEnd, 'B']);
  }

  for (const [r1, r2, col] of merges) {
    scenario.mergeCells(`${col}${r1}:${col}${r2}`);
  }

  scenario.getCell('X2').value = '시나리오단계(집계용/숨김)';
  scenario.getCell('X2').font = cloneStyle(styleTemplate['B'].font);
  scenario.getColumn('X' as unknown as number).width = 30;
  (scenario.getColumn('X' as unknown as number) as any).hidden = true;

  const lastDataRow = rowPtr - 1;
  const scenarioCount = extraction.stages.length;

  // ---------------------------------------------------------------
  // 4. 요약 대시보드: 시나리오 단계별 스텝 수 표 확장 (예시 2행 -> N행)
  // ---------------------------------------------------------------
  const dashboard = requireSheet(wb, '요약 대시보드');

  const cellStyle = (addr: string) => {
    const c = dashboard.getCell(addr);
    return {
      font: cloneStyle(c.font),
      fill: cloneStyle(c.fill),
      border: cloneStyle(c.border),
      alignment: cloneStyle(c.alignment),
      numFmt: c.numFmt,
    };
  };
  const tmplWhite = { B: cellStyle('B28'), C: cellStyle('C28'), D: cellStyle('D28') };
  const tmplGrey = { B: cellStyle('B29'), C: cellStyle('C29'), D: cellStyle('D29') };

  const firstRow = 28;
  const extraRows = Math.max(0, scenarioCount - 2);
  if (extraRows > 0) {
    // insert `extraRows` blank rows after row 29 (no deletion, so no merge
    // range gets destroyed below the insertion point — nothing else exists
    // below row 29 in the template anyway).
    scenario_insertBlankRows(dashboard, 30, extraRows);
  }

  const lastRow = firstRow + scenarioCount - 1;
  const maxRef = `$C$${firstRow}:$C$${lastRow}`;

  const applyStyle = (addr: string, tmpl: ReturnType<typeof cellStyle>) => {
    const c = dashboard.getCell(addr);
    c.font = cloneStyle(tmpl.font);
    c.fill = cloneStyle(tmpl.fill);
    c.border = cloneStyle(tmpl.border);
    c.alignment = cloneStyle(tmpl.alignment);
    c.numFmt = tmpl.numFmt;
  };

  extraction.stages.forEach((stage, i) => {
    const r = firstRow + i;
    const t = i % 2 === 0 ? tmplWhite : tmplGrey;
    const name = stage.stage_name;

    dashboard.getCell(`B${r}`).value = name;
    applyStyle(`B${r}`, t.B);

    // escape double quotes defensively (stage names shouldn't contain them,
    // but a formula built from untrusted extracted text must not break)
    const safeName = name.replace(/"/g, '""');
    dashboard.getCell(`C${r}`).value = {
      formula: `COUNTIF('테스트 시나리오'!$X$4:$X$300,"${safeName}")`,
    } as ExcelJS.CellFormulaValue;
    applyStyle(`C${r}`, t.C);

    dashboard.getCell(`D${r}`).value = {
      formula: `IF(MAX(${maxRef})=0,"",REPT("■",ROUND(C${r}/MAX(${maxRef})*10,0)))`,
    } as ExcelJS.CellFormulaValue;
    applyStyle(`D${r}`, t.D);
    try {
      dashboard.unMergeCells(`D${r}:G${r}`);
    } catch {
      /* not merged yet — fine */
    }
    dashboard.mergeCells(`D${r}:G${r}`);
  });

  dashboard.pageSetup.printArea = `A1:G${lastRow + 2}`;

  // ---------------------------------------------------------------
  // 5. 범례 및 작성가이드 시트 정리 (작성가이드 섹션 삭제 -> "범례")
  // ---------------------------------------------------------------
  const legend = requireSheet(wb, '범례 및 작성가이드');
  try {
    legend.unMergeCells('B2:D2');
  } catch {
    /* ignore */
  }
  const staleTitles = ['B10:D10', 'B18:D18', 'B25:D25', 'B35:D35'];
  for (const rng of staleTitles) {
    try {
      legend.unMergeCells(rng);
    } catch {
      /* ignore */
    }
  }
  legend.spliceRows(2, 8); // 작성가이드 title(2), header(3), items(4-8), blank(9)

  for (const oldTop of [10, 18, 25, 35]) {
    const newRow = oldTop - 8;
    legend.mergeCells(`B${newRow}:D${newRow}`);
  }

  legend.name = '범례';
  legend.pageSetup.printArea = 'A1:D34';

  // ---------------------------------------------------------------
  const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  return { buffer, scenarioCount, stepCount };
}

function requireSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`서식 파일에서 "${name}" 시트를 찾을 수 없습니다. 템플릿 파일이 손상되었을 수 있습니다.`);
  return ws;
}

// ExcelJS has no direct "insert N blank rows without touching merges below"
// primitive that's safe across versions, so we do it explicitly: read every
// existing merge, shift the ones at/after `atRow` down by `count`, then
// insert blank rows via spliceRows(atRow, 0, ...blanks).
function scenario_insertBlankRows(ws: ExcelJS.Worksheet, atRow: number, count: number) {
  const merges = mergesOf(ws);
  const toShift: string[] = [];
  for (const m of merges) {
    const [start] = m.split(':');
    const startRow = parseInt(start.replace(/[A-Z]/g, ''), 10);
    if (startRow >= atRow) toShift.push(m);
  }
  for (const m of toShift) {
    try {
      ws.unMergeCells(m);
    } catch {
      /* ignore */
    }
  }

  const blanks = Array.from({ length: count }, () => [] as unknown[]);
  ws.spliceRows(atRow, 0, ...blanks);

  for (const m of toShift) {
    const [start, end] = m.split(':');
    const startCol = start.replace(/[0-9]/g, '');
    const endCol = end.replace(/[0-9]/g, '');
    const startRow = parseInt(start.replace(/[A-Z]/g, ''), 10) + count;
    const endRow = parseInt(end.replace(/[A-Z]/g, ''), 10) + count;
    ws.mergeCells(`${startCol}${startRow}:${endCol}${endRow}`);
  }
}
