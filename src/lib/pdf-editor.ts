/**
 * PDF 编辑器引擎 v2 — 文字级高亮 + 原位文字标注
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/* ================================================================
   类型
   ================================================================ */

export interface TextAnnotation {
  id: string;
  pageNum: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

export interface HighlightRange {
  id: string;
  pageNum: number;
  /** 高亮矩形的每个 segment（一行可能多个矩形） */
  rects: { x: number; y: number; w: number; h: number }[];
  color: string;
}

/** getTextContent 返回的精确文字块 */
export interface TextItem {
  text: string;
  x: number;   // canvas 坐标
  y: number;
  w: number;
  h: number;
  fontSize: number;
}

/* ================================================================
   页面渲染 + 文字提取
   ================================================================ */

export async function renderPage(
  buffer: ArrayBuffer,
  pageNum: number,
  canvas: HTMLCanvasElement,
  scale: number = 1.5
): Promise<{ width: number; height: number; textItems: TextItem[] }> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";

  const dataCopy = buffer.slice(0);
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(dataCopy),
    disableAutoFetch: true,
  }).promise;

  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;

  // 提取文字块（用于精确高亮匹配）
  const tc = await page.getTextContent();
  const textItems: TextItem[] = [];

  for (const item of tc.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const t = item.transform;

    textItems.push({
      text: item.str,
      x: t[4] * scale,
      y: (viewport.height - t[5]) * scale - (item.height || 0) * scale,
      w: (item.width || 0) * scale,
      h: (item.height || Math.abs(t[3])) * scale,
      fontSize: Math.abs(t[3]) * scale,
    });
  }

  return { width: viewport.width, height: viewport.height, textItems };
}

export async function getTotalPages(buffer: ArrayBuffer): Promise<number> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";
  const dataCopy = buffer.slice(0);
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(dataCopy),
    disableAutoFetch: true,
  }).promise;
  return pdf.numPages;
}

/* ================================================================
   高亮匹配：根据鼠标拖拽区域 → 找出覆盖的文字块
   ================================================================ */

export function findHighlightRects(
  selectionBox: { x: number; y: number; w: number; h: number },
  textItems: TextItem[]
): { x: number; y: number; w: number; h: number }[] {
  const sx1 = selectionBox.x;
  const sy1 = selectionBox.y;
  const sx2 = selectionBox.x + selectionBox.w;
  const sy2 = selectionBox.y + selectionBox.h;

  const matched = textItems.filter((t) => {
    const tx2 = t.x + t.w;
    const ty2 = t.y + t.h;
    // 文字块与选区有交集
    return t.x < sx2 && tx2 > sx1 && t.y < sy2 && ty2 > sy1;
  });

  if (matched.length === 0) return [];

  // 合并同一行的文字块为连续矩形
  matched.sort((a, b) => a.y - b.y || a.x - b.x);
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  let curX = matched[0].x, curY = matched[0].y, curW = matched[0].w, curH = matched[0].h;
  let baseY = matched[0].y;

  for (let i = 1; i < matched.length; i++) {
    const t = matched[i];
    if (Math.abs(t.y - baseY) < curH * 0.5
        && t.x - (curX + curW) < t.fontSize * 2) {
      const x2 = Math.max(curX + curW, t.x + t.w);
      curW = x2 - curX;
      curY = Math.min(curY, t.y);
      curH = Math.max(curH, t.h);
    } else {
      rects.push({ x: curX, y: curY, w: curW, h: curH });
      curX = t.x; curY = t.y; curW = t.w; curH = t.h;
      baseY = t.y;
    }
  }
  rects.push({ x: curX, y: curY, w: curW, h: curH });

  return rects;
}

/* ================================================================
   保存
   ================================================================ */

export async function saveEditedPDF(
  buffer: ArrayBuffer,
  textAnnos: TextAnnotation[],
  highlights: HighlightRange[],
  scale: number = 1.5
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  for (const anno of textAnnos) {
    const page = pages[anno.pageNum - 1];
    if (!page) continue;
    const { height } = page.getSize();
    const pdfX = anno.x / scale;
    const pdfY = height - anno.y / scale - anno.fontSize / scale * 0.5;
    const c = hexToRgb(anno.color);
    page.drawText(anno.text, {
      x: Math.max(pdfX, 10),
      y: Math.max(pdfY, 10),
      size: anno.fontSize / scale * 0.75,
      font,
      color: rgb(c.r, c.g, c.b),
    });
  }

  for (const hl of highlights) {
    const page = pages[hl.pageNum - 1];
    if (!page) continue;
    const { height: ph } = page.getSize();
    const c = hexToRgb(hl.color);

    for (const r of hl.rects) {
      const x = r.x / scale;
      const y = ph - r.y / scale - r.h / scale;
      page.drawRectangle({
        x: Math.max(x, 0),
        y: Math.max(y, 0),
        width: r.w / scale,
        height: r.h / scale,
        color: rgb(c.r, c.g, c.b),
        opacity: 0.35,
      });
    }
  }

  return pdfDoc.save();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const c = hex.replace("#", "");
  return {
    r: parseInt(c.slice(0, 2), 16) / 255,
    g: parseInt(c.slice(2, 4), 16) / 255,
    b: parseInt(c.slice(4, 6), 16) / 255,
  };
}
