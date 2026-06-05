import { jsPDF } from "jspdf";

/**
 * 将多张图片打包为一个 PDF 文件（A4 页面，居中适配）
 * @param files - 图片文件数组，顺序即 PDF 页面顺序
 * @returns PDF 文件的 Blob
 */
export async function imagesToPDF(files: File[]): Promise<Blob> {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = 210; // A4 宽度（mm）
  const pageHeight = 297; // A4 高度（mm）
  const margin = 10; // 边距（mm）

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // 将图片文件转为 DataURL
    const dataUrl = await fileToDataURL(file);

    // 第一张不需要加页
    if (i > 0) {
      pdf.addPage();
    }

    // 计算图片适配 A4 的尺寸（等比缩放）
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

    // 居中放置
    const x = (pageWidth - drawW) / 2;
    const y = (pageHeight - drawH) / 2;

    pdf.addImage(dataUrl, "JPEG", x, y, drawW, drawH);
  }

  // 用 arraybuffer 输出，再手动生成标准 Blob，确保 WPS 等软件兼容
  const arrayBuffer = pdf.output("arraybuffer");
  return new Blob([arrayBuffer], { type: "application/pdf" });
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
 * 触发浏览器下载 Blob 文件
 */
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
