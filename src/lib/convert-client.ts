/**
 * PDF 格式转换引擎 v3
 *
 * Word：行距28磅，方正字体体系，智能标题层级识别
 * PPT：纯可编辑文本框，保留原位置和字号
 * Excel：结构化段落提取
 */

import { Document, Packer, Paragraph, TextRun,
  AlignmentType, convertMillimetersToTwip,
  LineRuleType } from "docx";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";

/* ================================================================
   方正字体名称常量（文档写入的字体名，系统有该字体即可正常显示）
   ================================================================ */

const FZ_BIAOSONG = "方正小标宋简体";   // 标题
const FZ_HEI = "方正黑体简体";           // 一级标题
const FZ_KAI = "方正楷体简体";           // 二级标题
const FZ_FANGSONG = "方正仿宋简体";      // 正文 / 三级标题加粗

/* ================================================================
   数据模型
   ================================================================ */

interface TextBlock {
  text: string;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageData {
  pageNum: number;
  blocks: TextBlock[];
  pageWidth: number;
  pageHeight: number;
}

/* ================================================================
   PDF 文字提取（保留位置 + 字号）
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

    const textContent = await page.getTextContent();
    const raw: TextBlock[] = [];

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const tx = item.transform;
      raw.push({
        text: item.str,
        fontSize: Math.round(Math.abs(tx[3]) * 10) / 10 || 12,
        x: tx[4],
        y: viewport.height - tx[5] - (item.height || 0),
        width: item.width || 0,
        height: item.height || Math.abs(tx[3]) || 12,
      });
    }

    results.push({
      pageNum: i,
      blocks: mergeSameLine(raw),
      pageWidth: viewport.width,
      pageHeight: viewport.height,
    });
  }

  return results;
}

/** 同行碎片合并 */
function mergeSameLine(blocks: TextBlock[]): TextBlock[] {
  if (blocks.length <= 1) return blocks;
  const sorted = [...blocks].sort((a, b) => a.y - b.y);
  const out: TextBlock[] = [];
  let group = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = group[group.length - 1];
    const curr = sorted[i];
    if (Math.abs(curr.y - prev.y) < Math.min(prev.height, curr.height) * 0.5) {
      group.push(curr);
    } else {
      out.push(mergeGroup(group));
      group = [curr];
    }
  }
  out.push(mergeGroup(group));
  return out;
}

function mergeGroup(g: TextBlock[]): TextBlock {
  if (g.length === 1) return g[0];
  g.sort((a, b) => a.x - b.x);
  const first = g[0];
  const last = g[g.length - 1];
  return {
    text: g.map((b) => b.text).join(""),
    fontSize: mode(g.map((b) => b.fontSize)) || first.fontSize,
    x: first.x,
    y: first.y,
    width: last.x + last.width - first.x,
    height: Math.max(...g.map((b) => b.height)),
  };
}

function mode(arr: number[]): number | null {
  const f = new Map<number, number>();
  for (const v of arr) f.set(v, (f.get(v) || 0) + 1);
  let best: number | null = null, bestC = 0;
  for (const [k, c] of f) { if (c > bestC) { bestC = c; best = k; } }
  return best;
}

/* ================================================================
   段落结构 + 标题层级识别
   ================================================================ */

/** 段落结构 */
interface StructuredPara {
  text: string;
  level: "title" | "h1" | "h2" | "h3" | "body";
  fontSize: number;       // 原文原始字号
  alignment: "left" | "center" | "right";
}

