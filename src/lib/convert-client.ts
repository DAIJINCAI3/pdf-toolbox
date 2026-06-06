/**
 * PDF 格式转换引擎（对标 SmallPDF / pdf365 品质）
 *
 * 设计原则：
 * 1. 最大程度还原原文档排版（字号、段落、对齐）
 * 2. Word 干净极简，无冗余装饰
 * 3. PPT 每页即原页面，一目了然
 * 4. Excel 结构化数据提取
 */

import { Document, Packer, Paragraph, TextRun,
  AlignmentType, LineRuleType, convertMillimetersToTwip } from "docx";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";

/* ================================================================
   数据模型
   ================================================================ */

interface TextBlock {
  text: string;
  fontSize: number;        // 字号 (pt)
  x: number;               // 水平位置
  y: number;               // 垂直位置
  width: number;           // 宽度
  height: number;          // 行高
  isBold?: boolean;
  alignment: "left" | "center" | "right";
}

interface PageData {
  pageNum: number;
  blocks: TextBlock[];
  thumbnail: string | null;  // 1.0x JPEG 85%
  pageWidth: number;
  pageHeight: number;
}

/* ================================================================
   提取引擎
   ================================================================ */

async function extractAllPages(
  buffer: ArrayBuffer,
  onProgress?: (msg: string) => void
): Promise<PageData[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const total = pdf.numPages;
  const results: PageData[] = [];

  for (let i = 1; i <= total; i++) {
    onProgress?.(`提取第 ${i}/${total} 页`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });

    // --- 带位置信息的文字提取 ---
    const textContent = await page.getTextContent();
    const rawBlocks: TextBlock[] = [];

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const tx = item.transform;
      const fontSize = Math.abs(tx[3]) || 12; // 从变换矩阵取字号

      rawBlocks.push({
        text: item.str,
        fontSize: Math.round(fontSize * 10) / 10,
        x: tx[4],
        y: viewport.height - tx[5] - (item.height || 0),
        width: item.width || 0,
        height: item.height || fontSize,
        alignment: detectAlignment(tx[4], viewport.width),
      });
    }

    // --- 合并同行的文字碎片 ---
    const blocks = mergeInlineFragments(rawBlocks);

    // --- 渲染缩略图 ---
    let thumbnail: string | null = null;
    try {
      const vp = page.getViewport({ scale: 1.0 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport: vp }).promise;
      thumbnail = canvas.toDataURL("image/jpeg", 0.85);
    } catch { /* 忽略 */ }

    results.push({
      pageNum: i,
      blocks,
      thumbnail,
      pageWidth: viewport.width,
      pageHeight: viewport.height,
    });
  }

  return results;
}

/** 根据水平位置判断对齐方式 */
function detectAlignment(x: number, pageW: number): "left" | "center" | "right" {
  const ratio = x / pageW;
  if (ratio < 0.06) return "left";
  if (ratio > 0.55) return "right";
  if (ratio > 0.28 && ratio < 0.45) return "center";
  return "left";
}

/** 同一行内的文字碎片合并 */
function mergeInlineFragments(blocks: TextBlock[]): TextBlock[] {
  if (blocks.length <= 1) return blocks;

  // 按 y 排序
  const sorted = [...blocks].sort((a, b) => a.y - b.y);
  const merged: TextBlock[] = [];

  let group = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = group[group.length - 1];
    const curr = sorted[i];

    // 同一行：y 差 < 字体高度的一半
    if (Math.abs(curr.y - prev.y) < Math.min(prev.height, curr.height) * 0.5) {
      group.push(curr);
    } else {
      merged.push(mergeGroup(group));
      group = [curr];
    }
  }
  merged.push(mergeGroup(group));

  return merged;
}

function mergeGroup(group: TextBlock[]): TextBlock {
  if (group.length === 1) return group[0];

  // 按 x 排序
  group.sort((a, b) => a.x - b.x);

  const text = group.map((g) => g.text).join("");
  const fontSize = mode(group.map((g) => g.fontSize)) || group[0].fontSize;
  const first = group[0];
  const last = group[group.length - 1];

  return {
    text,
    fontSize,
    x: first.x,
    y: first.y,
    width: last.x + last.width - first.x,
    height: Math.max(...group.map((g) => g.height)),
    alignment: first.alignment,
  };
}

