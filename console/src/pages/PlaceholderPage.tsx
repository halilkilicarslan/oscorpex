import { Construction } from 'lucide-react';

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export default function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#fafafa]">{title}</h1>
        {description && (
          <p className="text-sm text-[#737373] mt-1">{description}</p>
        )}
      </div>

      <div className="bg-[#111111] border border-[#262626] rounded-xl p-16 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#1f1f1f] flex items-center justify-center mb-4">
          <Construction size={28} className="text-[#333]" />
        </div>
        <h3 className="text-[15px] font-medium text-[#a3a3a3] mb-1">
          Coming Soon
        </h3>
        <p className="text-[13px] text-[#525252] max-w-sm">
          This feature is under development and will be available in a future update.
        </p>
      </div>
    </div>
  );
}