/** 根据 y 间距聚类成段落，再识别层级 */
function analyzeStructure(allBlocks: TextBlock[]): StructuredPara[] {
  const sorted = [...allBlocks].sort((a, b) => a.y - b.y);
  if (sorted.length === 0) return [];

  // Step 1: 聚类段落
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i].y - (sorted[i - 1].y + sorted[i - 1].height));
  }
  const sgaps = [...gaps].sort((a, b) => a - b);
  const median = sgaps[Math.floor(sgaps.length / 2)] || 10;
  const threshold = Math.max(median * 2.5, 18);

  const rawParas: { lines: TextBlock[] }[] = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].y - (sorted[i - 1].y + sorted[i - 1].height);
    if (g > threshold) { rawParas.push({ lines: cur }); cur = [sorted[i]]; }
    else { cur.push(sorted[i]); }
  }
  rawParas.push({ lines: cur });

  // Step 2: 转为纯文本 + 属性
  const paras: { text: string; fontSize: number; y: number; alignment: "left" | "center" | "right" }[] = [];
  for (const rp of rawParas) {
    const sortedL = [...rp.lines].sort((a, b) => a.x - b.x);
    const text = sortedL.map((b) => b.text).join("");
    if (!text.trim()) continue;
    const avgSize = rp.lines.reduce((s, b) => s + b.fontSize, 0) / rp.lines.length;
    const avgX = rp.lines.reduce((s, b) => s + b.x, 0) / rp.lines.length;
    const align: "left" | "center" | "right" =
      avgX > 180 ? "center" : avgX > 300 ? "right" : "left";
    paras.push({ text, fontSize: Math.round(avgSize), y: rp.lines[0].y, alignment: align });
  }

  // Step 3: 计算"正文字号"= 众数字号
  const allSizes = paras.map((p) => p.fontSize);
  const bodySize = mode(allSizes) || 12;

  // Step 4: 按规则分配层级
  const result: StructuredPara[] = [];

  for (const p of paras) {
    const t = p.text.trim();
    const bigger = p.fontSize >= bodySize + 2;  // 比正文大 2pt 以上

    // 标题：全文最大字号 + 居中 → title
    if (bigger && p.alignment === "center" && p.fontSize >= 16) {
      result.push({ text: t, level: "title", fontSize: p.fontSize, alignment: p.alignment });
    }
    // 一级标题：一、二、三… 或第X章/节
    else if (/^[（(]?[一二三四五六七八九十]+[）)、，．.]/.test(t) || /^第[一二三四五六七八九十百千]+[章节条]/.test(t)) {
      result.push({ text: t, level: "h1", fontSize: p.fontSize, alignment: p.alignment });
    }
    // 二级标题：（一）（二）… 或 1.1 / 2.1
    else if (/^[（(][一二三四五六七八九十]+[）)]/.test(t) || /^\d+\.\d+/.test(t)) {
      result.push({ text: t, level: "h2", fontSize: p.fontSize, alignment: p.alignment });
    }
    // 三级标题：1. / (1) / ① / 数字开头 + 短句
    else if (/^(\d+[\.\)、]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩])/.test(t) || (t.length <= 20 && !/[。！？；]$/.test(t))) {
      result.push({ text: t, level: "h3", fontSize: p.fontSize, alignment: p.alignment });
    }
    // 正文
    else {
      result.push({ text: t, level: "body", fontSize: p.fontSize, alignment: p.alignment });
    }
  }

  return result;
}

/* ================================================================
   PDF → DOCX（方正字体 · 行距28 · 层级排版）
   ================================================================ */