/** 众数 */
function mode(arr: number[]): number | null {
  const freq = new Map<number, number>();
  for (const v of arr) freq.set(v, (freq.get(v) || 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [k, c] of freq) {
    if (c > bestCount) { bestCount = c; best = k; }
  }
  return best;
}

/* ================================================================
   PDF → DOCX（极简还原版）
   理念：每个 PDF 页 = Word 一页，保留原文字号和段落
   ================================================================ */

export async function pdfToDocx(
  buffer: ArrayBuffer,
  originalName: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  onProgress?.("正在读取 PDF…");
  const pages = await extractAllPages(buffer, onProgress);
  onProgress?.("正在生成 Word…");
  const fileName = originalName.replace(/\.pdf$/i, "");

  // A4 页边距（标准办公文档）
  const margin = {
    top: convertMillimetersToTwip(25.4),
    bottom: convertMillimetersToTwip(25.4),
    left: convertMillimetersToTwip(31.8),
    right: convertMillimetersToTwip(31.8),
  };

  const paragraphs: Paragraph[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];

    // 按段落聚类
    const paraGroups = clusterParagraphs(page.blocks);

    for (let gi = 0; gi < paraGroups.length; gi++) {
      const group = paraGroups[gi];
      const bodySize = group.avgFontSize || 12;
      const isTitle = bodySize >= 16 || (group.lines.length <= 1 && bodySize >= 14);
      const alignment = detectGroupAlignment(group);

      const text = group.lines.join("");
      if (!text.trim()) continue;

      const pgBreak = pi > 0 && gi === 0; // 每页第一个段落前加分页

      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text,
              font: isTitle ? "Microsoft YaHei" : "SimSun",
              size: ptToHalfPt(bodySize),
              bold: isTitle,
            }),
          ],
          alignment,
          pageBreakBefore: pgBreak,
          spacing: {
            before: isTitle ? 200 : 80,
            after: isTitle ? 120 : 40,
            line: ptToTwips(Math.max(bodySize * 1.7, 22)),
            lineRule: LineRuleType.AUTO,
          },
          indent: isTitle
            ? undefined
            : { firstLine: ptToTwips(bodySize * 2) },
        })
      );
    }
  }

  const doc = new Document({
    title: fileName,
    sections: [{
      properties: {
        page: { margin, size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) } },
      },
      children: paragraphs,
    }],
  });

  return Packer.toBlob(doc);
}

interface ParaGroup {
  lines: string[];
  avgFontSize: number;
  x: number;
}

/** 根据 y 间距将行聚合成段落 */
function clusterParagraphs(blocks: TextBlock[]): ParaGroup[] {
  if (blocks.length === 0) return [];

  const sorted = [...blocks].sort((a, b) => a.y - b.y);
  const lineGaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].y - (sorted[i - 1].y + sorted[i - 1].height);
    lineGaps.push(gap);
  }

  // 行间距阈值：中位 gap * 2.5
  const sortedGaps = [...lineGaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] || 10;
  const breakThreshold = Math.max(medianGap * 2.5, 15);

  const groups: ParaGroup[] = [];
  let current: TextBlock[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].y - (sorted[i - 1].y + sorted[i - 1].height);
    if (gap > breakThreshold) {
      groups.push(groupToPara(current));
      current = [sorted[i]];
    } else {
      current.push(sorted[i]);
    }
  }
  groups.push(groupToPara(current));

  return groups;
}

function groupToPara(blocks: TextBlock[]): ParaGroup {
  // 按 x 排序，拼接文字
  const sorted = [...blocks].sort((a, b) => a.x - b.x);
  const text = sorted.map((b) => b.text).join("");
  const avgFontSize =
    blocks.reduce((s, b) => s + b.fontSize, 0) / blocks.length;
  const x = Math.min(...blocks.map((b) => b.x));

  return { lines: [text], avgFontSize, x };
}

