import { useState, useEffect, useCallback } from 'react';
import {
  Star,
  ThumbsUp,
  ThumbsDown,
  MessageSquareMore,
  Tag,
  BarChart3,
  User,
  Trash2,
  Plus,
  Filter,
  RefreshCw,
  X,
  ChevronDown,
  TrendingUp,
  Hash,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Feedback {
  id: string;
  trace_id: string | null;
  span_id: string | null;
  agent_id: string | null;
  rating: number;
  rating_type: 'stars' | 'thumbs';
  comment: string;
  tags: string[];
  user_id: string;
  created_at: string;
}

interface FeedbackStats {
  totalFeedbacks: number;
  avgRating: number | null;
  ratingDistribution: Record<number, number>;
  byAgent: Array<{ name: string; avgRating: number; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
  recentTrend: Array<{ day: string; count: number }>;
}

type Tab = 'all' | 'byAgent' | 'analytics';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = '/api/observability';
const PAGE_SIZE = 50;

const AVAILABLE_TAGS = [
  'helpful',
  'accurate',
  'creative',
  'slow',
  'fast',
  'hallucination',
  'incomplete',
  'verbose',
  'concise',
  'relevant',
  'off-topic',
  'unsafe',
];

const TAG_COLORS: Record<string, string> = {
  helpful: 'text-[#22c55e] bg-[#052e16] border-[#16a34a]',
  accurate: 'text-[#3b82f6] bg-[#172554] border-[#1d4ed8]',
  creative: 'text-[#a855f7] bg-[#2e1065] border-[#7c3aed]',
  slow: 'text-[#f59e0b] bg-[#451a03] border-[#b45309]',
  fast: 'text-[#22c55e] bg-[#052e16] border-[#16a34a]',
  hallucination: 'text-[#ef4444] bg-[#450a0a] border-[#b91c1c]',
  incomplete: 'text-[#f59e0b] bg-[#451a03] border-[#b45309]',
  verbose: 'text-[#a3a3a3] bg-[#171717] border-[#404040]',
  concise: 'text-[#22c55e] bg-[#052e16] border-[#16a34a]',
  relevant: 'text-[#3b82f6] bg-[#172554] border-[#1d4ed8]',
  'off-topic': 'text-[#ef4444] bg-[#450a0a] border-[#b91c1c]',
  unsafe: 'text-[#ef4444] bg-[#450a0a] border-[#b91c1c]',
};

function getTagStyle(tag: string): string {
  return TAG_COLORS[tag] ?? 'text-[#a3a3a3] bg-[#171717] border-[#404040]';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(ts: string): string {
  try {
    return new Date(ts).toLocaleString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8) + '...';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          size={14}
          className={i < rating ? 'text-[#f59e0b] fill-[#f59e0b]' : 'text-[#404040]'}
        />
      ))}
    </span>
  );
}

