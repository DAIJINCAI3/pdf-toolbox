import ToolCard from "@/components/ToolCard";
import AdBanner from "@/components/AdBanner";

const tools = [
  {
    title: "PDF 压缩",
    description: "减小 PDF 文件体积，提升传输效率",
    icon: "📦",
    href: "/tools/compress",
  },
  {
    title: "PDF 合并",
    description: "将多个 PDF 文件合成为一个",
    icon: "🔗",
    href: "/tools/merge",
  },
  {
    title: "PDF 拆分",
    description: "提取或删除 PDF 中的指定页面",
    icon: "✂️",
    href: "/tools/split",
  },
  {
    title: "图片转 PDF",
    description: "将多张图片打包生成 PDF 文件",
    icon: "📷",
    href: "/tools/image2pdf",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      {/* 顶部标题 */}
      <div className="mb-10 text-center">
        <h1 className="mb-3 text-3xl font-bold text-gray-900">
          免费在线 PDF 处理工具
        </h1>
        <p className="text-gray-500">
          所有文件在浏览器本地处理，无需上传服务器，安全又快速
        </p>
      </div>

      {/* 安全隐私提示 */}
      <div className="mb-8 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-center text-sm text-green-700">
        🔒 您的文件不会上传到任何服务器，所有处理都在您的电脑上完成
      </div>

      {/* 功能卡片网格 */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tools.map((tool) => (
          <ToolCard key={tool.href} {...tool} />
        ))}
      </div>

      {/* 广告位 */}
      <AdBanner />
    </div>
  );
}
