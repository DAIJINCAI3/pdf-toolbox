/**
 * PDF 转换引擎 v4 — 稳健版
 *
 * 核心思路：
 * 1. 先检测 PDF 是否有文字（无文字 = 扫描件 → 直接提示）
 * 2. 按阅读顺序提取所有文字（先 y 后 x）
 * 3. 用"正文众数字号"做基准，比正文大的识别为标题
 * 4. 所有段落统一排版，干净整洁
 */

import { Document, Packer, Paragraph, TextRun,
  AlignmentType, convertMillimetersToTwip, LineRuleType } from "docx";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";

/* ================================================================
   数据模型
   ================================================================ */

interface Line {
  text: string;
  fontSize: number;
  y: number;
  x: number;
}

/* ================================================================
   提取（稳健版）
   ================================================================ */

async function extractLines(
  buffer: ArrayBuffer,
  onProgress?: (msg: string) => void
): Promise<Line[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const total = pdf.numPages;
  const allLines: Line[] = [];

  for (let i = 1; i <= total; i++) {
    onProgress?.(`提取第 ${i}/${total} 页`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();

    // 收集所有文字碎片
    const items: { text: string; fontSize: number; x: number; y: number }[] = [];
    for (const item of tc.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const t = item.transform;
      const fz = Math.abs(t[3]);
      items.push({
        text: item.str,
        fontSize: fz,
        x: t[4],
        y: viewport.height - t[5],
      });
    }

    if (items.length === 0) continue;

    // 按 y 分组 = 行
    items.sort((a, b) => a.y - b.y);
    const lines: { text: string; fontSize: number; x: number; y: number }[] = [];
    let group = [items[0]];
    for (let j = 1; j < items.length; j++) {
      const prev = group[group.length - 1];
      const cur = items[j];
      if (Math.abs(cur.y - prev.y) < Math.max(prev.fontSize, cur.fontSize) * 0.4) {
        group.push(cur);
      } else {
        // 合并这一行
        group.sort((a, b) => a.x - b.x);
        const joined = group.map((g) => g.text).join("");
        const avgFs = group.reduce((s, g) => s + g.fontSize, 0) / group.length;
        lines.push({ text: joined, fontSize: Math.round(avgFs), x: group[0].x, y: group[0].y });
        group = [cur];
      }
    }
    // 最后一行
    group.sort((a, b) => a.x - b.x);
    const joined2 = group.map((g) => g.text).join("");
    const avgFs2 = group.reduce((s, g) => s + g.fontSize, 0) / group.length;
    lines.push({ text: joined2, fontSize: Math.round(avgFs2), x: group[0].x, y: group[0].y });

    allLines.push(...lines);
  }

  return allLines;
}

/* ================================================================
   结构分析
   ================================================================ */

type ParaLevel = "title" | "h1" | "h2" | "h3" | "body";

interface Para {
  text: string;
  level: ParaLevel;
  fontSize: number;
  align: "left" | "center";
}

function analyze(lines: Line[]): Para[] {
  if (lines.length === 0) return [];

  // 计算正文字号（众数）
  const sizes = lines.map((l) => l.fontSize);
  const bodySize = mode(sizes) || 12;

  // 按行间距聚类段落
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push(lines[i].y - lines[i - 1].y);
  }
  const sg = [...gaps].sort((a, b) => a - b);
  const medianGap = sg[Math.floor(sg.length / 2)] || 10;
  const breakThresh = Math.max(medianGap * 2.2, bodySize * 1.5);

  // 聚合成段落
  const groups: Line[][] = [];
  let cur = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].y - lines[i - 1].y;
    if (g > breakThresh) {
      groups.push(cur);
      cur = [lines[i]];
    } else {
      cur.push(lines[i]);
    }
  }
  groups.push(cur);

  // 转为 Para
  const result: Para[] = [];
  for (const g of groups) {
    const text = g.map((l) => l.text).join("");
    if (!text.trim()) continue;

    const avgFs = g.reduce((s, l) => s + l.fontSize, 0) / g.length;
    const avgX = g.reduce((s, l) => s + l.x, 0) / g.length;
    const align: "left" | "center" = avgX > 150 ? "center" : "left";

    const bigger = avgFs >= bodySize + 3;        // 比正文大 3pt+
    const isCenter = align === "center";
    const isBig = avgFs >= 16;

    let level: ParaLevel = "body";

    if ((isBig && isCenter) || (bigger && isCenter) || avgFs >= 22) {
      level = "title";
    } else if (/^[（(]?[一二三四五六七八九十]+[）)、，．.\s]/.test(text) ||
               /^第[一二三四五六七八九十百千]+[章节条]/.test(text)) {
      level = "h1";
    } else if (/^[（(][一二三四五六七八九十]+[）)]/.test(text) ||
               /^\d+\.\d+/.test(text)) {
      level = "h2";
    } else if (bigger || (text.length <= 18 && !/[。！？；]$/.test(text))) {
      level = "h3";
    }

    result.push({ text, level, fontSize: Math.round(avgFs), align });
  }

  return result;
}

