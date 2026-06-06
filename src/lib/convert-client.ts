/**
 * 纯浏览器端 PDF 格式转换
 * — 公文规范排版 Word / 美观 PPT / 整洁 Excel
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Header, Footer, PageNumber, NumberFormat,
  AlignmentType, convertMillimetersToTwip, LineRuleType,
} from "docx";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";

/* ================================================================
   文字提取
   ================================================================ */

interface PageContent {
  pageNum: number;
  text: string;
  thumbnail: string | null; // 缩略图 base64
}

async function extractAllPages(buffer: ArrayBuffer): Promise<PageContent[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const results: PageContent[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    // 文字
    const content = await page.getTextContent();
    const text = content.items
      .filter((item) => "str" in item)
      .map((item) => (item as { str: string }).str)
      .join("");

    // 缩略图（小尺寸）
    let thumbnail: string | null = null;
    try {
      const vp = page.getViewport({ scale: 0.5 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport: vp }).promise;
      thumbnail = canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      // 缩略图失败不影响主流程
    }

    results.push({ pageNum: i, text: text.trim(), thumbnail });
  }

  return results;
}

/* ================================================================
   PDF → DOCX（公文规范格式 GB/T 9704-2012）
   ================================================================ */

export async function pdfToDocx(buffer: ArrayBuffer, originalName: string): Promise<Blob> {
  const pages = await extractAllPages(buffer);

  // 合并所有页面文字
  const fullText = pages.map((p) => p.text).join("\n").trim();
  const fileName = originalName.replace(/\.pdf$/i, "");

  // ---- 公文排版常量 ----
  const CM_FONT = "仿宋";
  const CM_FONT_GB = "仿宋_GB2312";
  const HEI_FONT = "SimHei";      // 黑体（一级标题）
  const KAI_FONT = "KaiTi";       // 楷体（二级标题）
  const SONG_FONT = "SimSun";     // 宋体（标题）
  const TITLE_SIZE = 44;          // 二号 = 22pt = 44 half-pts
  const BODY_SIZE = 32;           // 三号 = 16pt = 32 half-pts
  const LINE_SPACING = 560;       // 28磅固定行距 (28 * 20 = 560 twips)
  const INDENT_CHARS = 480;       // 2 字符缩进 (约 480 twips)

  // 页边距 (mm → twips)
  const topMargin = convertMillimetersToTwip(37);
  const bottomMargin = convertMillimetersToTwip(35);
  const leftMargin = convertMillimetersToTwip(28);
  const rightMargin = convertMillimetersToTwip(26);

  // ---- 智能分段 ----
  const paragraphs = buildOfficialParagraphs(fullText, {
    titleFont: SONG_FONT,
    titleSize: TITLE_SIZE,
    bodyFont: CM_FONT_GB,
    bodySize: BODY_SIZE,
    heiFont: HEI_FONT,
    kaiFont: KAI_FONT,
    lineSpacing: LINE_SPACING,
    indent: INDENT_CHARS,
  });

  const doc = new Document({
    title: fileName,
    styles: {
      default: {
        document: {
          run: { font: CM_FONT_GB, size: BODY_SIZE },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: topMargin, bottom: bottomMargin, left: leftMargin, right: rightMargin },
          size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            text: fileName,
            alignment: AlignmentType.CENTER,
            style: "Header",
            border: { bottom: { color: "999999", size: 1, space: 4, style: "single" } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: [PageNumber.CURRENT], font: SONG_FONT, size: 28 })],
          })],
        }),
      },
      children: paragraphs,
    }],
  });

  return Packer.toBlob(doc);
}

/** 智能分段：识别标题、一级/二级标题 */
function buildOfficialParagraphs(
  raw: string,
  s: {
    titleFont: string; titleSize: number;
    bodyFont: string; bodySize: number;
    heiFont: string; kaiFont: string;
    lineSpacing: number; indent: number;
  }
): Paragraph[] {
  const result: Paragraph[] = [];
  const lines = raw.split(/\n+/).filter((l) => l.trim());

  if (lines.length === 0) return result;

  // 第一行作为标题
  result.push(
    new Paragraph({
      children: [new TextRun({ text: lines[0], font: s.titleFont, size: s.titleSize, bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 560, line: s.lineSpacing },
    })
  );

  // 后续行：智能识别结构
  const rest = lines.slice(1);

  for (const line of rest) {
    const trimmed = line.trim();
    if (trimmed.length < 3) continue;

    // 一级标题（一、二、三、…）
    if (/^[一二三四五六七八九十]+[、，．]/.test(trimmed)) {
      result.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, font: s.heiFont, size: s.bodySize, bold: true })],
          spacing: { before: 280, after: 140, line: s.lineSpacing },
        })
      );
      continue;
    }

    // 二级标题（（一）（二）…）
    if (/^（[一二三四五六七八九十]+）/.test(trimmed)) {
      result.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, font: s.kaiFont, size: s.bodySize, bold: true })],
          spacing: { before: 140, after: 70, line: s.lineSpacing },
        })
      );
      continue;
    }

    // 普通正文段落
    result.push(
      new Paragraph({
        children: [new TextRun({ text: trimmed, font: s.bodyFont, size: s.bodySize })],
        indent: { firstLine: s.indent },
        alignment: AlignmentType.JUSTIFIED,
        spacing: { line: s.lineSpacing, lineRule: LineRuleType.EXACT },
      })
    );
  }

  return result;
}

