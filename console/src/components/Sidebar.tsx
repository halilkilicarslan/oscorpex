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
} from 'lucide-react';

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
      { to: '/dashboard', label: 'Dashboard', icon: <BarChart3 size={18} /> },
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
    items: [
      { to: '/studio', label: 'Projects', icon: <Code2 size={18} />, badge: 'New' },
      { to: '/studio/teams', label: 'Team Builder', icon: <Users size={18} /> },
      { to: '/studio/providers', label: 'Providers', icon: <Settings size={18} /> },
      { to: '/studio/cli-monitor', label: 'CLI Monitor', icon: <Terminal size={18} /> },
    ],
  },
];

const SIDEBAR_STORAGE_KEY = 'oscorpex-sidebar-collapsed';

export default function Sidebar() {
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
                  end={to === '/' || to === '/studio'}
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
          href="https://voltagent.dev/docs/"
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
      </div>
    </aside>
  );
}
