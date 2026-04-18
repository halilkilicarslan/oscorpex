import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderInput, LayoutTemplate, Loader2, Code2 } from 'lucide-react';
import { fetchProjects, deleteProject, type Project } from '../../lib/studio-api';
import { ProjectCard } from './studio-home/ProjectCard';
import { CreateProjectModal } from './studio-home/CreateProjectModal';
import { ImportProjectModal } from './studio-home/ImportProjectModal';
import { TemplateProjectModal } from './studio-home/TemplateProjectModal';

export default function StudioHomePage() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [showCreate, setShowCreate] = useState(false);
	const [showImport, setShowImport] = useState(false);
	const [showTemplate, setShowTemplate] = useState(false);
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

	useEffect(() => {
		load();
	}, []);

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
					<h1 className="text-xl font-semibold text-[#fafafa]">Oscorpex</h1>
					<p className="text-sm text-[#737373] mt-1">Describe your idea, let AI agents build it</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setShowImport(true)}
						className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium border border-[#262626] text-[#a3a3a3] hover:text-[#fafafa] hover:border-[#333] transition-colors"
					>
						<FolderInput size={16} />
						Import
					</button>
					<button
						onClick={() => setShowTemplate(true)}
						className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium border border-[#262626] text-[#a3a3a3] hover:text-[#fafafa] hover:border-[#333] transition-colors"
					>
						<LayoutTemplate size={16} />
						Template
					</button>
					<button
						onClick={() => setShowCreate(true)}
						className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
					>
						<Plus size={16} />
						New Project
					</button>
				</div>
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
						Create your first project and start planning with AI Planner. Your AI dev team will handle the rest.
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

			{/* Import modal */}
			{showImport && (
				<ImportProjectModal
					onClose={() => setShowImport(false)}
					onImport={(project) => {
						setProjects((prev) => [project, ...prev]);
						setShowImport(false);
						navigate(`/studio/${project.id}`);
					}}
				/>
			)}

			{/* Template modal */}
			{showTemplate && (
				<TemplateProjectModal
					onClose={() => setShowTemplate(false)}
					onCreate={(project) => {
						setProjects((prev) => [project, ...prev]);
						setShowTemplate(false);
						navigate(`/studio/${project.id}`);
					}}
				/>
			)}
		</div>
	);
}