function mode(arr: number[]): number | null {
  const f = new Map<number, number>();
  for (const v of arr) f.set(v, (f.get(v) || 0) + 1);
  let best: number | null = null, bc = 0;
  for (const [k, c] of f) { if (c > bc) { bc = c; best = k; } }
  return best;
}

/* ================================================================
   字体体系
   ================================================================ */

const FONT = {
  title: "方正小标宋简体",
  h1: "方正黑体简体",
  h2: "方正楷体简体",
  h3: "方正仿宋简体",
  body: "方正仿宋简体",
};

const LINE28 = { line: 560, lineRule: LineRuleType.EXACT } as const;
const BODY_PT = 32; // 三号 16pt → 32 half-pts

/* ================================================================
   PDF → DOCX
   ================================================================ */

export async function pdfToDocx(
  buffer: ArrayBuffer,
  originalName: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  onProgress?.("正在读取 PDF…");
  const lines = await extractLines(buffer, onProgress);

  if (lines.length === 0) {
    throw new Error("该 PDF 中没有文字，可能是扫描图片，无法转为 Word。建议使用 OCR 工具处理。");
  }

  onProgress?.("正在分析结构…");
  const paras = analyze(lines);
  const fileName = originalName.replace(/\.pdf$/i, "");

  onProgress?.("正在生成 Word…");

  const margin = {
    top: convertMillimetersToTwip(37),
    bottom: convertMillimetersToTwip(35),
    left: convertMillimetersToTwip(28),
    right: convertMillimetersToTwip(26),
  };

  const paraList: Paragraph[] = [];

  for (const p of paras) {
    switch (p.level) {
      case "title":
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: p.text, font: FONT.title, size: 44, bold: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 560, ...LINE28 },
          })
        );
        break;

      case "h1":
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: p.text, font: FONT.h1, size: BODY_PT, bold: true })],
            spacing: { before: 300, after: 140, ...LINE28 },
          })
        );
        break;

      case "h2":
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: p.text, font: FONT.h2, size: BODY_PT })],
            spacing: { before: 200, after: 80, ...LINE28 },
          })
        );
        break;

      case "h3":
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: p.text, font: FONT.h3, size: BODY_PT, bold: true })],
            indent: { firstLine: 480 },
            spacing: { before: 120, after: 40, ...LINE28 },
          })
        );
        break;

      case "body":
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: `　　${p.text}`, font: FONT.body, size: BODY_PT })],
            alignment: AlignmentType.JUSTIFIED,
            spacing: LINE28,
          })
        );
        break;
    }
  }

  const doc = new Document({
    title: fileName,
    styles: { default: { document: { run: { font: FONT.body, size: BODY_PT } } } },
    sections: [{
      properties: {
        page: { margin, size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) } },
      },
      children: paraList,
    }],
  });

  return Packer.toBlob(doc);
}

