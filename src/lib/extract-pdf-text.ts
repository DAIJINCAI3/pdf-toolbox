/**
 * 浏览器端 PDF 文本提取
 * 用 pdfjs-dist 在客户端直接提取，无需服务器
 */

export async function extractPDFTextClient(buffer: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const texts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item) => "str" in item)
      .map((item) => (item as { str: string }).str)
      .join(" ");
    texts.push(pageText);
  }

  const result = texts.join("\n\n");
  if (!result.trim()) {
    throw new Error("该 PDF 中没有文字，可能是扫描图片。请使用 OCR 工具。");
  }
  return result;
}
