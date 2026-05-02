import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import {
  X,
  Bot,
  ChevronDown,
  Send,
  Settings,
  RefreshCw,
  Paperclip,
  Mic,
  Sparkles,
} from 'lucide-react';
import { fetchAgents, streamChat } from '../lib/api';
import type { AgentInfo, ChatMessage, ToolCall } from '../types';
import { startTrace, addSpan, completeTrace } from '../lib/traceStore';
import MessageBubble from './MessageBubble';
import StreamingDots from './StreamingDots';

let _idCounter = 0;
function genId(): string {
  return `${Date.now()}-${++_idCounter}`;
}

interface ChatPanelProps {
  onClose: () => void;
  initialAgent?: AgentInfo | null;
}

export default function ChatPanel({ onClose, initialAgent }: ChatPanelProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(initialAgent ?? null);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId] = useState<string>(() => genId());
  const [memoryEnabled, setMemoryEnabled] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAgents()
      .then((data) => {
        setAgents(data);
        if (!selectedAgent && data.length > 0) {
          setSelectedAgent(data[0]);
        }
      })
      .catch((err) => console.error("[ChatPanel] Failed to load agents:", err));
  }, []);

  useEffect(() => {
    if (initialAgent) setSelectedAgent(initialAgent);
  }, [initialAgent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    return () => { abortRef.current?.(); };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAgentDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !selectedAgent || isStreaming) return;

    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    const assistantId = genId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);

    // Start recording a trace for this interaction
    const traceId = startTrace(selectedAgent.name, selectedAgent.model);

    const toolCallsMap = new Map<string, ToolCall>();

    abortRef.current = streamChat(
      selectedAgent.id,
      trimmed,
      memoryEnabled ? conversationId : undefined,
      (event) => {
        const type = event.type as string;

        if (type === 'text-delta') {
          const text = (event.text as string) ?? '';
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + text } : m,
            ),
          );
          return;
        }

        if (type === 'tool-call') {
          const tc: ToolCall = {
            toolCallId: event.toolCallId as string,
            toolName: event.toolName as string,
            input: (event.input as Record<string, unknown>) ?? {},
            status: 'calling',
          };
          toolCallsMap.set(tc.toolCallId, tc);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, toolCalls: Array.from(toolCallsMap.values()) }
                : m,
            ),
          );
          // Record a tool span in the trace
          addSpan(traceId, {
            name: tc.toolName,
            type: 'tool',
            startTime: Date.now(),
            status: 'running',
            input: tc.input,
          });
          return;
        }

        if (type === 'tool-result') {
          const toolCallId = event.toolCallId as string;
          const existing = toolCallsMap.get(toolCallId);
          if (existing) {
            toolCallsMap.set(toolCallId, { ...existing, output: event.output, status: 'done' });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, toolCalls: Array.from(toolCallsMap.values()) }
                  : m,
              ),
            );
          }
          return;
        }

        if (type === 'tool-input-start') {
          const tc: ToolCall = {
            toolCallId: event.id as string,
            toolName: event.toolName as string,
            input: {},
            status: 'calling',
          };
          toolCallsMap.set(tc.toolCallId, tc);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, toolCalls: Array.from(toolCallsMap.values()) }
                : m,
            ),
          );
          // Record a tool span in the trace
          addSpan(traceId, {
            name: tc.toolName,
            type: 'tool',
            startTime: Date.now(),
            status: 'running',
            input: {},
          });
          return;
        }
      },
      () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m,
          ),
        );
        setIsStreaming(false);
        abortRef.current = null;
        completeTrace(traceId, undefined, 'success');
        setTimeout(() => textareaRef.current?.focus(), 50);
      },
      (err) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || `Error: ${err.message}`, isStreaming: false }
              : m,
          ),
        );
        setIsStreaming(false);
        abortRef.current = null;
        completeTrace(traceId, undefined, 'error');
      },
    );
  }, [input, selectedAgent, isStreaming, conversationId, memoryEnabled]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const canSend = input.trim().length > 0 && selectedAgent !== null && !isStreaming;

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-[#0a0a0a] border-l border-[#262626] flex flex-col z-50 slide-in-right shadow-2xl">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#262626]">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[#22c55e]" />
          <span className="text-[13px] font-semibold text-[#fafafa]">AI Playground</span>
        </div>

        {/* Agent selector */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#141414] border border-[#262626] rounded-lg text-[12px] text-[#a3a3a3] hover:border-[#333] transition-colors"
          >
            <Bot size={12} className="text-[#22c55e]" />
            {selectedAgent?.name ?? 'Select agent'}
            <span className="text-[10px] text-[#525252] font-mono">
              {selectedAgent?.model ?? ''}
            </span>
            <ChevronDown size={12} />
          </button>

          {agentDropdownOpen && agents.length > 0 && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] bg-[#141414] border border-[#262626] rounded-lg shadow-xl overflow-hidden">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => {
                    setSelectedAgent(agent);
                    setAgentDropdownOpen(false);
                    setMessages([]);
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-[#1f1f1f] transition-colors ${
                    selectedAgent?.id === agent.id ? 'bg-[#1f1f1f]' : ''
                  }`}
                >
                  <div className="text-[12px] text-[#fafafa] font-medium">{agent.name}</div>
                  <div className="text-[10px] text-[#525252] font-mono">{agent.model}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-md hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3] transition-colors">
            <Settings size={14} />
          </button>
          <button
            onClick={() => { setMessages([]); }}
            className="p-1.5 rounded-md hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3] transition-colors"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Feature toggles */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMemoryEnabled(!memoryEnabled)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
              memoryEnabled
                ? 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30 hover:bg-[#22c55e]/20'
                : 'bg-[#141414] text-[#525252] border-[#262626] hover:border-[#333] hover:text-[#a3a3a3]'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full transition-colors ${memoryEnabled ? 'bg-[#22c55e]' : 'bg-[#525252]'}`} />
            {memoryEnabled ? 'Memory enabled' : 'Enable memory'}
          </button>
        </div>
        <span className="text-[10px] text-[#404040]">
          {memoryEnabled ? 'Conversation history is active' : 'Each message is independent'}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Sparkles size={28} className="text-[#333]" />
            <div>
              <p className="text-[13px] text-[#a3a3a3] font-medium">
                Start a conversation with {selectedAgent?.name ?? 'agent'}
              </p>
              <p className="text-[11px] text-[#525252] mt-1">
                Messages will appear here
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pb-2">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} compact />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[#262626] p-3">
        {isStreaming && (
          <div className="flex items-center gap-2 mb-2 text-[11px] text-[#525252]">
            <StreamingDots />
            <span>Generating...</span>
          </div>
        )}
        <div className="flex items-end gap-2 bg-[#141414] border border-[#262626] rounded-xl px-3 py-2 focus-within:border-[#333] transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={!selectedAgent || isStreaming}
            placeholder={`Message ${selectedAgent?.name ?? 'agent'}...`}
            rows={1}
            className="flex-1 bg-transparent text-[13px] text-[#fafafa] placeholder:text-[#525252] resize-none outline-none leading-relaxed disabled:cursor-not-allowed min-h-[24px]"
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded-md text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors">
              <Paperclip size={14} />
            </button>
            <button className="p-1.5 rounded-md text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors">
              <Mic size={14} />
            </button>
          </div>
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="p-2 rounded-lg bg-[#22c55e] text-black disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#16a34a] active:scale-95 transition-all"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
