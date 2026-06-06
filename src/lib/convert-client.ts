/**
 * 纯浏览器端 PDF 格式转换
 * 文字提取 → 纯 JS 生成目标格式 → 下载
 * 零依赖服务端，Vercel 完美兼容
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";

/** 提取的页面内容 */
interface PageContent {
  pageNum: number;
  text: string;
}

/** 从 PDF 提取所有页面文字 */
async function extractAllPages(buffer: ArrayBuffer): Promise<PageContent[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const results: PageContent[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item) => "str" in item)
      .map((item) => (item as { str: string }).str)
      .join(" ");
    results.push({ pageNum: i, text: text.trim() });
  }

  return results;
}

/** PDF → DOCX */
export async function pdfToDocx(buffer: ArrayBuffer): Promise<Blob> {
  const pages = await extractAllPages(buffer);

  const paragraphs: Paragraph[] = [];

  for (const page of pages) {
    if (page.text) {
      // 页面标题
      paragraphs.push(
        new Paragraph({
          text: `第 ${page.pageNum} 页`,
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        })
      );
      // 页面内容
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: page.text, size: 22 })],
          spacing: { after: 150 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  return Packer.toBlob(doc);
}

/** PDF → XLSX（每页一行，提取键值对） */
export async function pdfToXlsx(buffer: ArrayBuffer): Promise<Blob> {
  const pages = await extractAllPages(buffer);

  const rows: string[][] = [["页码", "内容"]];

  for (const page of pages) {
    if (page.text) {
      rows.push([`第 ${page.pageNum} 页`, page.text]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  // 设置列宽
  ws["!cols"] = [{ wch: 12 }, { wch: 80 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PDF导出");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** PDF → PPTX（每页一张幻灯片） */
export async function pdfToPptx(buffer: ArrayBuffer): Promise<Blob> {
  const pages = await extractAllPages(buffer);

  const pres = new PptxGenJS();

  for (const page of pages) {
    if (!page.text) continue;

    const slide = pres.addSlide();
    slide.addText(`第 ${page.pageNum} 页`, {
      x: 0.5, y: 0.2, w: "90%", h: 0.4,
      fontSize: 14, bold: true, color: "666666",
    });

    // 截取前 2000 字符，防止单页文字太多
    const content = page.text.length > 2000 ? page.text.slice(0, 2000) + "…" : page.text;
    slide.addText(content, {
      x: 0.5, y: 0.7, w: "90%", h: 6,
      fontSize: 12, valign: "top",
    });
  }

  return (await pres.write({ outputType: "blob" })) as Blob;
}

/** 触发下载 */
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
