import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskDetailModal from '../pages/studio/TaskDetailModal';
import type { Task } from '../lib/studio-api';

// studio-api modulunu mockla — modal sadece approve/reject/retry cagiriyor, nav ve render yeterli
vi.mock('../lib/studio-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/studio-api')>('../lib/studio-api');
  return {
    ...actual,
    approveTask: vi.fn(),
    rejectTask: vi.fn(),
    retryTask: vi.fn(),
  };
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    phaseId: 'phase-1',
    title: 'Parent auth task',
    description: 'Authentication system',
    assignedAgent: 'backend-dev',
    status: 'running',
    complexity: 'L',
    dependsOn: [],
    branch: 'feat/auth',
    retryCount: 0,
    revisionCount: 0,
    requiresApproval: false,
    ...overrides,
  };
}

describe('TaskDetailModal — v3.0 B3 sub-task rollup', () => {
  it('shows sub-task list with progress counter when task has children', () => {
    const parent = makeTask({ id: 'p-1', title: 'Build auth' });
    const sub1: Task = makeTask({
      id: 's-1',
      title: 'Login endpoint',
      complexity: 'S',
      status: 'done',
      parentTaskId: 'p-1',
      estimatedLines: 12,
    });
    const sub2: Task = makeTask({
      id: 's-2',
      title: 'Signup endpoint',
      complexity: 'M',
      status: 'queued',
      parentTaskId: 'p-1',
      estimatedLines: 45,
    });

    render(
      <TaskDetailModal
        task={parent}
        projectId="p"
        allTasks={[parent, sub1, sub2]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/Sub-tasks \(1\/2\)/)).toBeInTheDocument();
    expect(screen.getByText('Login endpoint')).toBeInTheDocument();
    expect(screen.getByText('Signup endpoint')).toBeInTheDocument();
    expect(screen.getByText('~12L')).toBeInTheDocument();
    expect(screen.getByText('~45L')).toBeInTheDocument();
  });

  it('shows parent task pointer when task has a parentTaskId', () => {
    const parent = makeTask({ id: 'p-1', title: 'Build auth', status: 'running' });
    const sub = makeTask({
      id: 's-1',
      title: 'Login endpoint',
      parentTaskId: 'p-1',
    });

    render(
      <TaskDetailModal task={sub} projectId="p" allTasks={[parent, sub]} onClose={() => {}} />,
    );

    expect(screen.getByText('Parent Task')).toBeInTheDocument();
    expect(screen.getByText('Build auth')).toBeInTheDocument();
  });

  it('renders targetFiles and estimatedLines sections when present', () => {
    const task = makeTask({
      targetFiles: ['src/auth/login.ts', 'tests/auth.test.ts'],
      estimatedLines: 42,
    });

    render(<TaskDetailModal task={task} projectId="p" allTasks={[task]} onClose={() => {}} />);

    expect(screen.getByText(/Hedef Dosyalar/)).toBeInTheDocument();
    expect(screen.getByText('src/auth/login.ts')).toBeInTheDocument();
    expect(screen.getByText('tests/auth.test.ts')).toBeInTheDocument();
    expect(screen.getByText('Tahmini Satır')).toBeInTheDocument();
    expect(screen.getByText('~42 satır')).toBeInTheDocument();
  });

  it('does not render sub-task or parent sections when relations are absent', () => {
    const task = makeTask();
    render(<TaskDetailModal task={task} projectId="p" allTasks={[task]} onClose={() => {}} />);

    expect(screen.queryByText(/Sub-tasks/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Parent Task/)).not.toBeInTheDocument();
  });

  it('calls onNavigateTask when clicking a sub-task button', async () => {
    const parent = makeTask({ id: 'p-1', title: 'Build auth' });
    const sub = makeTask({ id: 's-1', title: 'Login endpoint', parentTaskId: 'p-1' });
    const onNavigate = vi.fn();

    render(
      <TaskDetailModal
        task={parent}
        projectId="p"
        allTasks={[parent, sub]}
        onNavigateTask={onNavigate}
        onClose={() => {}}
      />,
    );

    const subButton = screen.getByText('Login endpoint').closest('button');
    expect(subButton).toBeTruthy();
    await userEvent.click(subButton!);
    expect(onNavigate).toHaveBeenCalledWith(sub);
  });
});
