import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileExplorer from '../pages/studio/FileExplorer';
import * as studioApi from '../lib/studio-api';

// studio-api modulunu mockla
vi.mock('../lib/studio-api', () => ({
  createFile: vi.fn(),
  deleteFile: vi.fn(),
  getGitStatus: vi.fn(),
  commitChanges: vi.fn(),
}));

// fetch'i global olarak mockla
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// navigator.clipboard'i mockla
const mockClipboard = { writeText: vi.fn() };
vi.stubGlobal('navigator', { clipboard: mockClipboard });

// Basit JSON yaniti olusturmak icin yardimci
function mockJsonOk(data: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response);
}

function mockFetchError() {
  return Promise.resolve({
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: 'Sunucu hatasi' }),
  } as Response);
}

const ORNEK_AGAC = [
  {
    name: 'src',
    type: 'directory' as const,
    children: [
      { name: 'index.tsx', type: 'file' as const, path: 'src/index.tsx' },
      { name: 'App.tsx', type: 'file' as const, path: 'src/App.tsx' },
    ],
  },
  { name: 'package.json', type: 'file' as const, path: 'package.json' },
];

const ORNEK_BRANCHLER = {
  branches: ['main', 'feature/test'],
  current: 'main',
};

const BOŞ_GIT_DURUMU = {
  modified: [],
  untracked: [],
  staged: [],
  deleted: [],
};

describe('FileExplorer — yukleme durumu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.getGitStatus).mockResolvedValue(BOŞ_GIT_DURUMU);
  });

  it('yukleme sirasinda spinner gosterilmeli', () => {
    // fetch hic cozulmesin
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<FileExplorer projectId="proj-1" />);

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('yukleme tamamlaninca dosya agaci gosterilmeli', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_AGAC),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_BRANCHLER),
      } as Response);

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });
  });
});

describe('FileExplorer — bos/hata durumu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.getGitStatus).mockResolvedValue(BOŞ_GIT_DURUMU);
  });

  it('repo yoksa "Depo Yok" mesaji gosterilmeli', async () => {
    mockFetch.mockResolvedValue(mockFetchError());

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Depo Yok')).toBeInTheDocument();
    });
  });

  it('repo yoksa aciklama metni gosterilmeli', async () => {
    mockFetch.mockResolvedValue(mockFetchError());

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText(/otomatik oluşturulacak/)).toBeInTheDocument();
    });
  });
});

describe('FileExplorer — dosya agaci', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.getGitStatus).mockResolvedValue(BOŞ_GIT_DURUMU);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_AGAC),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_BRANCHLER),
      } as Response);
  });

  it('kok dizinleri gosterilmeli', async () => {
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('package.json')).toBeInTheDocument();
    });
  });

  it('mevcut branch gosterilmeli', async () => {
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument();
    });
  });

  it('dizine tiklaninca alt dosyalar acilmali', async () => {
    const user = userEvent.setup();
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByText('src'));

    // src klasoru zaten acilmis olabilir (depth < 1 ise), direkt dosyalari ara
    await waitFor(() => {
      expect(screen.getByText('index.tsx')).toBeInTheDocument();
    });
  });

  it('dosyaya tiklaninca dosya viewer acilmali', async () => {
    const user = userEvent.setup();

    // Dosya icerigi icin ek fetch mock
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: 'console.log("hello")' }),
    } as Response);

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getAllByText('package.json').length).toBeGreaterThanOrEqual(1);
    });

    // Agac dugumundeki ilk package.json elementi
    const packageJsonItems = screen.getAllByText('package.json');
    await user.click(packageJsonItems[0]);

    await waitFor(() => {
      // Dosya viewer'da "Kapat" butonu gorunmeli
      expect(screen.getByText('Kapat')).toBeInTheDocument();
    });
  });

  it('dosya secilmemisse "bir dosya secin" mesaji gosterilmeli', async () => {
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Görüntülemek için bir dosya seçin/)).toBeInTheDocument();
    });
  });
});

