/**
 * 纯浏览器端 PDF 格式转换（深度优化版）
 * — Word：GB/T 9704 公文规范 + 智能结构识别
 * — PPT：封面/目录/内容/过渡/尾页 完整幻灯片体系
 * — Excel：样式化表格 + 多Sheet + 自动列宽
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Header, Footer, PageNumber,
  AlignmentType, convertMillimetersToTwip, LineRuleType,
  BorderStyle, Table, TableRow, TableCell, WidthType,
} from "docx";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";

/* ================================================================
   类型定义
   ================================================================ */

interface PageContent {
  pageNum: number;
  text: string;
  thumbnail: string | null;
}

/** Word 段落结构 */
interface DocSection {
  type: "title" | "subtitle" | "heading1" | "heading2" | "heading3" | "body" | "blank";
  text: string;
}

/* ================================================================
   文字提取（修复空格 + 提高缩略图质量）
   ================================================================ */

async function extractAllPages(
  buffer: ArrayBuffer,
  onProgress?: (msg: string) => void
): Promise<PageContent[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const total = pdf.numPages;
  const results: PageContent[] = [];

  for (let i = 1; i <= total; i++) {
    onProgress?.(`正在提取第 ${i}/${total} 页…`);
    const page = await pdf.getPage(i);

    // 文字 — 加上合理间距
    const textContent = await page.getTextContent();
    const items = textContent.items
      .filter((item) => "str" in item)
      .map((item) => (item as { str: string; height?: number; transform?: number[] }).str);

    // 智能拼合：检测空格/换行
    const text = smartJoinTextItems(items);

    // 缩略图（提高质量）
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

    results.push({ pageNum: i, text: text.trim(), thumbnail });
  }

  return results;
}

/** 智能拼合文字项 */
function smartJoinTextItems(items: string[]): string {
  if (items.length === 0) return "";

  let result = "";
  for (let i = 0; i < items.length; i++) {
    const curr = items[i];
    if (!curr) continue;

    // 前面的字符
    const prev = result[result.length - 1] || "";

    // 如果前一个是中文字符且当前是文字，不需要额外空格
    // 如果前一个是英文/数字，且当前是英文/数字，加空格
    const prevIsCJK = /[一-鿿　-〿＀-￯。，、；：？！「」『』（）]/.test(prev);
    const currIsCJK = /^[一-鿿　-〿＀-￯。，、；：？！「」『』（）]/.test(curr);

    if (result.length > 0 && !prevIsCJK && !currIsCJK && prev !== " " && curr !== " ") {
      result += " " + curr;
    } else {
      result += curr;
    }
  }

  return result;
}

/* ================================================================
   PDF → DOCX（公文规范 + 智能结构识别）
   ================================================================ */

