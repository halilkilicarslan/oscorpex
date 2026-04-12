import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectSettings from '../pages/studio/ProjectSettings';

// Mock studio-api
vi.mock('../lib/studio-api', () => ({
  fetchProjectSettings: vi.fn().mockResolvedValue({}),
  saveProjectSettings: vi.fn().mockResolvedValue({ ok: true }),
  fetchProjectCosts: vi.fn().mockResolvedValue({ totalCostUsd: 0, totalTokens: 0, byAgent: [] }),
}));

import * as studioApi from '../lib/studio-api';

describe('ProjectSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all widget cards', async () => {
    await act(async () => {
      render(<ProjectSettings projectId="test-123" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Proje Ayarlari')).toBeInTheDocument();
    });

    // Check all widget titles are rendered
    expect(screen.getByText('SonarQube')).toBeInTheDocument();
    expect(screen.getByText('ESLint')).toBeInTheDocument();
    expect(screen.getByText('Prettier')).toBeInTheDocument();
    expect(screen.getByText('AI Model')).toBeInTheDocument();
    expect(screen.getByText('Otomatik Dokumantasyon')).toBeInTheDocument();
    expect(screen.getByText('Budget Limiti')).toBeInTheDocument();
  });

  it('should load settings on mount', async () => {
    await act(async () => {
      render(<ProjectSettings projectId="test-123" />);
    });

    await waitFor(() => {
      expect(studioApi.fetchProjectSettings).toHaveBeenCalledWith('test-123');
    });
  });

  it('should populate fields from saved settings', async () => {
    (studioApi.fetchProjectSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      sonarqube: { enabled: 'true', hostUrl: 'http://sonar:9000', token: 'abc123' },
    });

    await act(async () => {
      render(<ProjectSettings projectId="test-123" />);
    });

    await waitFor(() => {
      expect(screen.getByText('SonarQube')).toBeInTheDocument();
    });

    // The host URL input should have the saved value
    const hostInput = screen.getByPlaceholderText('http://localhost:9000');
    expect(hostInput).toHaveValue('http://sonar:9000');
  });

  it('should call save when Kaydet is clicked', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<ProjectSettings projectId="test-123" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Proje Ayarlari')).toBeInTheDocument();
    });

    // Find all Kaydet buttons and click the first one (SonarQube)
    const saveButtons = screen.getAllByText('Kaydet');
    await user.click(saveButtons[0]);

    await waitFor(() => {
      expect(studioApi.saveProjectSettings).toHaveBeenCalledWith(
        'test-123',
        'sonarqube',
        expect.any(Object),
      );
    });
  });

  it('should show "Kaydedildi" after successful save', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<ProjectSettings projectId="test-123" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Proje Ayarlari')).toBeInTheDocument();
    });

    const saveButtons = screen.getAllByText('Kaydet');
    await user.click(saveButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Kaydedildi')).toBeInTheDocument();
    });
  });

  it('should show error message on load failure', async () => {
    (studioApi.fetchProjectSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    await act(async () => {
      render(<ProjectSettings projectId="test-123" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should render toggle fields', async () => {
    await act(async () => {
      render(<ProjectSettings projectId="test-123" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Proje Ayarlari')).toBeInTheDocument();
    });

    // Should have multiple "Aktif" labels (SonarQube, ESLint, Prettier, Auto-Docs, Budget)
    const aktifLabels = screen.getAllByText('Aktif');
    expect(aktifLabels.length).toBeGreaterThanOrEqual(5);
  });

  it('should render select fields with options', async () => {
    await act(async () => {
      render(<ProjectSettings projectId="test-123" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Proje Ayarlari')).toBeInTheDocument();
    });

    // ESLint should have "Kural Seti" select
    expect(screen.getByText('Kural Seti')).toBeInTheDocument();

    // AI Model should have "Provider" select
    expect(screen.getByText('Provider')).toBeInTheDocument();
  });
});
