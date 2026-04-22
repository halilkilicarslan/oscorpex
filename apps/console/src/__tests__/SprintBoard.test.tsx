import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SprintBoard from '../pages/studio/SprintBoard';

// AgentAvatar bileşenini mockla (SprintBoard'da kullanılmıyor ama pattern tutarlılığı için)
vi.mock('../components/AgentAvatar', () => ({
  default: ({ name }: { name: string }) => <span data-testid="agent-avatar">{name}</span>,
}));

// ---------------------------------------------------------------------------
// Örnek veri sabitleri
// ---------------------------------------------------------------------------

const ORNEK_SPRINT_PLANNED = {
  id: 'sprint-1',
  name: 'Sprint 1',
  goal: 'Auth akışını tamamla',
  startDate: '2026-04-01',
  endDate: '2026-04-14',
  status: 'planned' as const,
  velocity: undefined,
  workItems: [
    { id: 'wi-1', title: 'Login formu', type: 'story', priority: 'high', status: 'open', sprintId: 'sprint-1' },
    { id: 'wi-2', title: 'JWT entegrasyonu', type: 'task', priority: 'medium', status: 'done', sprintId: 'sprint-1' },
  ],
};

const ORNEK_SPRINT_ACTIVE = {
  id: 'sprint-2',
  name: 'Sprint 2',
  goal: 'Dashboard geliştirme',
  startDate: '2026-04-15',
  endDate: '2026-04-28',
  status: 'active' as const,
  velocity: 5,
  workItems: [
    { id: 'wi-3', title: 'Grafik bileşeni', type: 'story', priority: 'high', status: 'in_progress', sprintId: 'sprint-2' },
    { id: 'wi-4', title: 'API entegrasyonu', type: 'task', priority: 'low', status: 'done', sprintId: 'sprint-2' },
    { id: 'wi-5', title: 'Unit testler', type: 'bug', priority: 'medium', status: 'open', sprintId: 'sprint-2' },
  ],
};

const ORNEK_ATANMAMIS_ITEMS = [
  { id: 'wi-10', title: 'Profil sayfası', type: 'story', priority: 'low', status: 'open', sprintId: null },
  { id: 'wi-11', title: 'Hata loglama', type: 'task', priority: 'medium', status: 'open', sprintId: null },
];

const ORNEK_TUM_ITEMS = [
  ...ORNEK_SPRINT_PLANNED.workItems,
  ...ORNEK_SPRINT_ACTIVE.workItems,
  ...ORNEK_ATANMAMIS_ITEMS,
];

const ORNEK_BURNDOWN = {
  data: [
    { date: '2026-04-15', remaining: 5 },
    { date: '2026-04-16', remaining: 4 },
    { date: '2026-04-17', remaining: 3 },
  ],
};

// ---------------------------------------------------------------------------
// fetch mock yardımcıları
// ---------------------------------------------------------------------------

/**
 * Tek bir URL pattern'ine göre fetch mock'u kur.
 * URL içerdiği anahtar kelimeye göre cevap döner.
 */
function kurFetchMock(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => {
    const urlStr = String(url);

    // Burndown endpoint
    if (urlStr.includes('/burndown')) {
      return { ok: true, json: async () => overrides.burndown ?? ORNEK_BURNDOWN };
    }
    // Velocity endpoint
    if (urlStr.includes('/velocity')) {
      return { ok: true, json: async () => overrides.velocity ?? { velocity: 8 } };
    }
    // Work items endpoint
    if (urlStr.includes('/work-items')) {
      return { ok: true, json: async () => overrides.workItems ?? ORNEK_TUM_ITEMS };
    }
    // Sprint lifecycle actions (start, complete, cancel) — POST
    if (urlStr.match(/\/sprints\/sprint-\d+\/(start|complete|cancel)$/)) {
      return { ok: true, json: async () => ({ success: true }) };
    }
    // Sprint work item assign — PATCH
    if (urlStr.match(/\/work-items\/wi-\d+$/)) {
      return { ok: true, json: async () => ({ success: true }) };
    }
    // Sprint create — POST /projects/:id/sprints (son kısım sadece "/sprints")
    if (urlStr.match(/\/projects\/[^/]+\/sprints$/) && (overrides._postSprints !== undefined)) {
      return overrides._postSprints as Response;
    }
    // Sprints list
    if (urlStr.match(/\/projects\/[^/]+\/sprints$/)) {
      return { ok: true, json: async () => overrides.sprints ?? [ORNEK_SPRINT_PLANNED, ORNEK_SPRINT_ACTIVE] };
    }

    return { ok: false, json: async () => ({ error: 'Not found' }) };
  });
}

