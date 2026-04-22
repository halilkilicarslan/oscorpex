// ---------------------------------------------------------------------------
// PlannerChatContext — Planner (PM) sohbetini sayfa geçişlerinde yaşat
// Sayfa unmount olsa bile stream devam eder; kullanıcı geri döndüğünde state
// korunur ve tamamlanmış mesajlar backend'den refresh edilir.
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchChatHistory,
  fetchPlan,
  streamPMChat,
  type ChatMessage,
  type PlannerChatModel,
  type PlannerCLIProvider,
  type PlannerReasoningEffort,
  type ProjectPlan,
} from '../lib/studio-api';

export interface PlannerChatState {
  messages: ChatMessage[];
  plan: ProjectPlan | null;
  streaming: boolean;
  streamText: string;
  loaded: boolean;
}

const DEFAULT_STATE: PlannerChatState = {
  messages: [],
  plan: null,
  streaming: false,
  streamText: '',
  loaded: false,
};

interface SendOptions {
  provider: PlannerCLIProvider;
  model: PlannerChatModel;
  effort: PlannerReasoningEffort | null;
}

interface PlannerChatContextValue {
  getState: (projectId: string) => PlannerChatState;
  ensureLoaded: (projectId: string) => Promise<void>;
  reloadHistory: (projectId: string) => Promise<void>;
  reloadPlan: (projectId: string) => Promise<void>;
  setPlan: (projectId: string, plan: ProjectPlan | null) => void;
  appendMessage: (projectId: string, msg: ChatMessage) => void;
  sendMessage: (projectId: string, text: string, opts: SendOptions) => void;
  abort: (projectId: string) => void;
}

const PlannerChatContext = createContext<PlannerChatContextValue | null>(null);

export function PlannerChatProvider({ children }: { children: ReactNode }) {
  // Map<projectId, state>
  const [states, setStates] = useState<Record<string, PlannerChatState>>({});
  // Map<projectId, abort fn>
  const aborters = useRef<Record<string, () => void>>({});
  // Yükleme tekrar tekrar çalışmasın diye
  const loadingRefs = useRef<Record<string, Promise<void>>>({});

  const update = useCallback(
    (projectId: string, patch: Partial<PlannerChatState> | ((s: PlannerChatState) => Partial<PlannerChatState>)) => {
      setStates((prev) => {
        const current = prev[projectId] ?? DEFAULT_STATE;
        const nextPatch = typeof patch === 'function' ? patch(current) : patch;
        return { ...prev, [projectId]: { ...current, ...nextPatch } };
      });
    },
    [],
  );

  const getState = useCallback(
    (projectId: string) => states[projectId] ?? DEFAULT_STATE,
    [states],
  );

  const reloadHistory = useCallback(
    async (projectId: string) => {
      try {
        const history = await fetchChatHistory(projectId);
        update(projectId, { messages: history });
      } catch {
        // yoksay
      }
    },
    [update],
  );

  const reloadPlan = useCallback(
    async (projectId: string) => {
      try {
        const plan = await fetchPlan(projectId);
        update(projectId, { plan });
      } catch {
        update(projectId, { plan: null });
      }
    },
    [update],
  );

  const ensureLoaded = useCallback(
    async (projectId: string) => {
      const existing = states[projectId];
      if (existing?.loaded) return;
      const inflight = loadingRefs.current[projectId];
      if (inflight) return inflight;
      const promise = (async () => {
        try {
          const [history, plan] = await Promise.allSettled([
            fetchChatHistory(projectId),
            fetchPlan(projectId),
          ]);
          update(projectId, {
            messages: history.status === 'fulfilled' ? history.value : [],
            plan: plan.status === 'fulfilled' ? plan.value : null,
            loaded: true,
          });
        } finally {
          delete loadingRefs.current[projectId];
        }
      })();
      loadingRefs.current[projectId] = promise;
      return promise;
    },
    [states, update],
  );

  const setPlan = useCallback(
    (projectId: string, plan: ProjectPlan | null) => update(projectId, { plan }),
    [update],
  );

  const appendMessage = useCallback(
    (projectId: string, msg: ChatMessage) =>
      update(projectId, (s) => ({ messages: [...s.messages, msg] })),
    [update],
  );

  const abort = useCallback(
    (projectId: string) => {
      aborters.current[projectId]?.();
      delete aborters.current[projectId];
      update(projectId, { streaming: false, streamText: '' });
    },
    [update],
  );

  const sendMessage = useCallback(
    (projectId: string, text: string, opts: SendOptions) => {
      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        projectId,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };
      update(projectId, (s) => ({
        messages: [...s.messages, userMsg],
        streaming: true,
        streamText: '',
      }));

      let accumulated = '';
      const cancel = streamPMChat(
        projectId,
        text,
        opts.provider,
        opts.model,
        opts.effort,
        (chunk) => {
          accumulated += chunk;
          update(projectId, { streamText: accumulated });
        },
        () => {
          const assistantMsg: ChatMessage = {
            id: `temp-${Date.now()}-assistant`,
            projectId,
            role: 'assistant',
            content: accumulated,
            createdAt: new Date().toISOString(),
          };
          update(projectId, (s) => ({
            messages: [...s.messages, assistantMsg],
            streaming: false,
            streamText: '',
          }));
          delete aborters.current[projectId];
          // Plan degismis olabilir
          fetchPlan(projectId)
            .then((p) => {
              if (p) update(projectId, { plan: p });
            })
            .catch(() => {});
        },
        (err) => {
          const errorMsg: ChatMessage = {
            id: `error-${Date.now()}`,
            projectId,
            role: 'assistant',
            content: `⚠️ Hata: ${err.message}`,
            createdAt: new Date().toISOString(),
          };
          update(projectId, (s) => ({
            messages: [...s.messages, errorMsg],
            streaming: false,
            streamText: '',
          }));
          delete aborters.current[projectId];
        },
      );
      aborters.current[projectId] = cancel;
    },
    [update],
  );

  const value: PlannerChatContextValue = {
    getState,
    ensureLoaded,
    reloadHistory,
    reloadPlan,
    setPlan,
    appendMessage,
    sendMessage,
    abort,
  };

  return <PlannerChatContext.Provider value={value}>{children}</PlannerChatContext.Provider>;
}

export function usePlannerChat(projectId: string) {
  const ctx = useContext(PlannerChatContext);
  if (!ctx) throw new Error('usePlannerChat must be used within PlannerChatProvider');
  const state = ctx.getState(projectId);
  return {
    ...state,
    ensureLoaded: () => ctx.ensureLoaded(projectId),
    reloadHistory: () => ctx.reloadHistory(projectId),
    reloadPlan: () => ctx.reloadPlan(projectId),
    setPlan: (plan: ProjectPlan | null) => ctx.setPlan(projectId, plan),
    appendMessage: (msg: ChatMessage) => ctx.appendMessage(projectId, msg),
    sendMessage: (text: string, opts: SendOptions) => ctx.sendMessage(projectId, text, opts),
    abort: () => ctx.abort(projectId),
  };
}