function detectGroupAlignment(group: ParaGroup): (typeof AlignmentType)[keyof typeof AlignmentType] {
  // 基于 x 位置判断
  // left 区域: x < 50  → LEFT
  // center 区域: x in 150-250 → CENTER
  if (group.x > 120) return AlignmentType.CENTER;
  return AlignmentType.JUSTIFIED;
}

function ptToHalfPt(pt: number): number {
  return Math.round(pt * 2);
}

function ptToTwips(pt: number): number {
  return Math.round(pt * 20);
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
  const pages = await extractAllPages(buffer, onProgress);
  onProgress?.("正在生成 Excel…");
  const fileName = originalName.replace(/\.pdf$/i, "").slice(0, 31);

  const rows: string[][] = [["序号", "页码", "段落内容", "字数"]];

  let idx = 1;
  for (const page of pages) {
    const paraGroups = clusterParagraphs(page.blocks);
    for (const pg of paraGroups) {
      const text = pg.lines.join("");
      if (!text.trim()) continue;
      rows.push([String(idx++), `第${page.pageNum}页`, text, String(text.length)]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 6 }, { wch: 8 }, { wch: 70 }, { wch: 8 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, fileName);

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ================================================================
   PDF → PPTX（对标 SmallPDF 风格）
   ================================================================ */

export async function pdfToPptx(
  buffer: ArrayBuffer,
  originalName: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  onProgress?.("正在读取…");
  const pages = await extractAllPages(buffer, onProgress);
  onProgress?.("正在生成 PPT…");
  const fileName = originalName.replace(/\.pdf$/i, "");

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  const C = {
    primary: "2563eb",
    dark: "1e293b",
    gray: "64748b",
    light: "f1f5f9",
    white: "ffffff",
  };

  // 封面
  const cover = pres.addSlide();
  cover.background = { color: C.white };
  cover.addText(fileName, {
    x: 0.8, y: 1.5, w: "85%", h: 1.2,
    fontSize: 32, bold: true, color: C.dark, align: "center",
  });
  cover.addText(`${pages.length} 页 · PDF工具箱转换`, {
    x: 0.8, y: 2.8, w: "85%", h: 0.6,
    fontSize: 14, color: C.gray, align: "center",
  });

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const slide = pres.addSlide();
    slide.background = { color: C.white };

    // 顶部状态条
    slide.addShape(pres.ShapeType.rect, {
      x: 0, y: 0, w: "100%", h: 0.06, fill: { color: C.primary },
    });

    // 页码
    slide.addText(`${i + 1} / ${pages.length}`, {
      x: 0.3, y: 0.15, w: 1.2, h: 0.35,
      fontSize: 10, color: C.white, bold: true,
      align: "center", fill: { color: C.primary }, rectRadius: 0.08,
    });

    // 缩略图占主体
    if (page.thumbnail) {
      slide.addImage({
        data: page.thumbnail,
        x: 0.3, y: 0.7, w: 9.4, h: 4.8,
        sizing: { type: "contain", w: 9.4, h: 4.8 },
      });
    } else if (page.blocks.length > 0) {
      // 无缩略图时显示文字
      const text = page.blocks.map((b) => b.text).join("\n").slice(0, 2000);
      slide.addText(text, {
        x: 0.5, y: 0.7, w: "90%", h: 4.8,
        fontSize: 12, color: C.dark, valign: "top",
      });
    }
  }

  // 尾页
  const endSlide = pres.addSlide();
  endSlide.background = { color: C.dark };
  endSlide.addText("PDF工具箱", {
    x: 0.5, y: 1.5, w: "90%", h: 1, fontSize: 36, bold: true, color: C.white, align: "center",
  });
  endSlide.addText("pdftoolbox.ltd", {
    x: 0.5, y: 2.8, w: "90%", h: 0.6, fontSize: 16, color: C.gray, align: "center",
  });

  return (await pres.write({ outputType: "blob" })) as Blob;
}

/* ================================================================
   下载
   ================================================================ */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