export async function pdfToDocx(
  buffer: ArrayBuffer,
  originalName: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  onProgress?.("正在提取文字…");
  const pages = await extractAllPages(buffer, onProgress);
  const fullText = pages.map((p) => `[第${p.pageNum}页]\n${p.text}`).join("\n\n").trim();
  const fileName = originalName.replace(/\.pdf$/i, "");

  onProgress?.("正在分析文档结构…");

  // ---- 公文规格常量 ----
  const TITLE_FONT = "SimSun";
  const BODY_FONT = "FangSong";      // 英文名，Word 会自动匹配系统仿宋
  const HEI_FONT = "SimHei";
  const KAI_FONT = "KaiTi";
  const TITLE_SZ = 44;               // 二号 22pt
  const BODY_SZ = 32;                // 三号 16pt
  const SMALL_SZ = 28;               // 四号 14pt
  const LINE = 560;                  // 28磅 = 560 twips
  const INDENT = 480;                // 2字符

  // 页边距
  const PAGE_MARGIN = {
    top: convertMillimetersToTwip(37),
    bottom: convertMillimetersToTwip(35),
    left: convertMillimetersToTwip(28),
    right: convertMillimetersToTwip(26),
  };

  // ---- 智能结构分析 ----
  onProgress?.("正在排版…");
  const sections = parseDocumentStructure(fullText, fileName);

  // ---- 生成段落 ----
  const paragraphs = sectionsToParagraphs(sections, {
    titleFont: TITLE_FONT, titleSize: TITLE_SZ,
    bodyFont: BODY_FONT, bodySize: BODY_SZ,
    heiFont: HEI_FONT, kaiFont: KAI_FONT,
    smallSize: SMALL_SZ, line: LINE, indent: INDENT,
  });

  onProgress?.("正在生成 Word 文件…");

  const doc = new Document({
    title: fileName,
    description: `由 PDF 工具箱转换生成 — ${new Date().toLocaleDateString("zh-CN")}`,
    sections: [{
      properties: {
        page: {
          margin: PAGE_MARGIN,
          size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
        },
      },
      // 页眉：红色分隔线
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [new TextRun({ text: fileName, font: "FangSong", size: SMALL_SZ, color: "888888" })],
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              border: {
                bottom: { color: "CC0000", size: 6, space: 2, style: BorderStyle.SINGLE },
              },
              spacing: { before: 60 },
              children: [],
            }),
          ],
        }),
      },
      // 页脚
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              border: {
                top: { color: "999999", size: 1, space: 4, style: BorderStyle.SINGLE },
              },
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ children: ["— "], font: "SimSun", size: SMALL_SZ }),
                new TextRun({ children: [PageNumber.CURRENT], font: "SimSun", size: SMALL_SZ }),
                new TextRun({ children: [" —"], font: "SimSun", size: SMALL_SZ }),
              ],
            }),
          ],
        }),
      },
      children: paragraphs,
    }],
  });

  return Packer.toBlob(doc);
}

/** 解析文档结构 */
function parseDocumentStructure(raw: string, fileName: string): DocSection[] {
  const result: DocSection[] = [];
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return result;

  // 标题：取第一行（非页码标记行的最长行）
  const firstLine = lines.find((l) => !/^\[第\d+页\]/.test(l)) || lines[0];
  result.push({ type: "title", text: firstLine });

  // 添加生成信息副标题
  result.push({
    type: "subtitle",
    text: `（本文档由 PDF 工具箱从「${fileName}」转换生成）`,
  });
  result.push({ type: "blank", text: "" });

  // 正文：逐行分析
  const remaining = lines.filter((l) => l !== firstLine);

  for (const line of remaining) {
    const t = line.trim();
    if (!t) continue;

    // 页码标记 → 空行
    if (/^\[第\d+页\]$/.test(t)) {
      if (result.length > 0 && result[result.length - 1].type !== "blank") {
        result.push({ type: "blank", text: "" });
      }
      continue;
    }

    // 去掉页码前缀
    const clean = t.replace(/^\[第\d+页\]\s*/, "").trim();

    // 一级标题：一、二、三、... / 第X章 / 第X节
    if (/^(第[一二三四五六七八九十百千]+[章节条]|[一二三四五六七八九十]+[、，．])/.test(clean)) {
      result.push({ type: "heading1", text: clean });
      continue;
    }

    // 二级标题：（一）（二）... / 1.1 / 1.2
    if (/^(（[一二三四五六七八九十]+）|\d+\.\d+)/.test(clean)) {
      result.push({ type: "heading2", text: clean });
      continue;
    }

    // 三级标题：1. / (1) / ①
    if (/^(\d+[\.\)]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩])/.test(clean)) {
      result.push({ type: "heading3", text: clean });
      continue;
    }

    // 短行可能是标题（< 25 字且不含句号）
    if (clean.length < 25 && !/[。！？；]$/.test(clean) && clean.length > 3) {
      result.push({ type: "heading3", text: clean });
      continue;
    }

    // 正文 — 按标点合理断句
    const chunks = smartSplit(clean, 80);
    for (const chunk of chunks) {
      result.push({ type: "body", text: chunk });
    }
  }

  return result;
}

/** 按标点断句，每段控制在合理长度 */
function smartSplit(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const result: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      result.push(remaining);
      break;
    }

    // 在 maxLen 之前找最佳断点：句号 > 分号 > 逗号 > 空格
    const segment = remaining.slice(0, maxLen);
    let cut = maxLen;

    for (const sep of ["。", "；", "，", "、", " ", "）", "〕", "】"]) {
      const pos = segment.lastIndexOf(sep);
      if (pos > maxLen * 0.4) {
        cut = pos + 1;
        break;
      }
    }

    result.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  return result;
}

