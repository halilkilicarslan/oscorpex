import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutGrid,
  BarChart3,
  Activity,
  FileText,
  MessageSquareMore,
  Bell,
  Brain,
  Database,
  ScrollText,
  Workflow,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Code2,
  Settings,
  Users,
  Terminal,
  Gauge,
  LogOut,
  Radio,
  Shield,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  external?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
  collapsible?: boolean;
}

const sections: NavSection[] = [
  {
    title: '',
    items: [
      { to: '/', label: 'Agents & Workflows', icon: <LayoutGrid size={18} /> },
    ],
  },
  {
    title: 'OBSERVABILITY',
    items: [
      { to: '/dashboard', label: 'Overview', icon: <BarChart3 size={18} /> },
      { to: '/traces', label: 'Traces', icon: <Activity size={18} /> },
      { to: '/logs', label: 'Logs', icon: <FileText size={18} /> },
      { to: '/feedbacks', label: 'Feedbacks', icon: <MessageSquareMore size={18} /> },
      { to: '/alerts', label: 'Alerts', icon: <Bell size={18} />, badge: 'New' },
    ],
  },
  {
    title: 'AI FEATURES',
    collapsible: true,
    items: [
      { to: '/memory', label: 'Memory', icon: <Brain size={18} /> },
      { to: '/rag', label: 'RAG', icon: <Database size={18} />, badge: 'New' },
      { to: '/prompts', label: 'Prompts', icon: <ScrollText size={18} /> },
    ],
  },
  {
    title: 'AUTOMATION',
    items: [
      { to: '/triggers', label: 'Triggers', icon: <Workflow size={18} />, badge: 'New' },
    ],
  },
  {
    title: 'OSCORPEX',
    collapsible: true,
    items: [
      { to: '/studio/dashboard', label: 'Dashboard', icon: <Gauge size={18} />, badge: 'New' },
      { to: '/studio/insights', label: 'Insights', icon: <Brain size={18} />, badge: 'New' },
      { to: '/studio', label: 'Projects', icon: <Code2 size={18} /> },
      { to: '/studio/teams', label: 'Team Builder', icon: <Users size={18} /> },
      { to: '/studio/providers', label: 'Providers', icon: <Settings size={18} /> },
      { to: '/studio/providers/compare', label: 'Compare', icon: <BarChart3 size={18} />, badge: 'New' },
      { to: '/studio/cli-monitor', label: 'CLI Monitor', icon: <Terminal size={18} /> },
      { to: '/studio/telemetry', label: 'Telemetry', icon: <Radio size={18} />, badge: 'New' },
      { to: '/studio/control-plane', label: 'Control Plane', icon: <Shield size={18} />, badge: 'New' },
      { to: '/studio/admin', label: 'Admin', icon: <Shield size={18} />, badge: 'New' },
    ],
  },
];

const SIDEBAR_STORAGE_KEY = 'oscorpex-sidebar-collapsed';

export default function Sidebar() {
  const { user, isAuthenticated, logout } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'AI FEATURES': true,
    OBSERVABILITY: true,
    AUTOMATION: true,
    OSCORPEX: true,
  });

  const toggleSection = (title: string) => {
    setExpandedSections((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <aside
      className={`h-full flex flex-col bg-[#0a0a0a] border-r border-[#262626] shrink-0 transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-[#262626]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#111111] border border-[#262626] flex items-center justify-center shrink-0 overflow-hidden">
            <img src="/logo-icon.svg" alt="Oscorpex icon" className="w-5 h-5 object-contain brightness-0 invert" />
          </div>
          {!collapsed && (
            <img src="/app-logo.svg" alt="Oscorpex" className="h-5 w-auto brightness-0 invert select-none" />
          )}
        </div>
        <button
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            try {
              localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
            } catch {
              // ignore storage errors (e.g. private browsing quota)
            }
          }}
          className="p-1 rounded hover:bg-[#1f1f1f] text-[#737373] hover:text-[#a3a3a3] transition-colors"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-1">
        {sections.map((section) => (
          <div key={section.title || 'main'} className="mb-2">
            {section.title && !collapsed && (
              <div className="flex items-center justify-between px-2 mb-1">
                <span className="text-[10px] font-semibold text-[#525252] uppercase tracking-wider">
                  {section.title}
                </span>
                {section.collapsible && (
                  <button
                    onClick={() => toggleSection(section.title)}
                    className="text-[#525252] hover:text-[#737373]"
                  >
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${
                        expandedSections[section.title] ? '' : '-rotate-90'
                      }`}
                    />
                  </button>
                )}
              </div>
            )}

            {(!section.collapsible || expandedSections[section.title]) &&
              section.items.map(({ to, label, icon, badge }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/' || to.startsWith('/studio')}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors duration-100',
                      collapsed ? 'justify-center' : '',
                      isActive
                        ? 'bg-[#1f1f1f] text-[#22c55e]'
                        : 'text-[#a3a3a3] hover:text-[#fafafa] hover:bg-[#141414]',
                    ].join(' ')
                  }
                >
                  {icon}
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{label}</span>
                      {badge && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] font-semibold">
                          {badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
          </div>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="px-2 py-3 border-t border-[#262626] flex flex-col gap-1">
        {!collapsed && (
          <div className="px-2.5 py-1.5 mb-1">
            <div className="flex items-center justify-between text-[11px] text-[#525252]">
              <span>Traces this month</span>
              <span className="text-[#a3a3a3]">0/250</span>
            </div>
            <div className="w-full h-1 bg-[#1f1f1f] rounded-full mt-1">
              <div className="w-0 h-full bg-[#22c55e] rounded-full" />
            </div>
          </div>
        )}

        <a
          href="https://github.com/oscorpex/oscorpex"
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-[#a3a3a3] hover:text-[#fafafa] hover:bg-[#141414] transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <FileText size={18} />
          {!collapsed && (
            <>
              <span className="flex-1">Documentation</span>
              <ExternalLink size={12} className="text-[#525252]" />
            </>
          )}
        </a>

        {/* User info + logout */}
        {isAuthenticated && user && (
          <div
            className={`flex items-center gap-2 px-2.5 py-2 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] mt-1 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            {/* Avatar */}
            <div
              className="w-7 h-7 rounded-full bg-[#22c55e]/20 border border-[#22c55e]/30 flex items-center justify-center shrink-0"
              title={user.displayName || user.email}
            >
              <span className="text-[11px] font-semibold text-[#22c55e] uppercase">
                {(user.displayName || user.email).charAt(0)}
              </span>
            </div>

            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-[#fafafa] truncate leading-tight">
                    {user.displayName || user.email}
                  </p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#262626] text-[#737373] font-medium uppercase tracking-wide">
                    {user.role}
                  </span>
                </div>
                <button
                  onClick={logout}
                  title="Sign out"
                  className="p-1 rounded text-[#525252] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut size={14} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
