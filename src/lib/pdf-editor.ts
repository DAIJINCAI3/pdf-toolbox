/**
 * PDF 编辑器引擎 v3 — 现代标注系统
 * 文字选中+浮动工具栏 / 自由画笔 / 便签 / 撤销重做
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

export interface MarkAnnotation {
  id: string;
  pageNum: number;
  type: "highlight" | "underline" | "strikethrough";
  rects: { x: number; y: number; w: number; h: number }[];
  color: string;
}

export interface PenStroke {
  id: string;
  pageNum: number;
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

export interface TextItem {
  text: string;
  x: number; y: number; w: number; h: number; fontSize: number;
}

/* ================================================================
   渲染
   ================================================================ */

export async function renderPage(
  buffer: ArrayBuffer, pageNum: number, canvas: HTMLCanvasElement, scale = 1.5
): Promise<{ width: number; height: number; textItems: TextItem[] }> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)), disableAutoFetch: true }).promise;
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale });
  canvas.width = vp.width; canvas.height = vp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp }).promise;

  const tc = await page.getTextContent();
  const items: TextItem[] = [];
  for (const item of tc.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const t = item.transform;
    items.push({ text: item.str, x: t[4] * scale, y: (vp.height - t[5]) * scale - (item.height || 0) * scale, w: (item.width || 0) * scale, h: (item.height || Math.abs(t[3])) * scale, fontSize: Math.abs(t[3]) * scale });
  }
  return { width: vp.width, height: vp.height, textItems: items };
}

export async function getTotalPages(buffer: ArrayBuffer): Promise<number> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)), disableAutoFetch: true }).promise;
  return pdf.numPages;
}

/* ================================================================
   文字匹配高亮矩形
   ================================================================ */

export function findMarkRects(
  sel: { x: number; y: number; w: number; h: number },
  items: TextItem[]
): { x: number; y: number; w: number; h: number }[] {
  const sx2 = sel.x + sel.w, sy2 = sel.y + sel.h;
  const matched = items.filter(t => {
    const tx2 = t.x + t.w, ty2 = t.y + t.h;
    return t.x < sx2 && tx2 > sel.x && t.y < sy2 && ty2 > sel.y;
  });
  if (!matched.length) return [];

  matched.sort((a, b) => a.y - b.y || a.x - b.x);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  let cx = matched[0].x, cy = matched[0].y, cw = matched[0].w, ch = matched[0].h, by = matched[0].y;
  for (let i = 1; i < matched.length; i++) {
    const t = matched[i];
    if (Math.abs(t.y - by) < ch * 0.5 && t.x - (cx + cw) < t.fontSize * 2) {
      cw = Math.max(cx + cw, t.x + t.w) - cx; cy = Math.min(cy, t.y); ch = Math.max(ch, t.h);
    } else {
      out.push({ x: cx, y: cy, w: cw, h: ch }); cx = t.x; cy = t.y; cw = t.w; ch = t.h; by = t.y;
    }
  }
  out.push({ x: cx, y: cy, w: cw, h: ch });
  return out;
}

/* ================================================================
   保存
   ================================================================ */

export async function saveEditedPDF(
  buffer: ArrayBuffer, texts: TextAnnotation[], marks: MarkAnnotation[],
  strokes: PenStroke[], scale = 1.5
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  for (const a of texts) {
    const pg = pages[a.pageNum - 1]; if (!pg) continue;
    const { height: ph } = pg.getSize();
    const c = hexRgb(a.color);
    pg.drawText(a.text, { x: Math.max(a.x / scale, 10), y: Math.max(ph - a.y / scale - a.fontSize / scale * 0.5, 10), size: a.fontSize / scale * 0.75, font, color: rgb(c.r, c.g, c.b) });
  }

  for (const m of marks) {
    const pg = pages[m.pageNum - 1]; if (!pg) continue;
    const { height: ph } = pg.getSize();
    const c = hexRgb(m.color);
    for (const r of m.rects) {
      const x = r.x / scale, w = r.w / scale, y = ph - r.y / scale - r.h / scale, h = r.h / scale;
      if (m.type === "highlight") { pg.drawRectangle({ x, y, width: w, height: h, color: rgb(c.r, c.g, c.b), opacity: 0.35 }); }
      if (m.type === "underline") { pg.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 2, color: rgb(c.r, c.g, c.b) }); }
      if (m.type === "strikethrough") { const mid = y + h / 2; pg.drawLine({ start: { x, y: mid }, end: { x: x + w, y: mid }, thickness: 2, color: rgb(c.r, c.g, c.b) }); }
    }
  }

  for (const s of strokes) {
    const pg = pages[s.pageNum - 1]; if (!pg || s.points.length < 2) continue;
    const { height: ph } = pg.getSize();
    const c = hexRgb(s.color);
    for (let i = 1; i < s.points.length; i++) {
      const p0 = s.points[i - 1], p1 = s.points[i];
      pg.drawLine({ start: { x: p0.x / scale, y: ph - p0.y / scale }, end: { x: p1.x / scale, y: ph - p1.y / scale }, thickness: s.width / scale, color: rgb(c.r, c.g, c.b), opacity: 0.8 });
    }
  }

  return doc.save();
}

function hexRgb(h: string) { const c = h.replace("#", ""); return { r: parseInt(c.slice(0, 2), 16) / 255, g: parseInt(c.slice(2, 4), 16) / 255, b: parseInt(c.slice(4, 6), 16) / 255 }; }
