export default function PricingPage() {
  const plans = [
    {
      name: "免费版",
      price: "¥0",
      color: "border-gray-200 bg-white",
      features: [
        "PDF 压缩（≤5MB）",
        "PDF 合并（≤3 个文件）",
        "PDF 拆分（无限制）",
        "图片转 PDF（≤5 张图片）",
        "有广告",
      ],
      cta: "当前套餐",
    },
    {
      name: "专业版",
      price: "¥9.9",
      period: "/月",
      color: "border-blue-300 bg-blue-50",
      recommended: true,
      features: [
        "PDF 压缩（≤100MB）",
        "PDF 合并（≤20 个文件）",
        "PDF 拆分（无限制）",
        "图片转 PDF（≤50 张图片）",
        "批量处理",
        "无广告",
        "优先支持",
      ],
      cta: "即将上线",
    },
    {
      name: "企业版",
      price: "¥29.9",
      period: "/月",
      color: "border-gray-200 bg-white",
      features: [
        "所有功能无限制",
        "批量处理",
        "无广告",
        "API 接口",
        "专属客服",
      ],
      cta: "即将上线",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-10 text-center">
        <h1 className="mb-3 text-3xl font-bold text-gray-900">
          选择适合你的套餐
        </h1>
        <p className="text-gray-500">
          免费使用核心功能，需要更多特性时再升级
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`relative rounded-xl border-2 p-6 ${plan.color}`}
          >
            {plan.recommended && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-medium text-white">
                推荐
              </span>
            )}
            <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
            <div className="mt-3">
              <span className="text-3xl font-bold">{plan.price}</span>
              {plan.period && (
                <span className="text-sm text-gray-500">{plan.period}</span>
              )}
            </div>
            <ul className="mt-6 space-y-3">
              {plan.features.map((feat) => (
                <li
                  key={feat}
                  className="flex items-center gap-2 text-sm text-gray-600"
                >
                  <span className="text-green-500">✓</span> {feat}
                </li>
              ))}
            </ul>
            <button
              disabled
              className="mt-8 w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white opacity-70"
            >
              {plan.cta}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-gray-400">
        💡 付费功能正在开发中，目前所有功能免费使用
      </p>
    </div>
  );
}