// ---------------------------------------------------------------------------
// Testler
// ---------------------------------------------------------------------------

describe('SprintBoard — yükleme durumu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('veri yüklenirken spinner gösterilmeli', () => {
    // fetch hiç resolve etme → süresiz yükleme durumu
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('yükleme tamamlandıktan sonra spinner kaybolmalı', async () => {
    global.fetch = kurFetchMock() as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).toBeFalsy();
    });
  });
});

describe('SprintBoard — boş durum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sprint yoksa boş durum mesajı gösterilmeli', async () => {
    global.fetch = kurFetchMock({ sprints: [] }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      // Bileşen "No Sprints Yet" gösteriyor
      expect(screen.getByText('No Sprints Yet')).toBeInTheDocument();
    });
  });

  it('sprint yoksa "Create a sprint to start planning work." alt metni görünmeli', async () => {
    global.fetch = kurFetchMock({ sprints: [] }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Create a sprint to start planning work.')).toBeInTheDocument();
    });
  });

  it('sprint yokken bile "Yeni Sprint" butonu görünmeli', async () => {
    global.fetch = kurFetchMock({ sprints: [] }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Yeni Sprint')).toBeInTheDocument();
    });
  });
});

describe('SprintBoard — sprint listesi render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = kurFetchMock() as unknown as typeof fetch;
  });

  it('sprint sayısı header\'da gösterilmeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('2 sprints')).toBeInTheDocument();
    });
  });

  it('sprint adları select kutusunda listelenmeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      // Sprint adları hem option hem de başlık olarak görünebilir — getAllByText kullan
      const sprint1Items = screen.getAllByText('Sprint 1');
      const sprint2Items = screen.getAllByText('Sprint 2');
      expect(sprint1Items.length).toBeGreaterThanOrEqual(1);
      expect(sprint2Items.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('aktif sprint varsayılan olarak seçili gelmeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect((select as HTMLSelectElement).value).toBe('sprint-2');
    });
  });

  it('sprint hedefi (goal) gösterilmeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard geliştirme')).toBeInTheDocument();
    });
  });

  it('sprint statüs rozeti görünmeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });
});

describe('SprintBoard — istatistik kartları', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = kurFetchMock() as unknown as typeof fetch;
  });

  it('"Items" kartı doğru toplam item sayısını göstermeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      // Sprint 2 aktif olarak seçili — 3 work item
      expect(screen.getByText('Items')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('"Completed" kartı tamamlanan item sayısını göstermeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
      // Sprint 2'de 1 done item
      const completedValue = screen.getAllByText('1');
      expect(completedValue.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('"Sprint Vel." kartı sprint velocity değerini göstermeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Sprint Vel.')).toBeInTheDocument();
      // Sprint 2'nin velocity değeri 5
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('"Team Vel." kartı API\'den gelen team velocity değerini göstermeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Team Vel.')).toBeInTheDocument();
      // Mock velocity: 8
      expect(screen.getByText('8')).toBeInTheDocument();
    });
  });

  it('team velocity yoksa "—" gösterilmeli', async () => {
    global.fetch = kurFetchMock({ velocity: { velocity: null } }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  it('velocity endpoint başarısız olunca "—" gösterilmeli', async () => {
    const fetchMock = kurFetchMock();
    // velocity için hata döndür
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/velocity')) {
        return { ok: false, json: async () => ({ error: 'Not found' }) };
      }
      return fetchMock(url);
    }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });
});