/* ================================================================
   PDF → XLSX
   ================================================================ */

export async function pdfToXlsx(
  buffer: ArrayBuffer,
  originalName: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  onProgress?.("正在读取…");
  const lines = await extractLines(buffer, onProgress);
  const paras = analyze(lines);
  onProgress?.("正在生成 Excel…");
  const sn = originalName.replace(/\.pdf$/i, "").slice(0, 31);

  const levelLabel: Record<string, string> = { title: "标题", h1: "一级", h2: "二级", h3: "三级", body: "正文" };
  const rows: string[][] = [["序号", "层级", "内容", "字数"]];
  paras.forEach((p, i) => {
    rows.push([String(i + 1), levelLabel[p.level] || "", p.text, String(p.text.length)]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 6 }, { wch: 6 }, { wch: 80 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sn);
  return new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ================================================================
   PDF → PPTX（纯可编辑文本框）
   ================================================================ */

export async function pdfToPptx(
  buffer: ArrayBuffer,
  originalName: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  onProgress?.("正在读取…");
  const lines = await extractLines(buffer, onProgress);
  const paras = analyze(lines);
  onProgress?.("正在生成 PPT…");
  const fileName = originalName.replace(/\.pdf$/i, "");

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  const C = { primary: "2563eb", dark: "1e293b", gray: "64748b", white: "ffffff", accent: "f59e0b" };

  // 封面
  const cover = pres.addSlide();
  cover.background = { color: C.white };
  cover.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.08, fill: { color: C.primary } });
  cover.addText(fileName, {
    x: 0.8, y: 1.5, w: "85%", h: 1.2,
    fontSize: 32, bold: true, color: C.dark, align: "center", fontFace: "Microsoft YaHei",
  });
  cover.addText(`共 ${paras.length} 个段落 · PDF工具箱转换`, {
    x: 0.8, y: 2.9, w: "85%", h: 0.5,
    fontSize: 14, color: C.gray, align: "center",
  });

  // 内容页
  const PER_PAGE = 10; // 每页放 10 个段落
  const slides = Math.ceil(paras.length / PER_PAGE);

  for (let s = 0; s < slides; s++) {
    const slide = pres.addSlide();
    slide.background = { color: C.white };
    slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.06, fill: { color: C.primary } });
    slide.addText(`${s + 1} / ${slides}`, {
      x: 0.2, y: 0.12, w: 0.8, h: 0.3,
      fontSize: 9, color: C.white, bold: true, align: "center",
      fill: { color: C.primary }, rectRadius: 0.06,
    });

    const start = s * PER_PAGE;
    const chunk = paras.slice(start, start + PER_PAGE);
    let cy = 0.6;

    for (const p of chunk) {
      const isTitle = p.level === "title" || p.level === "h1";
      const sz = isTitle ? 14 : 11;
      const h = isTitle ? 0.45 : 0.32;

      if (cy + h > 5.5) break;

      slide.addText(p.text, {
        x: 0.3, y: cy, w: 9.4, h,
        fontSize: sz,
        color: isTitle ? C.dark : "374151",
        bold: isTitle || p.level === "h3",
        align: "left",
        fontFace: isTitle ? "Microsoft YaHei" : "SimSun",
        valign: "top",
      });
      cy += h + 0.04;
    }
  }

  // 尾页
  const end = pres.addSlide();
  end.background = { color: C.dark };
  end.addText("PDF 工具箱", {
    x: 0.5, y: 1.5, w: "90%", h: 1, fontSize: 36, bold: true, color: C.white, align: "center",
  });
  end.addText("pdftoolbox.ltd", {
    x: 0.5, y: 2.8, w: "90%", h: 0.6, fontSize: 16, color: C.gray, align: "center",
  });

  return (await pres.write({ outputType: "blob" })) as Blob;
}

/* ================================================================
   下载
   ================================================================ */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
