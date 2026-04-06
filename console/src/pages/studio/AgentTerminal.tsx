import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export default function AgentTerminal({
  projectId,
  agentId,
}: {
  projectId: string;
  agentId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#22c55e',
        selectionBackground: '#22c55e33',
        black: '#0a0a0a',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#d4d4d4',
      },
      fontSize: 12,
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;

    term.writeln('\x1b[32m● Agent terminal ready\x1b[0m');
    term.writeln(`\x1b[90mProject: ${projectId} | Agent: ${agentId}\x1b[0m`);
    term.writeln('');

    // Connect to agent output stream
    const eventSource = new EventSource(
      `/api/studio/projects/${projectId}/agents/${agentId}/stream`,
    );

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.output) term.write(data.output);
      } catch {
        term.write(e.data);
      }
    };

    eventSource.onerror = () => {
      term.writeln('\x1b[31m● Stream disconnected\x1b[0m');
      eventSource.close();
    };

    // Resize handler
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      eventSource.close();
      term.dispose();
      termRef.current = null;
    };
  }, [projectId, agentId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[200px] rounded-lg overflow-hidden bg-[#0a0a0a]"
    />
  );
}
