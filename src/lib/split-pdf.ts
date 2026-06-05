import { PDFDocument } from "pdf-lib";

/**
 * 从 PDF 中提取指定页面生成新 PDF
 * @param file - 源 PDF 文件
 * @param pageIndices - 要保留的页面序号（从 0 开始，例如 [0, 2, 3]）
 * @returns 拆分后的 PDF（Uint8Array 格式）
 */
export async function splitPDF(
  file: File,
  pageIndices: number[]
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const sourceDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = sourceDoc.getPageCount();

  // 过滤掉超出范围的页码
  const validIndices = pageIndices.filter((i) => i >= 0 && i < totalPages);

  if (validIndices.length === 0) {
    throw new Error("没有选中有效页面");
  }

  const newDoc = await PDFDocument.create();
  const pages = await newDoc.copyPages(sourceDoc, validIndices);
  pages.forEach((page) => newDoc.addPage(page));

  return newDoc.save();
}
