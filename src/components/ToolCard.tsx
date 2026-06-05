import Link from "next/link";

interface ToolCardProps {
  title: string;
  description: string;
  icon: string;
  href: string;
}

export default function ToolCard({ title, description, icon, href }: ToolCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all no-underline hover:shadow-md hover:-translate-y-0.5"
    >
      <div className="mb-3 text-3xl">{icon}</div>
      <h3 className="mb-1 text-lg font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500">{description}</p>
    </Link>
  );
}
