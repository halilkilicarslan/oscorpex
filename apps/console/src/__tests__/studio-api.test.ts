import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchProjects,
  fetchProject,
  createProject,
  updateProject,
  deleteProject,
  fetchPlan,
  fetchTasks,
  fetchAgentConfigs,
  fetchTeamTemplates,
  fetchProjectAgents,
  fetchProviders,
  getAgentOutput,
  fetchProjectMessages,
  type Project,
  type Task,
} from '../lib/studio-api';

// fetch'i global olarak mockla
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Basit JSON yaniti olusturmak icin yardimci fonksiyon
function mockJsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response);
}

// Hata yaniti olusturmak icin yardimci fonksiyon
function mockErrorResponse(status: number, errorMessage: string) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ error: errorMessage }),
  } as Response);
}

const SAMPLE_PROJECT: Project = {
  id: 'proj-1',
  name: 'Test Projesi',
  description: 'Bu bir test projesidir',
  status: 'planning',
  techStack: ['React', 'Node.js'],
  repoPath: '/repos/test',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const SAMPLE_TASK: Task = {
  id: 'task-1',
  phaseId: 'phase-1',
  title: 'Frontend gelistirme',
  description: 'React bilesenlerini olustur',
  assignedAgent: 'agent-1',
  status: 'queued',
  complexity: 'M',
  dependsOn: [],
  branch: 'feature/frontend',
  retryCount: 0,
  revisionCount: 0,
  requiresApproval: false,
};

describe('studio-api — URL yapisi', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetchProjects dogru endpoint cagirmalı', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([SAMPLE_PROJECT]));

    await fetchProjects();

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/projects', expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('fetchProject id ile dogru endpoint cagirmalı', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse(SAMPLE_PROJECT));

    await fetchProject('proj-42');

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/projects/proj-42', expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('createProject POST ile body gondermeli', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse(SAMPLE_PROJECT));

    await createProject({ name: 'Yeni Proje', description: 'Aciklama', techStack: ['Vue'] });

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/projects', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'Yeni Proje', description: 'Aciklama', techStack: ['Vue'] }),
    }));
  });

  it('updateProject PATCH ile dogru URL cagirmalı', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse(SAMPLE_PROJECT));

    await updateProject('proj-1', { name: 'Guncellenmis Proje' });

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/projects/proj-1', expect.objectContaining({
      method: 'PATCH',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'Guncellenmis Proje' }),
    }));
  });

  it('deleteProject DELETE metodu ile cagrilmalı', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse(null));

    await deleteProject('proj-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/projects/proj-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('fetchTasks proje ID\'si ile dogru endpoint cagirmalı', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([SAMPLE_TASK]));

    await fetchTasks('proj-99');

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/projects/proj-99/tasks', expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('fetchProjectAgents dogru team endpoint\'i cagirmalı', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));

    await fetchProjectAgents('proj-5');

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/projects/proj-5/team', expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('fetchAgentConfigs dogru agents endpoint\'ini cagirmalı', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));

    await fetchAgentConfigs();

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/agents', expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('fetchTeamTemplates dogru endpoint cagirmalı', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));

    await fetchTeamTemplates();

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/team-templates', expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('fetchProviders dogru providers endpoint\'ini cagirmalı', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));

    await fetchProviders();

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/providers', expect.objectContaining({ headers: expect.any(Object) }));
  });
});

describe('studio-api — hata yonetimi', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('HTTP 500 hatasi firlatmali', async () => {
    mockFetch.mockReturnValueOnce(mockErrorResponse(500, 'Sunucu hatasi'));

    await expect(fetchProjects()).rejects.toThrow('Sunucu hatasi');
  });

  it('HTTP 404 hatasi icin hata mesaji donmeli', async () => {
    mockFetch.mockReturnValueOnce(mockErrorResponse(404, 'Kaynak bulunamadi'));

    await expect(fetchProject('olmayan-id')).rejects.toThrow('Kaynak bulunamadi');
  });

  it('hata mesaji yoksa HTTP status kodu kullanmali', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.reject(new Error('JSON yok')),
      } as Response),
    );

    await expect(fetchProjects()).rejects.toThrow('HTTP 403');
  });

  it('fetchPlan 404 donerse null dondurmeli', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Plan bulunamadi' }),
      } as Response),
    );

    const result = await fetchPlan('proj-1');
    expect(result).toBeNull();
  });

  it('fetchPlan basarili olursa plan dondurmelı', async () => {
    const plan = {
      id: 'plan-1',
      projectId: 'proj-1',
      version: 1,
      status: 'draft',
      phases: [],
      createdAt: '2026-01-01T00:00:00Z',
    };
    mockFetch.mockReturnValueOnce(mockJsonResponse(plan));

    const result = await fetchPlan('proj-1');
    expect(result).toEqual(plan);
  });
});

describe('studio-api — veri donusumleri', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('fetchProjects proje dizisi dondurmeli', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([SAMPLE_PROJECT]));

    const result = await fetchProjects();

    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toEqual(SAMPLE_PROJECT);
    expect(result[0].id).toBe('proj-1');
    expect(result[0].status).toBe('planning');
  });

  it('createProject yeni proje nesnesi dondurmeli', async () => {
    const yeniProje = { ...SAMPLE_PROJECT, id: 'proj-yeni', name: 'Yeni Proje' };
    mockFetch.mockReturnValueOnce(mockJsonResponse(yeniProje));

    const result = await createProject({ name: 'Yeni Proje' });

    expect(result.id).toBe('proj-yeni');
    expect(result.name).toBe('Yeni Proje');
  });

  it('fetchTasks gorev dizisi dondurmeli', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([SAMPLE_TASK]));

    const result = await fetchTasks('proj-1');

    expect(Array.isArray(result)).toBe(true);
    expect(result[0].title).toBe('Frontend gelistirme');
    expect(result[0].status).toBe('queued');
  });

  it('getAgentOutput since parametresi ile URL olusturmali', async () => {
    mockFetch.mockReturnValueOnce(
      mockJsonResponse({ agentId: 'agent-1', lines: ['log1', 'log2'], total: 2 }),
    );

    await getAgentOutput('proj-1', 'agent-1', 10);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/studio/projects/proj-1/agents/agent-1/output?since=10',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('getAgentOutput since olmadan temiz URL olusturmali', async () => {
    mockFetch.mockReturnValueOnce(
      mockJsonResponse({ agentId: 'agent-1', lines: [], total: 0 }),
    );

    await getAgentOutput('proj-1', 'agent-1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/studio/projects/proj-1/agents/agent-1/output',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('fetchProjectMessages agentId filtresi ile URL olusturmali', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));

    await fetchProjectMessages('proj-1', 'agent-1', 'unread');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('agentId=agent-1');
    expect(calledUrl).toContain('status=unread');
  });

  it('fetchProjectMessages filtre olmadan temiz URL olusturmali', async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));

    await fetchProjectMessages('proj-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/studio/projects/proj-1/messages', expect.objectContaining({ headers: expect.any(Object) }));
  });
});