/** 结构 → Word 段落 */
function sectionsToParagraphs(
  sections: DocSection[],
  s: {
    titleFont: string; titleSize: number;
    bodyFont: string; bodySize: number;
    heiFont: string; kaiFont: string;
    smallSize: number; line: number; indent: number;
  }
): Paragraph[] {
  const result: Paragraph[] = [];

  for (const sec of sections) {
    switch (sec.type) {
      case "title":
        result.push(
          new Paragraph({
            children: [new TextRun({ text: sec.text, font: s.titleFont, size: s.titleSize, bold: true })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200, line: s.line },
          })
        );
        break;

      case "subtitle":
        result.push(
          new Paragraph({
            children: [new TextRun({ text: sec.text, font: s.kaiFont, size: s.smallSize, color: "888888" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 300, line: s.line },
          })
        );
        break;

      case "heading1":
        result.push(
          new Paragraph({
            children: [new TextRun({ text: sec.text, font: s.heiFont, size: s.bodySize, bold: true })],
            spacing: { before: 300, after: 120, line: s.line },
          })
        );
        break;

      case "heading2":
        result.push(
          new Paragraph({
            children: [new TextRun({ text: sec.text, font: s.kaiFont, size: s.bodySize, bold: true })],
            spacing: { before: 180, after: 80, line: s.line },
          })
        );
        break;

      case "heading3":
        result.push(
          new Paragraph({
            children: [new TextRun({ text: sec.text, font: s.bodyFont, size: s.bodySize, bold: true })],
            indent: { firstLine: s.indent },
            spacing: { before: 120, after: 40, line: s.line },
          })
        );
        break;

      case "body":
        result.push(
          new Paragraph({
            children: [new TextRun({ text: `　　${sec.text}`, font: s.bodyFont, size: s.bodySize })],
            alignment: AlignmentType.JUSTIFIED,
            spacing: { line: s.line, lineRule: LineRuleType.EXACT },
          })
        );
        break;

      case "blank":
        result.push(new Paragraph({ children: [], spacing: { after: 200 } }));
        break;
    }
  }

  return result;
}

/* ================================================================
   PDF → XLSX（样式化表格）
   ================================================================ */

export async function pdfToXlsx(
  buffer: ArrayBuffer,
  originalName: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  onProgress?.("正在提取文字…");
  const pages = await extractAllPages(buffer, onProgress);
  const fileName = originalName.replace(/\.pdf$/i, "");

  onProgress?.("正在生成 Excel…");

  const wsName = fileName.slice(0, 31);

  // 表头
  const headerRow = ["序号", "页码", "内容摘要", "字符数"];
  const dataRows = pages
    .filter((p) => p.text.length > 0)
    .map((p, i) => [
      String(i + 1),
      `第 ${p.pageNum} 页`,
      p.text.length > 100 ? p.text.slice(0, 100) + "…" : p.text,
      String(p.text.length),
    ]);

  const allRows = [headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);

  // 列宽
  ws["!cols"] = [
    { wch: 6 },   // 序号
    { wch: 10 },  // 页码
    { wch: 60 },  // 内容
    { wch: 10 },  // 字符数
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, wsName);

  // 如果文字多，加一个详细 sheet
  const hasDetail = pages.some((p) => p.text.length > 100);
  if (hasDetail) {
    const detailRows: string[][] = [["页码", "完整内容"]];
    for (const p of pages) {
      if (p.text) {
        detailRows.push([`第 ${p.pageNum} 页`, p.text]);
      }
    }
    const ws2 = XLSX.utils.aoa_to_sheet(detailRows);
    ws2["!cols"] = [{ wch: 10 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, ws2, "完整内容");
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/* ================================================================
   PDF → PPTX（完整幻灯片体系）
   ================================================================ */

export async function pdfToPptx(
  buffer: ArrayBuffer,
  originalName: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  onProgress?.("正在提取文字和图片…");
  const pages = await extractAllPages(buffer, onProgress);
  const fileName = originalName.replace(/\.pdf$/i, "");
  const validPages = pages.filter((p) => p.text || p.thumbnail);

  onProgress?.("正在设计幻灯片…");

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "PDF工具箱";

  // === 配色体系 ===
  const C = {
    blue: "2563eb",
    blueLight: "dbeafe",
    blueDark: "1e3a5f",
    indigo: "4338ca",
    teal: "0d9488",
    orange: "ea580c",
    slate: "1e293b",
    gray: "64748b",
    white: "ffffff",
    offWhite: "f8fafc",
    border: "e2e8f0",
  };

  // === 封面 ===
  addCoverSlide(pres, fileName, pages.length, C);

  // === 目录 ===
  if (validPages.length >= 3) {
    addTocSlide(pres, validPages, C);
  }

  // === 内容页 ===
  for (let idx = 0; idx < validPages.length; idx++) {
    const page = validPages[idx];
    // 每 5 页插入过渡页
    if (idx > 0 && idx % 5 === 0) {
      addTransitionSlide(pres, idx, validPages.length, C);
    }
    addContentSlide(pres, page, idx + 1, validPages.length, C);
  }

  // === 尾页 ===
  addEndSlide(pres, C);

  onProgress?.("正在生成 PPT…");
  return (await pres.write({ outputType: "blob" })) as Blob;
}

/** 封面 */
function addCoverSlide(
  pres: PptxGenJS,
  title: string,
  totalPages: number,
  C: Record<string, string>
) {
  const slide = pres.addSlide();
  // 渐变背景（用双色矩形模拟）
  slide.background = { color: C.blueDark };
  // 装饰条
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: "100%", h: 0.08,
    fill: { color: C.orange },
  });
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0.08, w: "100%", h: 0.04,
    fill: { color: C.blue },
  });
  // 主标题
  slide.addText(title, {
    x: 0.8, y: 1.2, w: "85%", h: 1.6,
    fontSize: 36, bold: true, color: C.white,
    align: "center", valign: "middle",
  });
  // 装饰线
  slide.addShape(pres.ShapeType.rect, {
    x: 3.5, y: 3.0, w: 3.0, h: 0.04,
    fill: { color: C.orange },
  });
  // 副标题
  slide.addText(`共 ${totalPages} 页 · ${new Date().toLocaleDateString("zh-CN")} 转换`, {
    x: 0.8, y: 3.2, w: "85%", h: 0.6,
    fontSize: 16, color: "94a3b8",
    align: "center",
  });
  slide.addText("pdf-toolbox.vercel.app", {
    x: 0.8, y: 4.5, w: "85%", h: 0.5,
    fontSize: 12, color: "64748b",
    align: "center",
  });
}

/** 目录 */
function addTocSlide(
  pres: PptxGenJS,
  pages: PageContent[],
  C: Record<string, string>
) {
  const slide = pres.addSlide();
  slide.background = { color: C.offWhite };
  slide.addText("目  录", {
    x: 0.8, y: 0.4, w: 4, h: 0.7,
    fontSize: 24, bold: true, color: C.slate,
  });
  slide.addShape(pres.ShapeType.rect, {
    x: 0.8, y: 1.15, w: 2.0, h: 0.04,
    fill: { color: C.blue },
  });

  // 目录项
  const items = pages.slice(0, 12); // 最多 12 项
  const colCount = items.length > 6 ? 2 : 1;
  for (let i = 0; i < items.length; i++) {
    const col = i < (colCount === 2 ? 6 : items.length) ? 0 : 1;
    const row = col === 0 ? i : i - 6;
    const x = col === 0 ? 0.8 : 5.3;

    const p = items[i];
    const preview = (p.text || "").slice(0, 30) || "（扫描页）";

    slide.addText(`${p.pageNum}. ${preview}${p.text.length > 30 ? "…" : ""}`, {
      x, y: 1.5 + row * 0.52, w: 4.2, h: 0.45,
      fontSize: 12, color: C.slate,
      bullet: false,
    });
  }
}

/** 过渡页 */
function addTransitionSlide(
  pres: PptxGenJS,
  completed: number,
  total: number,
  C: Record<string, string>
) {
  const slide = pres.addSlide();
  slide.background = { color: C.indigo };
  slide.addText(`${completed} / ${total}`, {
    x: 0.5, y: 1.5, w: "90%", h: 1.2,
    fontSize: 48, bold: true, color: C.white,
    align: "center",
  });
  slide.addText("继续浏览…", {
    x: 0.5, y: 2.8, w: "90%", h: 0.6,
    fontSize: 18, color: "a5b4fc",
    align: "center",
  });
}

/** 内容页 */
function addContentSlide(
  pres: PptxGenJS,
  page: PageContent,
  pageIndex: number,
  total: number,
  C: Record<string, string>
) {
  const slide = pres.addSlide();
  slide.background = { color: C.white };

  // 顶部导航栏
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: "100%", h: 0.06,
    fill: { color: C.blue },
  });

  // 页码徽章
  slide.addText(`${pageIndex}`, {
    x: 0.3, y: 0.2, w: 0.6, h: 0.55,
    fontSize: 18, bold: true, color: C.white,
    align: "center", valign: "middle",
    fill: { color: C.blue },
    rectRadius: 0.1,
  });

  // 进度条
  const pct = Math.round((pageIndex / total) * 100);
  slide.addText(`${pct}%`, {
    x: 8.8, y: 0.2, w: 0.8, h: 0.35,
    fontSize: 10, color: C.gray, align: "right",
  });

  // 缩略图（如果存在）
  if (page.thumbnail) {
    slide.addImage({
      data: page.thumbnail,
      x: 0.3, y: 0.9, w: 4.2, h: 4.5,
      sizing: { type: "contain", w: 4.2, h: 4.5 },
      rounding: true,
    });
  }

  // 文字区域
  const textX = page.thumbnail ? 4.8 : 0.5;
  const textW = page.thumbnail ? 4.7 : 9.0;

  if (page.text) {
    // 提取首句作为标题
    const sentences = page.text.split(/[。；]/);
    const keyTitle = sentences[0]?.slice(0, 40) || "";

    if (keyTitle) {
      slide.addText(keyTitle, {
        x: textX, y: 0.9, w: textW, h: 0.5,
        fontSize: 14, bold: true, color: C.slate,
      });
    }

    // 正文
    const body = page.text.length > 1200 ? page.text.slice(0, 1200) + " …" : page.text;
    const bodyY = keyTitle ? 1.5 : 0.9;

    slide.addText(body, {
      x: textX, y: bodyY, w: textW, h: 4.0,
      fontSize: 10.5, color: C.gray,
      valign: "top", lineSpacing: 16,
    });
  }

  // 底部信息
  slide.addShape(pres.ShapeType.rect, {
    x: 0.3, y: 5.7, w: 9.4, h: 0.01,
    fill: { color: C.border },
  });
  slide.addText(`第 ${page.pageNum} 页  ·  由 PDF工具箱 转换`, {
    x: 0.3, y: 5.72, w: 9.4, h: 0.3,
    fontSize: 8, color: C.gray, align: "center",
  });
}

/** 尾页 */
function addEndSlide(pres: PptxGenJS, C: Record<string, string>) {
  const slide = pres.addSlide();
  slide.background = { color: C.slate };

  slide.addText("感谢使用", {
    x: 0.5, y: 1.2, w: "90%", h: 0.8,
    fontSize: 36, bold: true, color: C.white,
    align: "center",
  });
  slide.addText("PDF 工具箱", {
    x: 0.5, y: 2.0, w: "90%", h: 1.0,
    fontSize: 44, bold: true, color: C.orange,
    align: "center",
  });

  slide.addShape(pres.ShapeType.rect, {
    x: 3.8, y: 3.2, w: 2.4, h: 0.04,
    fill: { color: C.gray },
  });

  slide.addText("pdf-toolbox.vercel.app\n免费 · 安全 · 高效", {
    x: 0.5, y: 3.5, w: "90%", h: 1.0,
    fontSize: 14, color: C.gray,
    align: "center", lineSpacing: 22,
  });
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
