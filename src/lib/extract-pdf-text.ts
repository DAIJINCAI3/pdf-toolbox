/**
 * 用 pdfjs-dist 提取 PDF 文本
 * Node.js 服务器端环境（Next.js API Routes）
 */

export async function extractPDFText(buffer: ArrayBuffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as any;

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;

  const texts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item: any) => "str" in item)
      .map((item: any) => item.str as string)
      .join(" ");
    texts.push(pageText);
  }

  return texts.join("\n\n");
}
