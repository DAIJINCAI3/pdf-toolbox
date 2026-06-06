/**
 * 用 pdfjs-dist 提取 PDF 文本
 * 纯 Node.js 环境可用（API Routes）
 */

let workerSrcSet = false;

export async function extractPDFText(buffer: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");

  if (!workerSrcSet) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";
    workerSrcSet = true;
  }

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: true,
  }).promise;

  const texts: string[] = [];
  const pageCount = pdf.numPages;

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    texts.push(pageText);
  }

  return texts.join("\n\n");
}