function ThumbsRating({ rating }: { rating: number }) {
  if (rating === 1) {
    return (
      <span className="flex items-center gap-1 text-[#22c55e]">
        <ThumbsUp size={14} className="fill-[#22c55e]" />
        <span className="text-xs">Positive</span>
      </span>
    );
  }
  if (rating === -1) {
    return (
      <span className="flex items-center gap-1 text-[#ef4444]">
        <ThumbsDown size={14} className="fill-[#ef4444]" />
        <span className="text-xs">Negative</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[#a3a3a3]">
      <span className="text-xs">Neutral</span>
    </span>
  );
}

function RatingDisplay({ rating, ratingType }: { rating: number; ratingType: string }) {
  if (ratingType === 'thumbs') return <ThumbsRating rating={rating} />;
  return <StarRating rating={rating} />;
}

function TagPill({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${getTagStyle(tag)}`}
    >
      {tag}
      {onRemove && (
        <button onClick={onRemove} className="hover:opacity-70">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#a3a3a3]">{title}</span>
        <Icon size={14} className="text-[#525252]" />
      </div>
      <div className="text-2xl font-semibold text-[#fafafa]">{value}</div>
      {sub && <div className="text-xs text-[#525252] mt-1">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Feedback Form
// ---------------------------------------------------------------------------

interface AddFeedbackFormProps {
  agents: string[];
  onSubmit: (data: {
    agent_id?: string;
    rating: number;
    rating_type: 'stars' | 'thumbs';
    comment: string;
    tags: string[];
    trace_id?: string;
    user_id?: string;
  }) => Promise<void>;
  onCancel: () => void;
}

function AddFeedbackForm({ agents, onSubmit, onCancel }: AddFeedbackFormProps) {
  const [agentId, setAgentId] = useState('');
  const [ratingType, setRatingType] = useState<'stars' | 'thumbs'>('stars');
  const [starRating, setStarRating] = useState(5);
  const [thumbsRating, setThumbsRating] = useState<1 | 0 | -1>(1);
  const [comment, setComment] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [traceId, setTraceId] = useState('');
  const [userId, setUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        agent_id: agentId || undefined,
        rating: ratingType === 'stars' ? starRating : thumbsRating,
        rating_type: ratingType,
        comment,
        tags: selectedTags,
        trace_id: traceId || undefined,
        user_id: userId || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[#111111] border border-[#22c55e]/30 rounded-lg p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-[#fafafa]">Add Feedback</h3>
        <button onClick={onCancel} className="text-[#525252] hover:text-[#a3a3a3]">
          <X size={16} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Agent + Rating Type row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#a3a3a3] mb-1">Agent (optional)</label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
            >
              <option value="">All / Unknown</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#a3a3a3] mb-1">Rating type</label>
            <div className="flex gap-2">
              {(['stars', 'thumbs'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRatingType(t)}
                  className={`flex-1 py-2 rounded text-xs border transition-colors ${
                    ratingType === t
                      ? 'border-[#22c55e]/60 bg-[#22c55e]/10 text-[#22c55e]'
                      : 'border-[#262626] text-[#a3a3a3] hover:border-[#404040]'
                  }`}
                >
                  {t === 'stars' ? 'Stars' : 'Thumbs'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Rating selector */}
        {ratingType === 'stars' ? (
          <div>
            <label className="block text-xs text-[#a3a3a3] mb-2">Rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setStarRating(n)}
                  className="p-1"
                >
                  <Star
                    size={22}
                    className={
                      n <= starRating
                        ? 'text-[#f59e0b] fill-[#f59e0b]'
                        : 'text-[#404040] hover:text-[#f59e0b]'
                    }
                  />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-[#a3a3a3] mb-2">Rating</label>
            <div className="flex gap-3">
              {([1, 0, -1] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setThumbsRating(v)}
                  className={`flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors ${
                    thumbsRating === v
                      ? v === 1
                        ? 'border-[#22c55e]/60 bg-[#22c55e]/10 text-[#22c55e]'
                        : v === -1
                          ? 'border-[#ef4444]/60 bg-[#ef4444]/10 text-[#ef4444]'
                          : 'border-[#404040] bg-[#1a1a1a] text-[#a3a3a3]'
                      : 'border-[#262626] text-[#525252] hover:border-[#404040]'
                  }`}
                >
                  {v === 1 ? (
                    <ThumbsUp size={14} />
                  ) : v === -1 ? (
                    <ThumbsDown size={14} />
                  ) : (
                    <span>-</span>
                  )}
                  {v === 1 ? 'Positive' : v === -1 ? 'Negative' : 'Neutral'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Comment */}
        <div>
          <label className="block text-xs text-[#a3a3a3] mb-1">Comment</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Optional feedback comment..."
            className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50 resize-none"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs text-[#a3a3a3] mb-2">Tags</label>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`px-2 py-1 rounded text-xs border transition-colors ${
                  selectedTags.includes(tag)
                    ? getTagStyle(tag)
                    : 'border-[#262626] text-[#525252] hover:border-[#404040] hover:text-[#a3a3a3]'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Optional fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#a3a3a3] mb-1">Trace ID (optional)</label>
            <input
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              placeholder="trace-id..."
              className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-[#a3a3a3] mb-1">User ID (optional)</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="anonymous"
              className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-[#a3a3a3] hover:text-[#fafafa] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm bg-[#22c55e] text-black rounded font-medium hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Saving...' : 'Save Feedback'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback Card
// ---------------------------------------------------------------------------

function FeedbackCard({
  feedback,
  onDelete,
}: {
  feedback: Feedback;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Delete this feedback?')) return;
    setDeleting(true);
    onDelete(feedback.id);
  };

  return (
    <div className="bg-[#111111] border border-[#262626] rounded-lg p-4 hover:border-[#404040] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <RatingDisplay rating={feedback.rating} ratingType={feedback.rating_type} />
          {feedback.agent_id && (
            <span className="px-2 py-0.5 rounded text-xs bg-[#1a1a1a] border border-[#262626] text-[#a3a3a3]">
              {feedback.agent_id}
            </span>
          )}
          {feedback.trace_id && (
            <span className="font-mono text-xs text-[#525252]" title={feedback.trace_id}>
              {shortId(feedback.trace_id)}
            </span>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-[#525252] hover:text-[#ef4444] transition-colors flex-shrink-0"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {feedback.comment && (
        <p className="mt-3 text-sm text-[#a3a3a3] leading-relaxed">{feedback.comment}</p>
      )}

      {feedback.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {feedback.tags.map((tag) => (
            <TagPill key={tag} tag={tag} />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 text-xs text-[#525252]">
        <span className="flex items-center gap-1">
          <User size={10} />
          {feedback.user_id}
        </span>
        <span>{fmtDate(feedback.created_at)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function FeedbacksPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [agents, setAgents] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Filters
  const [filterAgent, setFilterAgent] = useState('');
  const [filterRatingType, setFilterRatingType] = useState('');
  const [filterMinRating, setFilterMinRating] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  // By-agent selected agent
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/feedbacks/stats`);
      if (res.ok) {
        const data = await res.json() as FeedbackStats;
        setStats(data);
      }
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/traces?limit=200`);
      if (res.ok) {
        const data = await res.json() as { traces: Array<{ entity_id: string | null }> };
        const unique = Array.from(
          new Set(data.traces.map((t) => t.entity_id).filter(Boolean)),
        ) as string[];
        setAgents(unique);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchFeedbacks = useCallback(
    async (newOffset = 0) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(newOffset) });
        if (filterAgent) params.set('agent_id', filterAgent);
        if (filterRatingType) params.set('rating_type', filterRatingType);
        if (filterMinRating) params.set('min_rating', filterMinRating);
        if (filterTag) params.set('tag', filterTag);

        const res = await fetch(`${API_BASE}/feedbacks?${params}`);
        if (res.ok) {
          const data = await res.json() as { feedbacks: Feedback[]; total: number };
          let items = data.feedbacks;
          if (filterSearch) {
            const q = filterSearch.toLowerCase();
            items = items.filter(
              (f) =>
                f.comment.toLowerCase().includes(q) ||
                (f.agent_id ?? '').toLowerCase().includes(q) ||
                (f.user_id ?? '').toLowerCase().includes(q),
            );
          }
          setFeedbacks(items);
          setTotal(data.total);
          setOffset(newOffset);
        }
      } finally {
        setLoading(false);
      }
    },
    [filterAgent, filterRatingType, filterMinRating, filterTag, filterSearch],
  );

  useEffect(() => {
    void fetchStats();
    void fetchAgents();
  }, [fetchStats, fetchAgents]);

  useEffect(() => {
    void fetchFeedbacks(0);
  }, [fetchFeedbacks]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleAddFeedback = async (data: Parameters<AddFeedbackFormProps['onSubmit']>[0]) => {
    const res = await fetch(`${API_BASE}/feedbacks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setShowForm(false);
      await Promise.all([fetchFeedbacks(0), fetchStats()]);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`${API_BASE}/feedbacks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setFeedbacks((prev) => prev.filter((f) => f.id !== id));
      setTotal((prev) => prev - 1);
      void fetchStats();
    }
  };

  const handleRefresh = () => {
    void fetchFeedbacks(0);
    void fetchStats();
  };

  // ---------------------------------------------------------------------------
  // Derived stats
  // ---------------------------------------------------------------------------

  const positiveCount = stats
    ? (stats.ratingDistribution[4] ?? 0) + (stats.ratingDistribution[5] ?? 0)
    : 0;
  const positiveRate =
    stats && stats.totalFeedbacks > 0
      ? Math.round((positiveCount / stats.totalFeedbacks) * 100)
      : 0;
  const topTag = stats?.topTags[0]?.tag ?? '—';

  const maxDistCount = stats
    ? Math.max(...Object.values(stats.ratingDistribution), 1)
    : 1;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#fafafa]">
      {/* Header */}
      <div className="border-b border-[#262626] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageSquareMore size={20} className="text-[#22c55e]" />
            <div>
              <h1 className="text-lg font-semibold">Feedbacks</h1>
              <p className="text-xs text-[#525252]">Manage and analyze agent feedback</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={loading || statsLoading}
              className="p-2 text-[#525252] hover:text-[#fafafa] border border-[#262626] rounded hover:border-[#404040] transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading || statsLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-[#22c55e] text-black rounded font-medium hover:bg-[#16a34a] transition-colors"
            >
              <Plus size={14} />
              Add Feedback
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* Add form */}
        {showForm && (
          <AddFeedbackForm
            agents={agents}
            onSubmit={handleAddFeedback}
            onCancel={() => setShowForm(false)}
          />
        )}

        {/* Stats dashboard */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            title="Total Feedbacks"
            value={stats?.totalFeedbacks ?? 0}
            icon={MessageSquareMore}
          />
          <StatCard
            title="Average Rating"
            value={stats?.avgRating != null ? `${stats.avgRating.toFixed(1)} / 5` : '—'}
            sub={
              stats?.avgRating != null
                ? Array.from({ length: 5 })
                    .map((_, i) => (i < Math.round(stats.avgRating ?? 0) ? '★' : '☆'))
                    .join('')
                : undefined
            }
            icon={Star}
          />
          <StatCard
            title="Positive Rate"
            value={`${positiveRate}%`}
            sub="4-5 star ratings"
            icon={ThumbsUp}
          />
          <StatCard
            title="Top Tag"
            value={topTag}
            sub={stats?.topTags[0] ? `${stats.topTags[0].count} uses` : undefined}
            icon={Tag}
          />
        </div>

        {/* Rating distribution bar chart */}
        {stats && stats.totalFeedbacks > 0 && (
          <div className="bg-[#111111] border border-[#262626] rounded-lg p-5">
            <h2 className="text-sm font-medium text-[#fafafa] mb-4 flex items-center gap-2">
              <BarChart3 size={14} className="text-[#22c55e]" />
              Rating Distribution (Stars)
            </h2>
            <div className="space-y-2">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = stats.ratingDistribution[star] ?? 0;
                const pct = Math.round((count / maxDistCount) * 100);
                return (
                  <div key={star} className="flex items-center gap-3">
                    <div className="flex items-center gap-1 w-16 flex-shrink-0">
                      <Star size={12} className="text-[#f59e0b] fill-[#f59e0b]" />
                      <span className="text-xs text-[#a3a3a3]">{star}</span>
                    </div>
                    <div className="flex-1 bg-[#1a1a1a] rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor:
                            star >= 4
                              ? '#22c55e'
                              : star === 3
                                ? '#f59e0b'
                                : '#ef4444',
                        }}
                      />
                    </div>
                    <span className="text-xs text-[#525252] w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-[#262626]">
          <div className="flex gap-1">
            {(
              [
                { key: 'all', label: 'All Feedbacks', icon: MessageSquareMore },
                { key: 'byAgent', label: 'By Agent', icon: User },
                { key: 'analytics', label: 'Analytics', icon: BarChart3 },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors ${
                  tab === key
                    ? 'border-[#22c55e] text-[#22c55e]'
                    : 'border-transparent text-[#525252] hover:text-[#a3a3a3]'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab: All Feedbacks */}
        {tab === 'all' && (
          <div className="space-y-4">
            {/* Filter bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-[#525252]">
                <Filter size={14} />
              </div>

              {/* Agent filter */}
              <div className="relative">
                <select
                  value={filterAgent}
                  onChange={(e) => setFilterAgent(e.target.value)}
                  className="appearance-none bg-[#111111] border border-[#262626] rounded px-3 py-2 text-sm text-[#a3a3a3] pr-8 focus:outline-none focus:border-[#22c55e]/50 cursor-pointer"
                >
                  <option value="">All Agents</option>
                  {agents.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none"
                />
              </div>

              {/* Rating type filter */}
              <div className="relative">
                <select
                  value={filterRatingType}
                  onChange={(e) => setFilterRatingType(e.target.value)}
                  className="appearance-none bg-[#111111] border border-[#262626] rounded px-3 py-2 text-sm text-[#a3a3a3] pr-8 focus:outline-none focus:border-[#22c55e]/50 cursor-pointer"
                >
                  <option value="">All Types</option>
                  <option value="stars">Stars</option>
                  <option value="thumbs">Thumbs</option>
                </select>
                <ChevronDown
                  size={12}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none"
                />
              </div>

              {/* Min rating filter */}
              <div className="relative">
                <select
                  value={filterMinRating}
                  onChange={(e) => setFilterMinRating(e.target.value)}
                  className="appearance-none bg-[#111111] border border-[#262626] rounded px-3 py-2 text-sm text-[#a3a3a3] pr-8 focus:outline-none focus:border-[#22c55e]/50 cursor-pointer"
                >
                  <option value="">Min Rating</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}+ stars
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none"
                />
              </div>

              {/* Tag filter */}
              <div className="relative">
                <select
                  value={filterTag}
                  onChange={(e) => setFilterTag(e.target.value)}
                  className="appearance-none bg-[#111111] border border-[#262626] rounded px-3 py-2 text-sm text-[#a3a3a3] pr-8 focus:outline-none focus:border-[#22c55e]/50 cursor-pointer"
                >
                  <option value="">All Tags</option>
                  {AVAILABLE_TAGS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none"
                />
              </div>

              {/* Text search */}
              <input
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Search comments..."
                className="bg-[#111111] border border-[#262626] rounded px-3 py-2 text-sm text-[#a3a3a3] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50 min-w-[180px]"
              />

              {(filterAgent || filterRatingType || filterMinRating || filterTag || filterSearch) && (
                <button
                  onClick={() => {
                    setFilterAgent('');
                    setFilterRatingType('');
                    setFilterMinRating('');
                    setFilterTag('');
                    setFilterSearch('');
                  }}
                  className="flex items-center gap-1 text-xs text-[#525252] hover:text-[#a3a3a3]"
                >
                  <X size={12} />
                  Clear
                </button>
              )}

              <span className="ml-auto text-xs text-[#525252]">{total} total</span>
            </div>

            {/* Feedback list */}
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
              </div>
            ) : feedbacks.length === 0 ? (
              <div className="text-center py-12 text-[#525252]">
                <MessageSquareMore size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No feedbacks yet. Add the first one!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {feedbacks.map((f) => (
                  <FeedbackCard key={f.id} feedback={f} onDelete={handleDelete} />
                ))}
              </div>
            )}

            {/* Pagination */}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => fetchFeedbacks(offset - PAGE_SIZE)}
                  disabled={offset === 0 || loading}
                  className="px-3 py-1.5 text-sm border border-[#262626] rounded text-[#a3a3a3] hover:border-[#404040] disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs text-[#525252]">
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <button
                  onClick={() => fetchFeedbacks(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total || loading}
                  className="px-3 py-1.5 text-sm border border-[#262626] rounded text-[#a3a3a3] hover:border-[#404040] disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab: By Agent */}
        {tab === 'byAgent' && (
          <div className="space-y-4">
            {!stats || stats.byAgent.length === 0 ? (
              <div className="text-center py-12 text-[#525252]">
                <User size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No agent feedback data yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {stats.byAgent.map((agent) => {
                  const isSelected = selectedAgent === agent.name;
                  const agentTopTags =
                    feedbacks
                      .filter((f) => f.agent_id === agent.name)
                      .flatMap((f) => f.tags)
                      .reduce<Record<string, number>>((acc, t) => {
                        acc[t] = (acc[t] ?? 0) + 1;
                        return acc;
                      }, {});
                  const topAgentTags = Object.entries(agentTopTags)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([t]) => t);

                  return (
                    <button
                      key={agent.name}
                      onClick={() => {
                        setSelectedAgent(isSelected ? null : agent.name);
                        setFilterAgent(isSelected ? '' : agent.name);
                        setTab('all');
                      }}
                      className={`text-left bg-[#111111] border rounded-lg p-4 hover:border-[#404040] transition-colors ${
                        isSelected ? 'border-[#22c55e]/50' : 'border-[#262626]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-medium text-sm text-[#fafafa]">{agent.name}</span>
                        <span className="text-xs text-[#525252]">{agent.count} reviews</span>
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <StarRating rating={Math.round(agent.avgRating)} />
                        <span className="text-sm text-[#a3a3a3]">{agent.avgRating.toFixed(1)}</span>
                      </div>
                      {topAgentTags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {topAgentTags.map((t) => (
                            <TagPill key={t} tag={t} />
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-[#22c55e] mt-3">Click to view feedbacks</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab: Analytics */}
        {tab === 'analytics' && (
          <div className="space-y-5">
            {!stats ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
              </div>
            ) : (
              <>
                {/* Sentiment overview */}
                <div className="bg-[#111111] border border-[#262626] rounded-lg p-5">
                  <h2 className="text-sm font-medium text-[#fafafa] mb-4 flex items-center gap-2">
                    <TrendingUp size={14} className="text-[#22c55e]" />
                    Sentiment Overview
                  </h2>
                  {stats.totalFeedbacks === 0 ? (
                    <p className="text-sm text-[#525252]">No data yet.</p>
                  ) : (
                    <>
                      {(() => {
                        const pos =
                          (stats.ratingDistribution[5] ?? 0) +
                          (stats.ratingDistribution[4] ?? 0);
                        const neu = stats.ratingDistribution[3] ?? 0;
                        const neg =
                          (stats.ratingDistribution[2] ?? 0) +
                          (stats.ratingDistribution[1] ?? 0);
                        const total = stats.totalFeedbacks || 1;
                        const posP = Math.round((pos / total) * 100);
                        const neuP = Math.round((neu / total) * 100);
                        const negP = Math.round((neg / total) * 100);
                        return (
                          <div className="space-y-3">
                            {[
                              { label: 'Positive', count: pos, pct: posP, color: '#22c55e' },
                              { label: 'Neutral', count: neu, pct: neuP, color: '#f59e0b' },
                              { label: 'Negative', count: neg, pct: negP, color: '#ef4444' },
                            ].map(({ label, count, pct, color }) => (
                              <div key={label} className="flex items-center gap-3">
                                <span className="text-xs text-[#a3a3a3] w-16">{label}</span>
                                <div className="flex-1 bg-[#1a1a1a] rounded-full h-3 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%`, backgroundColor: color }}
                                  />
                                </div>
                                <span className="text-xs text-[#525252] w-16 text-right">
                                  {pct}% ({count})
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>

                {/* Tag cloud */}
                <div className="bg-[#111111] border border-[#262626] rounded-lg p-5">
                  <h2 className="text-sm font-medium text-[#fafafa] mb-4 flex items-center gap-2">
                    <Hash size={14} className="text-[#22c55e]" />
                    Tag Cloud
                  </h2>
                  {stats.topTags.length === 0 ? (
                    <p className="text-sm text-[#525252]">No tags yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {stats.topTags.map(({ tag, count }) => {
                        const maxCount = stats.topTags[0]?.count ?? 1;
                        const scale = 0.8 + (count / maxCount) * 0.7;
                        return (
                          <button
                            key={tag}
                            onClick={() => {
                              setFilterTag(tag);
                              setTab('all');
                            }}
                            style={{ fontSize: `${scale}rem` }}
                            className={`px-2 py-1 rounded border ${getTagStyle(tag)} hover:opacity-80 transition-opacity`}
                            title={`${count} uses`}
                          >
                            {tag}
                            <span className="ml-1 text-[0.65rem] opacity-60">({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Daily trend */}
                <div className="bg-[#111111] border border-[#262626] rounded-lg p-5">
                  <h2 className="text-sm font-medium text-[#fafafa] mb-4 flex items-center gap-2">
                    <TrendingUp size={14} className="text-[#22c55e]" />
                    Feedback Trend (Last 7 Days)
                  </h2>
                  {stats.recentTrend.length === 0 ? (
                    <p className="text-sm text-[#525252]">No recent feedback data.</p>
                  ) : (
                    <div className="space-y-2">
                      {(() => {
                        const maxCount = Math.max(...stats.recentTrend.map((d) => d.count), 1);
                        return stats.recentTrend.map(({ day, count }) => {
                          const pct = Math.round((count / maxCount) * 100);
                          return (
                            <div key={day} className="flex items-center gap-3">
                              <span className="text-xs text-[#525252] w-24 flex-shrink-0">{day}</span>
                              <div className="flex-1 bg-[#1a1a1a] rounded-full h-2 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#22c55e] transition-all duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs text-[#525252] w-8 text-right">{count}</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