describe('SprintBoard — CreateSprintModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = kurFetchMock() as unknown as typeof fetch;
  });

  it('"Yeni Sprint" butonuna tıklayınca modal açılmalı', async () => {
    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Sprint'));
    await user.click(screen.getByText('Yeni Sprint'));

    expect(screen.getByText('New Sprint', { selector: 'h3' })).toBeInTheDocument();
  });

  it('modal kapatma butonu (X) ile modal kapanmalı', async () => {
    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Sprint'));
    await user.click(screen.getByText('Yeni Sprint'));

    // Modal açık
    const closeBtn = screen.getByLabelText('Close');
    await user.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'New Sprint' })).toBeFalsy();
    });
  });

  it('"İptal" butonuna tıklayınca modal kapanmalı', async () => {
    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Sprint'));
    await user.click(screen.getByText('Yeni Sprint'));

    // Modal içindeki Cancel butonunu bul (New Sprint h3'ünün parent modal div'i)
    const modal = screen.getByText('New Sprint', { selector: 'h3' }).closest('div.bg-\\[\\#111111\\]') as HTMLElement;
    await user.click(within(modal).getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('New Sprint', { selector: 'h3' })).toBeFalsy();
    });
  });

  it('varsayılan sprint adı "Sprint 3" olmalı (2 mevcut sprint + 1)', async () => {
    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Sprint'));
    await user.click(screen.getByText('Yeni Sprint'));

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('Sprint 1') as HTMLInputElement;
      expect(nameInput.value).toBe('Sprint 3');
    });
  });

  it('başarılı sprint oluşturma sonrası modal kapanmalı ve liste yenilenmeli', async () => {
    // POST /sprints için başarılı yanıt
    const baseFetch = kurFetchMock();
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (
        String(url).match(/\/projects\/[^/]+\/sprints$/) &&
        options?.method === 'POST'
      ) {
        return { ok: true, json: async () => ({ id: 'sprint-3', name: 'Sprint 3', status: 'planned' }) };
      }
      return baseFetch(url);
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Sprint'));
    await user.click(screen.getByText('Yeni Sprint'));

    // Form doldur ve gönder
    const goalInput = screen.getByPlaceholderText('Complete auth flow');
    await user.type(goalInput, 'Test hedefi');

    await user.click(screen.getByText('Create'));

    // Modal kapanmalı (New Sprint h3 kaybolmalı)
    await waitFor(() => {
      expect(screen.queryByText('New Sprint', { selector: 'h3' })).toBeFalsy();
    });
  });

  it('boş isim ile sprint oluşturmaya çalışınca hata gösterilmeli', async () => {
    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Sprint'));
    await user.click(screen.getByText('Yeni Sprint'));

    // İsim alanını temizle
    const nameInput = screen.getByPlaceholderText('Sprint 1') as HTMLInputElement;
    await user.clear(nameInput);

    await user.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });
  });

  it('bitiş tarihi başlangıçtan önce olunca doğrulama hatası gösterilmeli', async () => {
    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Sprint'));
    await user.click(screen.getByText('Yeni Sprint'));

    // Bitiş tarihini başlangıçtan önce ayarla
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const startInput = dateInputs[0] as HTMLInputElement;
    const endInput = dateInputs[1] as HTMLInputElement;

    await user.clear(startInput);
    await user.type(startInput, '2026-05-15');
    await user.clear(endInput);
    await user.type(endInput, '2026-05-01');

    await user.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(screen.getByText('End date cannot be before start date')).toBeInTheDocument();
    });
  });

  it('API hatası varsa modal içinde hata mesajı gösterilmeli', async () => {
    const baseFetch = kurFetchMock();
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (
        String(url).match(/\/projects\/[^/]+\/sprints$/) &&
        options?.method === 'POST'
      ) {
        return { ok: false, json: async () => ({ error: 'Sprint oluşturulamadı' }) };
      }
      return baseFetch(url);
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Sprint'));
    await user.click(screen.getByText('Yeni Sprint'));

    await user.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(screen.getByText('Sprint oluşturulamadı')).toBeInTheDocument();
    });
  });
});

describe('SprintBoard — work item picker (atama)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('atanmamış item varsa "Item ekle" butonu görünmeli', async () => {
    global.fetch = kurFetchMock() as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      // 2 atanmamış item var (wi-10, wi-11)
      expect(screen.getByText(/Item ekle \(2\)/)).toBeInTheDocument();
    });
  });

  it('"Item ekle" butonuna tıklanınca picker açılmalı', async () => {
    global.fetch = kurFetchMock() as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText(/Item ekle/));
    await user.click(screen.getByText(/Item ekle/));

    await waitFor(() => {
      expect(screen.getByText('Profil sayfası')).toBeInTheDocument();
      expect(screen.getByText('Hata loglama')).toBeInTheDocument();
    });
  });

  it('picker\'dan item seçilince PATCH isteği atılmalı ve liste yenilenmeli', async () => {
    const fetchSpy = kurFetchMock();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText(/Item ekle/));
    await user.click(screen.getByText(/Item ekle/));

    await waitFor(() => screen.getByText('Profil sayfası'));
    await user.click(screen.getByText('Profil sayfası'));

    await waitFor(() => {
      // PATCH çağrısı yapılmalı
      const calls = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls;
      const patchCall = calls.find(
        (args: any[]) =>
          String(args[0]).includes('wi-10') && args[1]?.method === 'PATCH',
      );
      expect(patchCall).toBeTruthy();
    });
  });

  it('picker item seçilince picker kapanmalı', async () => {
    global.fetch = kurFetchMock() as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText(/Item ekle/));
    await user.click(screen.getByText(/Item ekle/));

    await waitFor(() => screen.getByText('Profil sayfası'));
    await user.click(screen.getByText('Profil sayfası'));

    await waitFor(() => {
      expect(screen.queryByText('Profil sayfası')).toBeFalsy();
    });
  });

  it('tüm itemler atanmışsa "Item ekle" butonu görünmemeli', async () => {
    // Tüm itemlerin sprintId'si dolu
    const atamaItems = ORNEK_TUM_ITEMS.map((i) => ({ ...i, sprintId: 'sprint-2' }));
    global.fetch = kurFetchMock({ workItems: atamaItems }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.queryByText(/Item ekle/)).toBeFalsy();
    });
  });
});

