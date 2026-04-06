import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FolderOpen,
  Trash2,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Code2,
  X,
} from 'lucide-react';
import {
  fetchProjects,
  createProject,
  deleteProject,
  fetchTeamTemplates,
  type Project,
  type TeamTemplate,
} from '../../lib/studio-api';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<Project['status'], { color: string; icon: React.ReactNode; label: string }> = {
  planning: { color: 'text-[#f59e0b]', icon: <Clock size={12} />, label: 'Planning' },
  approved: { color: 'text-[#3b82f6]', icon: <CheckCircle2 size={12} />, label: 'Approved' },
  running: { color: 'text-[#22c55e]', icon: <Loader2 size={12} className="animate-spin" />, label: 'Running' },
  paused: { color: 'text-[#a855f7]', icon: <Pause size={12} />, label: 'Paused' },
  completed: { color: 'text-[#22c55e]', icon: <CheckCircle2 size={12} />, label: 'Completed' },
  failed: { color: 'text-[#ef4444]', icon: <XCircle size={12} />, label: 'Failed' },
};

function StatusBadge({ status }: { status: Project['status'] }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${s.color}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl p-5 hover:border-[#333] transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-[#1f1f1f] flex items-center justify-center">
            <Code2 size={18} className="text-[#22c55e]" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-[#fafafa]">{project.name}</h3>
            <StatusBadge status={project.status} />
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#ef4444] transition-all"
          title="Delete project"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {project.description && (
        <p className="text-[12px] text-[#737373] mb-3 line-clamp-2">{project.description}</p>
      )}

      {project.techStack.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {project.techStack.map((tech) => (
            <span
              key={tech}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#a3a3a3] border border-[#262626]"
            >
              {tech}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-[#1f1f1f]">
        <span className="text-[10px] text-[#525252]">
          {new Date(project.createdAt).toLocaleDateString()}
        </span>
        <button
          onClick={onOpen}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
        >
          {project.status === 'planning' ? (
            <>
              <Play size={12} />
              Start Planning
            </>
          ) : (
            <>
              <FolderOpen size={12} />
              Open
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create project modal
// ---------------------------------------------------------------------------

function CreateProjectModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [techInput, setTechInput] = useState('');
  const [techStack, setTechStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

  useEffect(() => {
    fetchTeamTemplates().then(setTemplates).catch(() => {});
  }, []);

  const addTech = () => {
    const tech = techInput.trim();
    if (tech && !techStack.includes(tech)) {
      setTechStack([...techStack, tech]);
      setTechInput('');
    }
  };

  const removeTech = (tech: string) => {
    setTechStack(techStack.filter((t) => t !== tech));
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim(),
        techStack,
        teamTemplateId: selectedTemplate || undefined,
      });
      onCreate(project);
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-[#1f1f1f] shrink-0">
          <h2 className="text-[16px] font-semibold text-[#fafafa]">New Project</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3]">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="text-[12px] text-[#737373] font-medium block mb-1.5">Project Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome App"
              className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[12px] text-[#737373] font-medium block mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly describe what you want to build..."
              rows={3}
              className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none resize-none"
            />
          </div>

          {/* Tech Stack */}
          <div>
            <label className="text-[12px] text-[#737373] font-medium block mb-1.5">Tech Stack</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={techInput}
                onChange={(e) => setTechInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTech(); } }}
                placeholder="React, Node.js, PostgreSQL..."
                className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
              />
              <button
                onClick={addTech}
                className="px-3 py-2 rounded-lg bg-[#1f1f1f] text-[#a3a3a3] hover:text-[#fafafa] text-[12px] font-medium transition-colors"
              >
                Add
              </button>
            </div>
            {techStack.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {techStack.map((tech) => (
                  <span
                    key={tech}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20"
                  >
                    {tech}
                    <button onClick={() => removeTech(tech)} className="hover:text-white">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Team Template */}
          {templates.length > 0 && (
            <div>
              <label className="text-[12px] text-[#737373] font-medium block mb-1.5">Team Template</label>
              <div className="flex flex-col gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTemplate(t.id === selectedTemplate ? '' : t.id)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      selectedTemplate === t.id
                        ? 'border-[#22c55e] bg-[#22c55e]/5'
                        : 'border-[#262626] bg-[#0a0a0a] hover:border-[#333]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-[#fafafa]">{t.name}</span>
                      <span className="text-[11px] text-[#525252]">{t.roles.length} agents</span>
                    </div>
                    <p className="text-[11px] text-[#737373] mt-0.5">{t.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {t.roles.map((role) => (
                        <span key={role} className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#a3a3a3] border border-[#262626]">
                          {role}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#1f1f1f] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || loading}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function StudioHomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch {
      // API not ready yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#fafafa]">AI Dev Studio</h1>
          <p className="text-sm text-[#737373] mt-1">
            Create projects, plan with PM Agent, and let AI agents build your software
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
        >
          <Plus size={16} />
          New Project
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-[#525252] animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-[#111111] border border-[#262626] rounded-xl p-16 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#1f1f1f] flex items-center justify-center mb-4">
            <Code2 size={28} className="text-[#333]" />
          </div>
          <h3 className="text-[15px] font-medium text-[#a3a3a3] mb-1">No projects yet</h3>
          <p className="text-[13px] text-[#525252] max-w-sm mb-4">
            Create your first project and start planning with the PM Agent. Your AI dev team will handle the rest.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
          >
            <Plus size={14} />
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => navigate(`/studio/${project.id}`)}
              onDelete={() => handleDelete(project.id)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreate={(project) => {
            setProjects((prev) => [project, ...prev]);
            setShowCreate(false);
            navigate(`/studio/${project.id}`);
          }}
        />
      )}
    </div>
  );
}
