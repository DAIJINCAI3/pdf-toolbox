import { PDFDocument } from "pdf-lib";

/**
 * 将多个 PDF 文件合并为一个
 * @param files - PDF 文件数组，按想要的顺序排列
 * @returns 合并后的 PDF 文件（Uint8Array 格式）
 */
export async function mergePDFs(files: File[]): Promise<Uint8Array> {
  const mergedDoc = await PDFDocument.create();

  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    const sourceDoc = await PDFDocument.load(arrayBuffer);
    const pages = await mergedDoc.copyPages(sourceDoc, sourceDoc.getPageIndices());
    pages.forEach((page) => mergedDoc.addPage(page));
  }

  return mergedDoc.save();
}

/**
 * 触发浏览器下载 PDF 文件
 */
export function downloadPDF(data: Uint8Array, filename: string): void {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