describe('SprintBoard — item çıkarma (unassign)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = kurFetchMock() as unknown as typeof fetch;
  });

  it('work item listesinde item başlıkları gösterilmeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      // Sprint 2 aktif — work item başlıkları görünmeli
      expect(screen.getByText('Grafik bileşeni')).toBeInTheDocument();
      expect(screen.getByText('API entegrasyonu')).toBeInTheDocument();
      expect(screen.getByText('Unit testler')).toBeInTheDocument();
    });
  });

  it('item çıkarma butonuna tıklanınca PATCH sprintId=null ile çağrılmalı', async () => {
    const fetchSpy = kurFetchMock();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Grafik bileşeni'));

    // Unassign butonunu bul (title="Sprint'ten çıkar")
    const unassignBtns = screen.getAllByTitle('Remove from sprint');
    await user.click(unassignBtns[0]);

    await waitFor(() => {
      const calls = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls;
      const patchCall = calls.find(
        (args: any[]) =>
          String(args[0]).includes('/work-items/') &&
          args[1]?.method === 'PATCH' &&
          JSON.parse(args[1].body as string).sprintId === null,
      );
      expect(patchCall).toBeTruthy();
    });
  });
});

describe('SprintBoard — sprint yaşam döngüsü butonları', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('"planned" sprint için "Start" butonu görünmeli', async () => {
    // Sadece planned sprint döndür
    global.fetch = kurFetchMock({
      sprints: [ORNEK_SPRINT_PLANNED],
    }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Start')).toBeInTheDocument();
    });
  });

  it('"active" sprint için "Complete" butonu görünmeli', async () => {
    global.fetch = kurFetchMock({
      sprints: [ORNEK_SPRINT_ACTIVE],
    }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });
  });

  it('"planned" sprint için "Cancel" butonu görünmeli', async () => {
    global.fetch = kurFetchMock({
      sprints: [ORNEK_SPRINT_PLANNED],
    }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  it('"active" sprint için "Cancel" butonu görünmeli', async () => {
    global.fetch = kurFetchMock({
      sprints: [ORNEK_SPRINT_ACTIVE],
    }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  it('"completed" sprint için yaşam döngüsü butonu görünmemeli', async () => {
    global.fetch = kurFetchMock({
      sprints: [{ ...ORNEK_SPRINT_ACTIVE, id: 'sprint-c', status: 'completed' }],
    }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.queryByText('Start')).toBeFalsy();
      expect(screen.queryByText('Complete')).toBeFalsy();
      expect(screen.queryByText('Cancel')).toBeFalsy();
    });
  });

  it('"Start" butonuna tıklanınca POST /sprints/:id/start isteği atılmalı', async () => {
    const fetchSpy = kurFetchMock({ sprints: [ORNEK_SPRINT_PLANNED] });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Start'));
    await user.click(screen.getByText('Start'));

    await waitFor(() => {
      const calls = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls;
      const startCall = calls.find(
        (args: any[]) =>
          String(args[0]).includes('/start') && args[1]?.method === 'POST',
      );
      expect(startCall).toBeTruthy();
    });
  });

  it('"Complete" butonuna tıklanınca POST /sprints/:id/complete isteği atılmalı', async () => {
    const fetchSpy = kurFetchMock({ sprints: [ORNEK_SPRINT_ACTIVE] });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Complete'));
    await user.click(screen.getByText('Complete'));

    await waitFor(() => {
      const calls = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls;
      const completeCall = calls.find(
        (args: any[]) =>
          String(args[0]).includes('/complete') && args[1]?.method === 'POST',
      );
      expect(completeCall).toBeTruthy();
    });
  });

  it('"Cancel" butonuna tıklanınca POST /sprints/:id/cancel isteği atılmalı', async () => {
    const fetchSpy = kurFetchMock({ sprints: [ORNEK_SPRINT_PLANNED] });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Cancel'));
    await user.click(screen.getByText('Cancel'));

    await waitFor(() => {
      const calls = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = calls.find(
        (args: any[]) =>
          String(args[0]).includes('/cancel') && args[1]?.method === 'POST',
      );
      expect(cancelCall).toBeTruthy();
    });
  });
});

describe('SprintBoard — ilerleme çubuğu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = kurFetchMock() as unknown as typeof fetch;
  });

  it('item varken Progress satırı gösterilmeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Progress')).toBeInTheDocument();
    });
  });

  it('tamamlanma yüzdesi doğru hesaplanmalı', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      // Sprint 2: 1 done / 3 total = %33
      expect(screen.getByText('33%')).toBeInTheDocument();
    });
  });

  it('tüm itemler done ise %100 gösterilmeli', async () => {
    const tamam = [
      { id: 'wi-a', title: 'A', type: 'task', priority: 'low', status: 'done', sprintId: 'sprint-x' },
      { id: 'wi-b', title: 'B', type: 'task', priority: 'low', status: 'done', sprintId: 'sprint-x' },
    ];
    global.fetch = kurFetchMock({
      sprints: [{ ...ORNEK_SPRINT_ACTIVE, id: 'sprint-x', workItems: tamam }],
      workItems: tamam,
    }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });
});

