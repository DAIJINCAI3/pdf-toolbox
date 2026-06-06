/**
 * PDF 文档编辑器
 * 文本添加 + 高亮标注，编辑后合并回原 PDF
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/* ================================================================
   类型
   ================================================================ */

export interface TextAnnotation {
  id: string;
  pageNum: number;
  text: string;
  x: number; // Canvas 坐标
  y: number;
  fontSize: number;
  color: string;
}

export interface HighlightRect {
  id: string;
  pageNum: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string; // 半透明黄
  opacity: number;
}

export interface PageInfo {
  pageNum: number;
  width: number;
  height: number;
}

/* ================================================================
   页面渲染
   ================================================================ */

export async function renderPage(
  buffer: ArrayBuffer,
  pageNum: number,
  canvas: HTMLCanvasElement,
  scale: number = 1.5
): Promise<PageInfo> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
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

  return {
    pageNum,
    width: viewport.width,
    height: viewport.height,
  };
}

export async function getTotalPages(buffer: ArrayBuffer): Promise<number> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableAutoFetch: true,
  }).promise;
  return pdf.numPages;
}

/* ================================================================
   保存：把标注合并到原 PDF
   ================================================================ */

export async function saveEditedPDF(
  buffer: ArrayBuffer,
  textAnnos: TextAnnotation[],
  highlightRects: HighlightRect[],
  scale: number = 1.5
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pages = pdfDoc.getPages();

  // 合并文本标注
  for (const anno of textAnnos) {
    const pageIdx = anno.pageNum - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;

    const page = pages[pageIdx];
    const { width, height } = page.getSize(); // PDF 坐标 (pt)

    // Canvas → PDF 坐标转换
    const pdfX = (anno.x / scale);
    const pdfY = height - (anno.y / scale) - 20;

    const color = hexToRgb(anno.color);

    page.drawText(anno.text, {
      x: Math.max(pdfX, 10),
      y: Math.max(pdfY, 10),
      size: anno.fontSize / scale * 0.75,
      font: fontBold,
      color: rgb(color.r, color.g, color.b),
    });
  }

  // 合并高亮矩形
  for (const rect of highlightRects) {
    const pageIdx = rect.pageNum - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;

    const page = pages[pageIdx];
    const { height } = page.getSize();

    const pdfX = (rect.x / scale);
    const pdfY = height - (rect.y / scale) - (rect.h / scale);

    const color = hexToRgb(rect.color);

    page.drawRectangle({
      x: Math.max(pdfX, 0),
      y: Math.max(pdfY, 0),
      width: rect.w / scale,
      height: rect.h / scale,
      color: rgb(color.r, color.g, color.b),
      opacity: rect.opacity,
    });
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
