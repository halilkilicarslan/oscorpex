import { memo } from 'react';
import { Bot, User, AlertCircle } from 'lucide-react';
import type { ChatMessage } from "../../../lib/studio-api";

interface MessageBubbleProps {
	message: ChatMessage;
}

const JSON_BLOCK_RE = /```(?:askuser-json|plan-json|scope-json|team-json)[\s\S]*?```/g;
const SYSTEM_PROMPT_RE = /^(New project intake:|Create a project plan|Yeni proje intake:)/;

const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
	const isUser = message.role === 'user';
	const isError = message.id.startsWith('error-');

	// Hide system-generated prompts from display
	if (isUser && SYSTEM_PROMPT_RE.test(message.content)) return null;

	const displayContent = isUser ? message.content : message.content.replace(JSON_BLOCK_RE, '').trim();

	if (!displayContent && !isError) return null;

	return (
		<div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
			<div
				className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
					isError ? 'bg-[#ef4444]/10' : isUser ? 'bg-[#1f1f1f]' : 'bg-[#22c55e]/10'
				}`}
			>
				{isError ? (
					<AlertCircle size={14} className="text-[#ef4444]" />
				) : isUser ? (
					<User size={14} className="text-[#a3a3a3]" />
				) : (
					<Bot size={14} className="text-[#22c55e]" />
				)}
			</div>
			<div
				className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
					isError
						? 'bg-[#ef4444]/10 text-[#fca5a5] border border-[#ef4444]/20 rounded-tl-md'
						: isUser
							? 'bg-[#22c55e]/10 text-[#e5e5e5] rounded-tr-md'
							: 'bg-[#1a1a1a] text-[#d4d4d4] border border-[#262626] rounded-tl-md'
				}`}
			>
				{displayContent}
			</div>
		</div>
	);
});

export default MessageBubble;