export async function pdfToDocx(
  buffer: ArrayBuffer,
  originalName: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  onProgress?.("正在读取 PDF…");
  const pages = await extractAllPages(buffer, onProgress);
  onProgress?.("正在分析结构…");

  const allBlocks = pages.flatMap((p) => p.blocks);
  const sections = analyzeStructure(allBlocks);
  const fileName = originalName.replace(/\.pdf$/i, "");

  onProgress?.("正在生成 Word…");

  // 行距常数
  const LINE28 = 560; // 28磅 = 560 twips
  const LINE28_AUTO = { line: LINE28, lineRule: LineRuleType.EXACT } as const;

  // 页边距：国标公文
  const margin = {
    top: convertMillimetersToTwip(37),
    bottom: convertMillimetersToTwip(35),
    left: convertMillimetersToTwip(28),
    right: convertMillimetersToTwip(26),
  };

  const paraList: Paragraph[] = [];

  for (const sec of sections) {
    switch (sec.level) {
      case "title": {
        // 标题：方正小标宋简体，二号(22pt)，居中，段后空行
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: sec.text, font: FZ_BIAOSONG, size: 44, bold: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 560, ...LINE28_AUTO },
          })
        );
        break;
      }

      case "h1": {
        // 一级标题：方正黑体简体，三号(16pt)，加粗
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: sec.text, font: FZ_HEI, size: 32, bold: true })],
            alignment: AlignmentType.LEFT,
            spacing: { before: 300, after: 140, ...LINE28_AUTO },
          })
        );
        break;
      }

      case "h2": {
        // 二级标题：方正楷体简体，三号(16pt)，不加粗
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: sec.text, font: FZ_KAI, size: 32, bold: false })],
            alignment: AlignmentType.LEFT,
            spacing: { before: 200, after: 80, ...LINE28_AUTO },
          })
        );
        break;
      }

      case "h3": {
        // 三级标题：方正仿宋简体，三号，加粗
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: sec.text, font: FZ_FANGSONG, size: 32, bold: true })],
            alignment: AlignmentType.LEFT,
            indent: { firstLine: 480 },
            spacing: { before: 120, after: 40, ...LINE28_AUTO },
          })
        );
        break;
      }

      case "body": {
        // 正文：方正仿宋简体，三号(16pt)，首行缩进2字符
        paraList.push(
          new Paragraph({
            children: [new TextRun({ text: `　　${sec.text}`, font: FZ_FANGSONG, size: 32 })],
            alignment: AlignmentType.JUSTIFIED,
            spacing: LINE28_AUTO,
          })
        );
        break;
      }
    }
  }

  const doc = new Document({
    title: fileName,
    styles: {
      default: {
        document: { run: { font: FZ_FANGSONG, size: 32 } },
      },
    },
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
  const pages = await extractAllPages(buffer, onProgress);
  onProgress?.("正在生成 Excel…");
  const sn = originalName.replace(/\.pdf$/i, "").slice(0, 31);

  const rows: string[][] = [["序号", "页码", "段落内容", "层级", "字数"]];
  let idx = 1;
  for (const page of pages) {
    const paras = analyzeStructure(page.blocks);
    for (const p of paras) {
      if (!p.text.trim()) continue;
      rows.push([String(idx++), `第${page.pageNum}页`, p.text,
        { title: "标题", h1: "一级", h2: "二级", h3: "三级", body: "正文" }[p.level],
        String(p.text.length)]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 6 }, { wch: 8 }, { wch: 70 }, { wch: 6 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sn);
  return new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ================================================================
   PDF → PPTX（纯可编辑文本框，还原位置）
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
  pres.layout = "LAYOUT_WIDE"; // 13.33" × 7.5"

  const C = {
    primary: "2563eb",
    dark: "1e293b",
    gray: "64748b",
    light: "f1f5f9",
    white: "ffffff",
    accent: "f59e0b",
  };

  // ---- 封面 ----
  const cover = pres.addSlide();
  cover.background = { color: C.white };
  cover.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.08, fill: { color: C.primary } });
  cover.addText(fileName, {
    x: 0.8, y: 1.3, w: "85%", h: 1.2,
    fontSize: 32, bold: true, color: C.dark, align: "center", fontFace: "Microsoft YaHei",
  });
  cover.addShape(pres.ShapeType.rect, { x: 3.5, y: 2.7, w: 3, h: 0.04, fill: { color: C.accent } });
  cover.addText(`${pages.length} 页 · PDF工具箱转换 · ${new Date().toLocaleDateString("zh-CN")}`, {
    x: 0.8, y: 2.9, w: "85%", h: 0.6,
    fontSize: 14, color: C.gray, align: "center",
  });

  // ---- 内容页：每页渲染为可编辑文本框 ----
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const slide = pres.addSlide();
    slide.background = { color: C.white };

    // 顶部导航栏
    slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.06, fill: { color: C.primary } });
    slide.addText(`${pi + 1} / ${pages.length}`, {
      x: 0.2, y: 0.12, w: 0.8, h: 0.3,
      fontSize: 9, color: C.white, bold: true,
      align: "center", fill: { color: C.primary }, rectRadius: 0.06,
    });

    // 分析段落结构
    const paras = analyzeStructure(page.blocks);

    // 如果该页没有任何文字块，显示提示
    if (paras.length === 0) {
      slide.addText("（此页无可提取的文字内容，可能是扫描图片）", {
        x: 1, y: 2.5, w: "80%", h: 1,
        fontSize: 14, color: C.gray, align: "center",
      });
      continue;
    }

    // PDF→PPT 坐标缩放
    const scaleY = 5.0 / (page.pageHeight || 792);

    // 逐个段落放置独立文本框，沿 y 轴递增
    let cursorY = 0.6;

    for (const p of paras) {
      const pptFontSize = Math.max(Math.round(p.fontSize * scaleY * 0.75), 9);
      const isHeading = p.level === "title" || p.level === "h1" || p.level === "h2";
      const boxH = isHeading ? pptFontSize * 1.8 / 72 : pptFontSize * 1.5 / 72;

      if (cursorY + boxH > 5.5) break;

      slide.addText(p.text, {
        x: 0.3,
        y: cursorY,
        w: 9.4,
        h: boxH,
        fontSize: pptFontSize,
        color: isHeading ? C.dark : "374151",
        bold: isHeading || p.level === "h3",
        align: p.alignment === "center" ? "center" : "left",
        fontFace: isHeading ? "Microsoft YaHei" : "SimSun",
        valign: "top",
      });

      cursorY += boxH + 0.05;
    }
  }

  // ---- 尾页 ----
  const endSlide = pres.addSlide();
  endSlide.background = { color: C.dark };
  endSlide.addText("感谢使用 PDF 工具箱", {
    x: 0.5, y: 1.5, w: "90%", h: 1.0,
    fontSize: 32, bold: true, color: C.white, align: "center",
  });
  endSlide.addText("pdftoolbox.ltd", {
    x: 0.5, y: 2.8, w: "90%", h: 0.6,
    fontSize: 14, color: C.gray, align: "center",
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
