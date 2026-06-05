export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50 py-6 text-center text-sm text-gray-500">
      <p>
        © {new Date().getFullYear()} PDF工具箱 — 所有文件在浏览器本地处理，不上传服务器
      </p>
      <p className="mt-1">
        <a href="#" className="text-gray-500 underline hover:text-blue-600">
          隐私政策
        </a>
      </p>
    </footer>
  );
}
