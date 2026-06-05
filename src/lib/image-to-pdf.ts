import { jsPDF } from "jspdf";

/**
 * 将多张图片打包为一个 PDF 文件（A4 页面，居中适配）
 * @param files - 图片文件数组，顺序即 PDF 页面顺序
 * @returns PDF 文件的 Blob
 */
export async function imagesToPDF(files: File[]): Promise<Blob> {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // 将图片文件转为 DataURL
    const dataUrl = await fileToDataURL(file);

    // 根据文件类型选择正确的图片格式
    const format = getImageFormat(file.type);

    if (i > 0) {
      pdf.addPage();
    }

    const imgProps = pdf.getImageProperties(dataUrl);
    const imgRatio = imgProps.width / imgProps.height;
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2;

    let drawW = maxW;
    let drawH = drawW / imgRatio;
    if (drawH > maxH) {
      drawH = maxH;
      drawW = drawH * imgRatio;
    }

    const x = (pageWidth - drawW) / 2;
    const y = (pageHeight - drawH) / 2;

    pdf.addImage(dataUrl, format, x, y, drawW, drawH);
  }

  // 直接使用 jsPDF 原生 blob 输出
  return pdf.output("blob");
}

/**
 * 根据 MIME 类型返回 jsPDF 支持的图片格式
 */
function getImageFormat(mimeType: string): string {
  if (mimeType === "image/png") return "PNG";
  if (mimeType === "image/jpeg") return "JPEG";
  if (mimeType === "image/webp") return "WEBP";
  if (mimeType === "image/bmp") return "BMP";
  return "JPEG"; // 默认
}

/**
 * 将 File 对象转为 base64 DataURL
 */
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 触发浏览器下载 Blob 文件（兼容手机端）
 */
export function downloadBlob(blob: Blob, filename: string): void {
  // 确保 Blob 类型正确
  const pdfBlob = new Blob([blob], { type: "application/pdf" });
  const url = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  // 延迟清理，确保手机浏览器处理完毕
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 300);
}