describe('SprintBoard — burndown chart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('burndown verisi varken chart render edilmeli', async () => {
    global.fetch = kurFetchMock() as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Burndown Chart')).toBeInTheDocument();
    });
  });

  it('burndown gün sayısı doğru gösterilmeli', async () => {
    global.fetch = kurFetchMock() as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      // ORNEK_BURNDOWN.data.length = 3
      expect(screen.getByText('3 gün')).toBeInTheDocument();
    });
  });

  it('burndown verisi yokken "Henüz veri yok" mesajı gösterilmeli', async () => {
    global.fetch = kurFetchMock({ burndown: { data: [] } }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('No data yet')).toBeInTheDocument();
    });
  });
});

describe('SprintBoard — sprint seçimi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = kurFetchMock() as unknown as typeof fetch;
  });

  it('select değişince seçili sprint bilgileri güncellenmeli', async () => {
    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByRole('combobox'));

    // Sprint 1'i seç
    await user.selectOptions(screen.getByRole('combobox'), 'sprint-1');

    await waitFor(() => {
      // Sprint 1'in hedefi görünmeli
      expect(screen.getByText('Auth akışını tamamla')).toBeInTheDocument();
    });
  });

  it('sprint değişince burndown fetch\'i yeniden tetiklenmeli', async () => {
    const fetchSpy = kurFetchMock();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => screen.getByRole('combobox'));
    const ilkBurndownCagri = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => String(args[0]).includes('/burndown'),
    ).length;

    await user.selectOptions(screen.getByRole('combobox'), 'sprint-1');

    await waitFor(() => {
      const yeniBurndownCagri = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls.filter(
        (args: any[]) => String(args[0]).includes('/burndown'),
      ).length;
      expect(yeniBurndownCagri).toBeGreaterThan(ilkBurndownCagri);
    });
  });
});

describe('SprintBoard — work items listesi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = kurFetchMock() as unknown as typeof fetch;
  });

  it('item yoksa "No work items assigned to this sprint" mesajı gösterilmeli', async () => {
    global.fetch = kurFetchMock({
      sprints: [{ ...ORNEK_SPRINT_ACTIVE, workItems: [] }],
    }) as unknown as typeof fetch;

    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('No work items assigned to this sprint')).toBeInTheDocument();
    });
  });

  it('item type etiketi gösterilmeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      // Sprint 2'de "story", "task", "bug" tipleri var
      const storyBadges = screen.getAllByText('story');
      expect(storyBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('item statüsü gösterilmeli', async () => {
    render(<SprintBoard projectId="proj-1" />);

    await waitFor(() => {
      // "in progress" — status "in_progress" underscore replace ile
      expect(screen.getByText('in progress')).toBeInTheDocument();
    });
  });
});
