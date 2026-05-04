import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '../types';
import ToolCallCard from './ToolCallCard';
import StreamingDots from './StreamingDots';

interface MessageBubbleProps {
  message: ChatMessage;
  compact?: boolean;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const MessageBubble = memo(function MessageBubble({ message, compact }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1 w-full">
        <div className={compact ? 'max-w-[85%]' : 'max-w-[75%]'}>
          <div className="bg-[#1f1f1f] text-[#fafafa] px-3.5 py-2.5 rounded-2xl rounded-br-sm text-[13px] leading-relaxed whitespace-pre-wrap break-words border border-[#262626]">
            {message.content}
          </div>
        </div>
        <span className="text-[10px] text-[#525252] mr-0.5">
          {formatTimestamp(message.timestamp)}
        </span>
      </div>
    );
  }

  const cleanContent = message.content
    .replace(/```(?:askuser-json|plan-json|scope-json|team-json)\s*\n[\s\S]*?\n```/g, '')
    .trim();
  const hasContent = cleanContent.length > 0;
  const isStreaming = message.isStreaming === true;
  const showDots = isStreaming && !hasContent;

  if (!hasContent && !showDots && (!message.toolCalls || message.toolCalls.length === 0)) return null;

  return (
    <div className="flex flex-col items-start gap-1 w-full">
      <div className={`${compact ? 'max-w-[90%]' : 'max-w-[80%]'} flex flex-col gap-2`}>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-col gap-2">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.toolCallId} toolCall={tc} />
            ))}
          </div>
        )}

        {(hasContent || showDots) && (
          <div className="bg-[#141414] text-[#e5e5e5] px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-[13px] leading-relaxed break-words border border-[#1a1a1a]">
            {showDots ? (
              <StreamingDots />
            ) : (
              <div className="chat-markdown">
                <ReactMarkdown>{cleanContent}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
      <span className="text-[10px] text-[#525252] ml-0.5">
        {formatTimestamp(message.timestamp)}
      </span>
    </div>
  );
});

export default MessageBubble;