/* ================================================================
   PDF → XLSX（整洁表格）
   ================================================================ */

export async function pdfToXlsx(buffer: ArrayBuffer, originalName: string): Promise<Blob> {
  const pages = await extractAllPages(buffer);
  const fileName = originalName.replace(/\.pdf$/i, "");

  const wsName = fileName.length > 28 ? fileName.slice(0, 28) : fileName;

  const rows: string[][] = [["页码", "内容"]];

  for (const page of pages) {
    if (page.text) {
      rows.push([`第 ${page.pageNum} 页`, page.text]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 12 }, { wch: 80 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, wsName);

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/* ================================================================
   PDF → PPTX（美观设计）
   ================================================================ */

export async function pdfToPptx(buffer: ArrayBuffer, originalName: string): Promise<Blob> {
  const pages = await extractAllPages(buffer);
  const fileName = originalName.replace(/\.pdf$/i, "");

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "PDF工具箱";
  pres.title = fileName;

  // 配色方案
  const colors = {
    primary: "1a56db",
    accent: "f59e0b",
    dark: "1f2937",
    light: "f3f4f6",
    white: "ffffff",
    muted: "6b7280",
  };

  // ---- 封面 ----
  const cover = pres.addSlide();
  cover.background = { color: colors.primary };
  cover.addText(fileName, {
    x: 0.5, y: 1.0, w: "90%", h: 1.5,
    fontSize: 32, bold: true, color: colors.white,
    align: "center", valign: "middle",
  });
  cover.addText(`共 ${pages.length} 页 · 由 PDF工具箱 转换`, {
    x: 0.5, y: 2.8, w: "90%", h: 0.5,
    fontSize: 14, color: "a5c8ff",
    align: "center",
  });

  // ---- 内容页 ----
  for (const page of pages) {
    if (!page.text && !page.thumbnail) continue;

    const slide = pres.addSlide();
    slide.background = { color: colors.white };

    // 页码徽章
    slide.addText(`第 ${page.pageNum} 页`, {
      x: 0.3, y: 0.15, w: 1.2, h: 0.35,
      fontSize: 10, color: colors.white, bold: true,
      align: "center", fill: { color: colors.primary },
      rectRadius: 0.1,
    });

    // 如果有缩略图，放在左侧
    if (page.thumbnail) {
      slide.addImage({
        data: page.thumbnail, x: 0.3, y: 0.7, w: 3.5, h: 4.2,
        sizing: { type: "contain", w: 3.5, h: 4.2 },
        rounding: true,
      });
    }

    // 文字在右侧
    const textX = page.thumbnail ? 4.2 : 0.5;
    const textW = page.thumbnail ? "58%" : "90%";

    if (page.text) {
      const display = page.text.length > 1500 ? page.text.slice(0, 1500) + " …" : page.text;

      slide.addText(display, {
        x: textX, y: 0.7, w: textW, h: 4.8,
        fontSize: 11, color: colors.dark,
        valign: "top", lineSpacing: 18,
      });
    }

    // 底部分隔线
    slide.addShape(pres.ShapeType.rect, {
      x: 0.5, y: 5.5, w: "92%", h: 0.02,
      fill: { color: "e5e7eb" },
    });
  }

  // ---- 尾页 ----
  const endSlide = pres.addSlide();
  endSlide.background = { color: colors.dark };
  endSlide.addText("感谢使用 PDF工具箱", {
    x: 0.5, y: 1.5, w: "90%", h: 1.0,
    fontSize: 28, bold: true, color: colors.white,
    align: "center",
  });
  endSlide.addText("pdf-toolbox.vercel.app", {
    x: 0.5, y: 2.8, w: "90%", h: 0.6,
    fontSize: 16, color: colors.muted,
    align: "center",
  });

  return (await pres.write({ outputType: "blob" })) as Blob;
}

/* ================================================================
   下载工具
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
