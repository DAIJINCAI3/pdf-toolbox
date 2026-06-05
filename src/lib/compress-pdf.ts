import { PDFDocument } from "pdf-lib";

/**
 * 压缩 PDF 文件
 * 原理：遍历所有页面，移除未使用的对象和冗余数据
 * @param file - 源 PDF 文件
 * @returns 压缩后的 PDF（Uint8Array 格式）
 */
export async function compressPDF(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  // pdf-lib 的 save() 会移除未引用对象，清理冗余数据
  const compressedBytes = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
  });

  return compressedBytes;
}

/**
 * 格式化文件大小为可读字符串
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