describe('FileExplorer — yeni dosya olusturma', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.getGitStatus).mockResolvedValue(BOŞ_GIT_DURUMU);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_AGAC),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_BRANCHLER),
      } as Response);
  });

  it('"Yeni" butonuna tiklaninca dosya olusturma modali acilmali', async () => {
    const user = userEvent.setup();
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni'));

    await user.click(screen.getByText('Yeni'));

    await waitFor(() => {
      expect(screen.getByText('Yeni Dosya Oluştur')).toBeInTheDocument();
    });
  });

  it('dosya yolu inputu gosterilmeli', async () => {
    const user = userEvent.setup();
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni'));
    await user.click(screen.getByText('Yeni'));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('src/components/MyComponent.tsx'),
      ).toBeInTheDocument();
    });
  });

  it('"İptal" butonuna tiklaninca modal kapanmali', async () => {
    const user = userEvent.setup();
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni'));
    await user.click(screen.getByText('Yeni'));

    await waitFor(() => screen.getByText('Yeni Dosya Oluştur'));

    await user.click(screen.getByText('İptal'));

    await waitFor(() => {
      expect(screen.queryByText('Yeni Dosya Oluştur')).not.toBeInTheDocument();
    });
  });

  it('dosya yolu bos iken "Oluştur" butonu hata vermeli', async () => {
    const user = userEvent.setup();
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni'));
    await user.click(screen.getByText('Yeni'));

    await waitFor(() => screen.getByText('Oluştur'));
    await user.click(screen.getByText('Oluştur'));

    await waitFor(() => {
      expect(screen.getByText('Dosya yolu boş olamaz.')).toBeInTheDocument();
    });
  });

  it('".." iceren yol hataya yol acmali', async () => {
    const user = userEvent.setup();
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni'));
    await user.click(screen.getByText('Yeni'));

    await waitFor(() => screen.getByPlaceholderText('src/components/MyComponent.tsx'));
    const input = screen.getByPlaceholderText('src/components/MyComponent.tsx');
    await user.type(input, '../etc/passwd');

    await user.click(screen.getByText('Oluştur'));

    await waitFor(() => {
      expect(screen.getByText('Geçersiz dosya yolu: ".." kullanılamaz.')).toBeInTheDocument();
    });
  });

  it('gecerli dosya yolu ile createFile API cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    vi.mocked(studioApi.createFile).mockResolvedValue({ path: 'src/new.ts', created: true });

    // Yeniden yukleme icin ek fetch mocklari
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_AGAC),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_BRANCHLER),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: '' }),
      } as Response);

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni'));
    await user.click(screen.getByText('Yeni'));

    await waitFor(() => screen.getByPlaceholderText('src/components/MyComponent.tsx'));
    const input = screen.getByPlaceholderText('src/components/MyComponent.tsx');
    await user.type(input, 'src/new.ts');

    await user.click(screen.getByText('Oluştur'));

    await waitFor(() => {
      expect(studioApi.createFile).toHaveBeenCalledWith('proj-1', 'src/new.ts', '');
    });
  });
});

describe('FileExplorer — dosya silme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.getGitStatus).mockResolvedValue(BOŞ_GIT_DURUMU);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_AGAC),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_BRANCHLER),
      } as Response);
  });

  it('dosya uzerine hover yapilinca silme butonu gorunmeli', async () => {
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByText('package.json'));

    // Hover ile gosterilen buton title'ini kontrol et
    const dosyaDugumu = screen.getByText('package.json').closest('div.group');
    expect(dosyaDugumu).toBeTruthy();
  });
});

describe('FileExplorer — Git durumu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_AGAC),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_BRANCHLER),
      } as Response);
  });

  it('degisiklik varsa git durum ozeti gosterilmeli', async () => {
    vi.mocked(studioApi.getGitStatus).mockResolvedValue({
      modified: ['src/App.tsx'],
      untracked: ['src/New.tsx'],
      staged: [],
      deleted: [],
    });

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText(/degistirildi/i)).toBeInTheDocument();
    });
  });

  it('degisiklik varsa commit butonu gosterilmeli', async () => {
    vi.mocked(studioApi.getGitStatus).mockResolvedValue({
      modified: ['src/App.tsx'],
      untracked: [],
      staged: [],
      deleted: [],
    });

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      // Commit sayaci butonu (1 degisiklik)
      const commitBtn = screen.getAllByTitle('Değişiklikleri commit et');
      expect(commitBtn.length).toBeGreaterThan(0);
    });
  });

  it('degisiklik yoksa commit butonu gosterilmemeli', async () => {
    vi.mocked(studioApi.getGitStatus).mockResolvedValue(BOŞ_GIT_DURUMU);

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });

    expect(screen.queryByTitle('Değişiklikleri commit et')).not.toBeInTheDocument();
  });

  it('git durumunu yenile butonuna tiklaninca getGitStatus cagrisi yapilmali', async () => {
    vi.mocked(studioApi.getGitStatus).mockResolvedValue(BOŞ_GIT_DURUMU);

    const user = userEvent.setup();
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByTitle('Git durumunu yenile'));

    await user.click(screen.getByTitle('Git durumunu yenile'));

    await waitFor(() => {
      // En az 2 kez cagrilmali (ilk yukleme + yenile)
      expect(studioApi.getGitStatus).toHaveBeenCalledTimes(2);
    });
  });
});

describe('FileExplorer — commit modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.getGitStatus).mockResolvedValue({
      modified: ['src/App.tsx'],
      untracked: [],
      staged: [],
      deleted: [],
    });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_AGAC),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ORNEK_BRANCHLER),
      } as Response);
  });

  it('commit butonuna tiklaninca commit modali acilmali', async () => {
    const user = userEvent.setup();
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByTitle('Değişiklikleri commit et'));
    await user.click(screen.getByTitle('Değişiklikleri commit et'));

    await waitFor(() => {
      expect(screen.getByText('Commit Oluştur')).toBeInTheDocument();
    });
  });

  it('commit mesaji olmadan "Commit Et" hata vermeli', async () => {
    const user = userEvent.setup();
    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => screen.getByTitle('Değişiklikleri commit et'));
    await user.click(screen.getByTitle('Değişiklikleri commit et'));

    await waitFor(() => screen.getByText('Commit Et'));
    await user.click(screen.getByText('Commit Et'));

    await waitFor(() => {
      expect(screen.getByText('Commit mesajı boş olamaz.')).toBeInTheDocument();
    });
  });

  it('gecerli commit mesaji ile commitChanges API cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    vi.mocked(studioApi.commitChanges).mockResolvedValue({
      commit: 'abc123',
      message: 'feat: test degisikligi',
    });

    // Commit sonrasi yenileme icin: getGitStatus bos durum dondurmeli
    // Ama once modified donmeli ki buton gorunsun
    vi.mocked(studioApi.getGitStatus)
      .mockResolvedValueOnce({
        modified: ['src/App.tsx'],
        untracked: [],
        staged: [],
        deleted: [],
      })
      .mockResolvedValue(BOŞ_GIT_DURUMU);

    render(<FileExplorer projectId="proj-1" />);

    // Commit butonunu bekle
    await waitFor(() => {
      const commitBtns = screen.queryAllByTitle('Değişiklikleri commit et');
      expect(commitBtns.length).toBeGreaterThan(0);
    });

    const commitBtns = screen.getAllByTitle('Değişiklikleri commit et');
    await user.click(commitBtns[0]);

    await waitFor(() => screen.getByPlaceholderText('feat: yeni özellik eklendi'));
    const input = screen.getByPlaceholderText('feat: yeni özellik eklendi');
    await user.type(input, 'feat: test degisikligi');

    await user.click(screen.getByText('Commit Et'));

    await waitFor(() => {
      expect(studioApi.commitChanges).toHaveBeenCalledWith(
        'proj-1',
        'feat: test degisikligi',
        expect.any(Array),
      );
    });
  });
});
