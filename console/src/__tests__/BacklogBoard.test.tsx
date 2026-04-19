import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BacklogBoard from '../pages/studio/BacklogBoard';

// WorkItem ve Sprint tipleri (bileşen içi tanımlı, burada tekrar ediyoruz)
type WorkItemType = 'feature' | 'bug' | 'defect' | 'security' | 'hotfix' | 'improvement';
type WorkItemStatus = 'open' | 'planned' | 'in_progress' | 'done' | 'closed' | 'wontfix';
type Priority = 'critical' | 'high' | 'medium' | 'low';

interface WorkItem {
	id: string;
	title: string;
	description?: string;
	type: WorkItemType;
	status: WorkItemStatus;
	priority: Priority;
	labels?: string[];
	source?: string;
	sprintId?: string | null;
	createdAt: string;
}

// Örnek work item'ları
const ORNEK_ITEMS: WorkItem[] = [
	{
		id: 'wi-1',
		title: 'Kullanıcı giriş sayfası',
		description: 'JWT tabanlı giriş formu',
		type: 'feature',
		status: 'open',
		priority: 'high',
		labels: ['auth'],
		source: 'pm-agent',
		sprintId: null,
		createdAt: '2026-04-01T10:00:00Z',
	},
	{
		id: 'wi-2',
		title: 'API 500 hatası düzelt',
		description: 'POST /api/users endpoint çöküyor',
		type: 'bug',
		status: 'in_progress',
		priority: 'critical',
		labels: [],
		source: 'qa-agent',
		sprintId: 'sprint-1',
		createdAt: '2026-04-02T09:00:00Z',
	},
	{
		id: 'wi-3',
		title: 'Veritabanı indeksleri ekle',
		type: 'improvement',
		status: 'done',
		priority: 'medium',
		sprintId: null,
		createdAt: '2026-04-03T08:00:00Z',
	},
	{
		id: 'wi-4',
		title: 'SQL injection zafiyeti',
		type: 'security',
		status: 'planned',
		priority: 'critical',
		sprintId: null,
		createdAt: '2026-04-04T07:00:00Z',
	},
	{
		id: 'wi-5',
		title: 'Hotfix — prod çöktü',
		type: 'hotfix',
		status: 'closed',
		priority: 'critical',
		sprintId: null,
		createdAt: '2026-04-05T06:00:00Z',
	},
	{
		id: 'wi-6',
		title: 'Eski log formatını kaldır',
		type: 'defect',
		status: 'wontfix',
		priority: 'low',
		sprintId: null,
		createdAt: '2026-04-06T05:00:00Z',
	},
];

const ORNEK_SPRINTS = [
	{ id: 'sprint-1', name: 'Sprint 1', status: 'active' },
	{ id: 'sprint-2', name: 'Sprint 2', status: 'planned' },
];

// fetch mock yardımcı fonksiyon — başarılı JSON yanıtı döner
// fetchPaginated X-Total-Count header'ı beklediğinden headers mock'u da ekliyoruz
function fetchBasariMock(workItems: WorkItem[] = ORNEK_ITEMS, sprints = ORNEK_SPRINTS) {
	return vi.fn().mockImplementation((url: string) => {
		if (url.includes('/sprints')) {
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(sprints),
				headers: { get: () => null },
			});
		}
		const headers = {
			get: (name: string) => name === 'X-Total-Count' ? String(workItems.length) : null,
		};
		return Promise.resolve({ ok: true, json: () => Promise.resolve(workItems), headers });
	});
}

// fetch mock — sonsuz bekleyen (loading state testi için)
function fetchSonsuzmock() {
	return vi.fn().mockImplementation(() => new Promise(() => {}));
}

describe('BacklogBoard — yükleme durumu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('veri yüklenirken spinner gösterilmeli', () => {
		// fetch asla çözümlenmez — loading state'de kalır
		global.fetch = fetchSonsuzmock();

		render(<BacklogBoard projectId="proj-1" />);

		const spinner = document.querySelector('.animate-spin');
		expect(spinner).toBeTruthy();
	});

	it('yükleme tamamlandıktan sonra spinner kaybolmalı', async () => {
		global.fetch = fetchBasariMock();

		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			const spinner = document.querySelector('.animate-spin');
			expect(spinner).toBeFalsy();
		});
	});
});

describe('BacklogBoard — başlık ve header', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = fetchBasariMock();
	});

	it('"Backlog" başlığını göstermeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Backlog')).toBeInTheDocument();
		});
	});

	it('work item sayısını header\'da göstermeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// ORNEK_ITEMS 6 item içeriyor
			expect(screen.getByText('6 work items')).toBeInTheDocument();
		});
	});

	it('"New Work Item" butonu gösterilmeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('New Work Item')).toBeInTheDocument();
		});
	});

	it('"Filter" butonu gösterilmeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Filter')).toBeInTheDocument();
		});
	});
});

describe('BacklogBoard — kolon yapısı', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = fetchBasariMock();
	});

	it('tüm kolonları göstermeli: Open, Planned, In Progress, Done, Closed, Won\'t Fix', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// Kolon başlıkları uppercase span olarak render ediliyor — getAllByText kullanıyoruz
			// çünkü select option'ları ile çakışabilir
			expect(screen.getAllByText('Open').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('Planned').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText("Won't Fix").length).toBeGreaterThanOrEqual(1);

			// Kolon başlıkları span.text-[12px] olarak rendering edilmeli
			const kolonBasliklari = document.querySelectorAll('span.text-\\[12px\\]');
			const kolonMetinleri = Array.from(kolonBasliklari).map((el) => el.textContent?.trim());
			expect(kolonMetinleri).toContain('Open');
			expect(kolonMetinleri).toContain('Planned');
			expect(kolonMetinleri).toContain('In Progress');
			expect(kolonMetinleri).toContain('Done');
			expect(kolonMetinleri).toContain('Closed');
			expect(kolonMetinleri).toContain("Won't Fix");
		});
	});

	it('boş kolonlar "No items" mesajı göstermeli', async () => {
		// Sadece "open" statüslü item var, diğer kolonlar boş olmalı
		global.fetch = fetchBasariMock([ORNEK_ITEMS[0]]);

		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// Boş kolonlar var (planned, in_progress, done, closed, wontfix)
			const bosMetinler = screen.getAllByText('No items');
			expect(bosMetinler.length).toBeGreaterThanOrEqual(5);
		});
	});

	it('tüm work item\'lar boşsa tüm kolonlar "No items" göstermeli', async () => {
		global.fetch = fetchBasariMock([]);

		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			const bosMetinler = screen.getAllByText('No items');
			expect(bosMetinler.length).toBe(6); // 6 kolon hepsi boş
		});
	});
});

describe('BacklogBoard — work item\'ların doğru kolonlarda görünmesi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = fetchBasariMock();
	});

	it('"open" statüslü item "Open" kolonunda görünmeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Kullanıcı giriş sayfası')).toBeInTheDocument();
		});
	});

	it('"in_progress" statüslü item "In Progress" kolonunda görünmeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('API 500 hatası düzelt')).toBeInTheDocument();
		});
	});

	it('"done" statüslü item "Done" kolonunda görünmeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Veritabanı indeksleri ekle')).toBeInTheDocument();
		});
	});

	it('"planned" statüslü item "Planned" kolonunda görünmeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('SQL injection zafiyeti')).toBeInTheDocument();
		});
	});

	it('"closed" statüslü item "Closed" kolonunda görünmeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Hotfix — prod çöktü')).toBeInTheDocument();
		});
	});

	it('"wontfix" statüslü item "Won\'t Fix" kolonunda görünmeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Eski log formatını kaldır')).toBeInTheDocument();
		});
	});

	it('her kolon item sayısını rozet olarak göstermeli', async () => {
		// ORNEK_ITEMS: open×1, in_progress×1, done×1, planned×1, closed×1, wontfix×1
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// Her kolonun sayı rozeti "1" olmalı — 6 adet
			const birler = screen.getAllByText('1');
			expect(birler.length).toBe(6);
		});
	});
});

describe('BacklogBoard — etiket ve öncelik gösterimi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = fetchBasariMock();
	});

	it('item label\'larını göstermeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// wi-1'in "auth" etiketi var
			expect(screen.getByText('auth')).toBeInTheDocument();
		});
	});

	it('item source bilgisini göstermeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// wi-1'in source = "pm-agent"
			expect(screen.getByText('pm-agent')).toBeInTheDocument();
		});
	});

	it('priority badge\'larını göstermeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// "high" öncelikli item var
			expect(screen.getByText('high')).toBeInTheDocument();
		});
	});
});

describe('BacklogBoard — "open" statüsündeki item\'larda Convert butonu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = fetchBasariMock();
	});

	it('"open" statüslü item\'da "Convert" butonu görünmeli', async () => {
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// wi-1 open statüsünde
			expect(screen.getByText('Convert')).toBeInTheDocument();
		});
	});

	it('"open" olmayan item\'larda "Convert" butonu olmamalı', async () => {
		// Sadece "done" statüslü item
		global.fetch = fetchBasariMock([ORNEK_ITEMS[2]]); // wi-3 done

		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.queryByText('Convert')).not.toBeInTheDocument();
		});
	});

	it('"Convert" butonuna tıklanınca doğru API endpoint\'i çağrılmalı', async () => {
		const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
			// work-items/wi-1/plan POST sonrası yeniden yükleme için items döner
			if (url.includes('/plan') && opts?.method === 'POST') {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
			}
			if (url.includes('/sprints')) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_SPRINTS), headers: { get: () => null } });
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_ITEMS), headers: { get: (n: string) => n === 'X-Total-Count' ? String(ORNEK_ITEMS.length) : null } });
		});
		global.fetch = fetchMock;

		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('Convert'));
		await user.click(screen.getByText('Convert'));

		await waitFor(() => {
			// /work-items/wi-1/plan endpoint'i POST ile çağrılmalı
			const planCagrisi = fetchMock.mock.calls.find(
				([url, opts]) => url.includes('/work-items/wi-1/plan') && opts?.method === 'POST',
			);
			expect(planCagrisi).toBeTruthy();
		});
	});

	it('convert API başarısız olunca alert göstermeli', async () => {
		const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});

		const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
			if (url.includes('/plan') && opts?.method === 'POST') {
				return Promise.resolve({
					ok: false,
					json: () => Promise.resolve({ error: 'Plan oluşturulamadı' }),
				});
			}
			if (url.includes('/sprints')) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_SPRINTS), headers: { get: () => null } });
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_ITEMS), headers: { get: (n: string) => n === 'X-Total-Count' ? String(ORNEK_ITEMS.length) : null } });
		});
		global.fetch = fetchMock;

		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('Convert'));
		await user.click(screen.getByText('Convert'));

		await waitFor(() => {
			expect(alertMock).toHaveBeenCalledWith('Plan oluşturulamadı');
		});

		alertMock.mockRestore();
	});
});

describe('BacklogBoard — status değişikliği', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('status dropdown değişince PATCH API çağrılmalı', async () => {
		const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
			if (opts?.method === 'PATCH') {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
			}
			if (url.includes('/sprints')) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_SPRINTS), headers: { get: () => null } });
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_ITEMS), headers: { get: (n: string) => n === 'X-Total-Count' ? String(ORNEK_ITEMS.length) : null } });
		});
		global.fetch = fetchMock;

		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		// Status dropdown'larını bekle
		await waitFor(() => {
			// wi-1 (open) kartındaki Status select'i
			const statusSelects = screen.getAllByRole('combobox', { name: /status/i });
			expect(statusSelects.length).toBeGreaterThan(0);
		});

		const statusSelects = screen.getAllByRole('combobox', { name: /status/i });
		// İlk status select'i "planned" olarak değiştir
		await user.selectOptions(statusSelects[0], 'planned');

		await waitFor(() => {
			// PATCH çağrısı yapılmalı
			const patchCagrisi = fetchMock.mock.calls.find(
				([_, opts]) => opts?.method === 'PATCH',
			);
			expect(patchCagrisi).toBeTruthy();

			// Body'de status: "planned" olmalı
			const body = JSON.parse(patchCagrisi?.[1]?.body as string);
			expect(body.status).toBe('planned');
		});
	});
});

describe('BacklogBoard — silme işlemi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('silme butonuna tıklanınca DELETE API çağrılmalı', async () => {
		const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
			if (opts?.method === 'DELETE') {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
			}
			if (url.includes('/sprints')) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_SPRINTS), headers: { get: () => null } });
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_ITEMS), headers: { get: (n: string) => n === 'X-Total-Count' ? String(ORNEK_ITEMS.length) : null } });
		});
		global.fetch = fetchMock;

		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// Silme butonları (Trash2 icon, title="Sil") var
			const silButonlari = screen.getAllByTitle('Sil');
			expect(silButonlari.length).toBeGreaterThan(0);
		});

		const silButonlari = screen.getAllByTitle('Sil');
		// İlk silme butonuna tıkla (wi-1)
		await user.click(silButonlari[0]);

		await waitFor(() => {
			const deleteCagrisi = fetchMock.mock.calls.find(
				([_, opts]) => opts?.method === 'DELETE',
			);
			expect(deleteCagrisi).toBeTruthy();
			// work-items/wi-1 URL'i çağrılmalı
			expect(deleteCagrisi?.[0]).toContain('/work-items/wi-1');
		});
	});
});

describe('BacklogBoard — yeni item oluşturma modal\'ı', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = fetchBasariMock();
	});

	it('"New Work Item" butonuna tıklanınca modal açılmalı', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('New Work Item'));
		await user.click(screen.getByText('New Work Item'));

		await waitFor(() => {
			expect(screen.getByText('New Work Item', { selector: 'h2' })).toBeInTheDocument();
		});
	});

	it('modal "Title" input alanı içermeli', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('New Work Item'));
		await user.click(screen.getByText('New Work Item'));

		await waitFor(() => {
			expect(screen.getByPlaceholderText('Work item title...')).toBeInTheDocument();
		});
	});

	it('modal "Type" ve "Priority" select\'lerini içermeli', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('New Work Item'));
		await user.click(screen.getByText('New Work Item'));

		await waitFor(() => {
			expect(screen.getByText('Type')).toBeInTheDocument();
			expect(screen.getByText('Priority')).toBeInTheDocument();
		});
	});

	it('başlık boşken "Create" butonu devre dışı olmalı', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('New Work Item'));
		await user.click(screen.getByText('New Work Item'));

		await waitFor(() => {
			const createButonu = screen.getByText('Create').closest('button');
			expect(createButonu).toBeDisabled();
		});
	});

	it('"Cancel" butonuna tıklanınca modal kapanmalı', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('New Work Item'));
		await user.click(screen.getByText('New Work Item'));

		await waitFor(() => screen.getByText('Cancel'));
		await user.click(screen.getByText('Cancel'));

		await waitFor(() => {
			// "New Work Item" h2 başlığı artık görünmemeli
			expect(screen.queryByRole('heading', { name: 'New Work Item' })).not.toBeInTheDocument();
		});
	});

	it('doldurulmuş form submit edilince POST API çağrılmalı', async () => {
		const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
			if (opts?.method === 'POST') {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
			}
			if (url.includes('/sprints')) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_SPRINTS), headers: { get: () => null } });
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_ITEMS), headers: { get: (n: string) => n === 'X-Total-Count' ? String(ORNEK_ITEMS.length) : null } });
		});
		global.fetch = fetchMock;

		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('New Work Item'));
		await user.click(screen.getByText('New Work Item'));

		await waitFor(() => screen.getByPlaceholderText('Work item title...'));

		// Başlık gir
		await user.type(screen.getByPlaceholderText('Work item title...'), 'Yeni özellik');

		// Create butonuna tıkla
		const createButonu = screen.getByText('Create').closest('button') as HTMLButtonElement;
		expect(createButonu).not.toBeDisabled();
		await user.click(createButonu);

		await waitFor(() => {
			// work-items endpoint'ine POST çağrısı yapılmalı
			const postCagrisi = fetchMock.mock.calls.find(
				([url, opts]) =>
					url.includes('/work-items') &&
					!url.includes('/plan') &&
					opts?.method === 'POST',
			);
			expect(postCagrisi).toBeTruthy();

			// Body'de title olmalı
			const body = JSON.parse(postCagrisi?.[1]?.body as string);
			expect(body.title).toBe('Yeni özellik');
		});
	});

	it('form submit sonrası modal kapanmalı', async () => {
		const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
			if (opts?.method === 'POST') {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
			}
			if (url.includes('/sprints')) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_SPRINTS), headers: { get: () => null } });
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_ITEMS), headers: { get: (n: string) => n === 'X-Total-Count' ? String(ORNEK_ITEMS.length) : null } });
		});
		global.fetch = fetchMock;

		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('New Work Item'));
		await user.click(screen.getByText('New Work Item'));

		await waitFor(() => screen.getByPlaceholderText('Work item title...'));
		await user.type(screen.getByPlaceholderText('Work item title...'), 'Test item');
		await user.click(screen.getByText('Create').closest('button') as HTMLButtonElement);

		await waitFor(() => {
			expect(screen.queryByRole('heading', { name: 'New Work Item' })).not.toBeInTheDocument();
		});
	});
});

describe('BacklogBoard — filtre işlevselliği', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = fetchBasariMock();
	});

	it('"Filter" butonuna tıklanınca filtre paneli açılmalı', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('Filter'));
		await user.click(screen.getByText('Filter'));

		await waitFor(() => {
			// Filtre paneli içinde "Type:" ve "Priority:" etiketleri görünmeli
			expect(screen.getByText('Type:')).toBeInTheDocument();
			expect(screen.getByText('Priority:')).toBeInTheDocument();
			expect(screen.getByText('Source:')).toBeInTheDocument();
		});
	});

	it('type filtresi uygulandığında sadece ilgili item\'lar gösterilmeli', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('Filter'));
		await user.click(screen.getByText('Filter'));

		await waitFor(() => screen.getByText('Type:'));

		// Filtre paneli içindeki tüm "All" değeri olan select'leri al
		// Type filtresi "Feature", "Bug" seçenekleri olan ilk All select'i
		const tumSelects = screen.getAllByDisplayValue('All');
		// İlk select type filter (Feature/Bug/... seçenekleri var)
		const typeSelect = tumSelects[0];
		await user.selectOptions(typeSelect, 'bug');

		await waitFor(() => {
			// Sadece bug item'ı görünmeli
			expect(screen.getByText('API 500 hatası düzelt')).toBeInTheDocument();
			// feature item'ı görünmemeli
			expect(screen.queryByText('Kullanıcı giriş sayfası')).not.toBeInTheDocument();
		});
	});

	it('priority filtresi uygulandığında sadece ilgili öncelikler gösterilmeli', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('Filter'));
		await user.click(screen.getByText('Filter'));

		await waitFor(() => screen.getByText('Priority:'));

		// Priority filtresi — "medium" seç
		const prioritySelects = screen.getAllByDisplayValue('All');
		// İkinci "All" select'i priority filter'ı
		await user.selectOptions(prioritySelects[1], 'medium');

		await waitFor(() => {
			// Sadece medium öncelikli item görünmeli
			expect(screen.getByText('Veritabanı indeksleri ekle')).toBeInTheDocument();
			// critical item'lar görünmemeli
			expect(screen.queryByText('API 500 hatası düzelt')).not.toBeInTheDocument();
		});
	});

	it('source filtresi uygulandığında sadece ilgili kaynaklı item\'lar gösterilmeli', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('Filter'));
		await user.click(screen.getByText('Filter'));

		await waitFor(() => screen.getByText('Source:'));

		// Source input'a "qa-agent" yaz
		const sourceInput = screen.getByPlaceholderText('Filter by source...');
		await user.type(sourceInput, 'qa-agent');

		await waitFor(() => {
			// Sadece qa-agent source'lu item görünmeli
			expect(screen.getByText('API 500 hatası düzelt')).toBeInTheDocument();
			// pm-agent source'lu item görünmemeli
			expect(screen.queryByText('Kullanıcı giriş sayfası')).not.toBeInTheDocument();
		});
	});

	it('filtreler aktifken "Clear" butonu görünmeli', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('Filter'));
		await user.click(screen.getByText('Filter'));

		await waitFor(() => screen.getByText('Type:'));

		// Type filtresi uygula — getAllByDisplayValue ile ilkini seç
		const tumSelects = screen.getAllByDisplayValue('All');
		await user.selectOptions(tumSelects[0], 'bug');

		await waitFor(() => {
			expect(screen.getByText('Clear')).toBeInTheDocument();
		});
	});

	it('"Clear" butonuna tıklanınca tüm filtreler temizlenmeli', async () => {
		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => screen.getByText('Filter'));
		await user.click(screen.getByText('Filter'));

		await waitFor(() => screen.getByText('Type:'));

		// Filtre uygula — getAllByDisplayValue ile ilkini seç
		const tumSelects = screen.getAllByDisplayValue('All');
		await user.selectOptions(tumSelects[0], 'bug');

		await waitFor(() => screen.getByText('Clear'));
		await user.click(screen.getByText('Clear'));

		await waitFor(() => {
			// Tüm item'lar tekrar görünmeli
			expect(screen.getByText('Kullanıcı giriş sayfası')).toBeInTheDocument();
			expect(screen.getByText('API 500 hatası düzelt')).toBeInTheDocument();
		});
	});
});

describe('BacklogBoard — sprint atama', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sprint dropdown\'larını sprint seçenekleriyle göstermeli', async () => {
		global.fetch = fetchBasariMock();

		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// "Sprint 1" ve "Sprint 2" seçenekleri mevcut olmalı
			const sprint1Secenekler = screen.getAllByText('Sprint 1');
			expect(sprint1Secenekler.length).toBeGreaterThan(0);
		});
	});

	it('sprint atandığında PATCH API çağrılmalı', async () => {
		const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
			if (opts?.method === 'PATCH') {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
			}
			if (url.includes('/sprints')) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_SPRINTS), headers: { get: () => null } });
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_ITEMS), headers: { get: (n: string) => n === 'X-Total-Count' ? String(ORNEK_ITEMS.length) : null } });
		});
		global.fetch = fetchMock;

		const user = userEvent.setup();
		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// Sprint dropdown'larını bekle
			const sprintSelects = screen.getAllByRole('combobox', { name: /sprint/i });
			expect(sprintSelects.length).toBeGreaterThan(0);
		});

		const sprintSelects = screen.getAllByRole('combobox', { name: /sprint/i });
		// İlk sprint select'ini Sprint 1 olarak değiştir
		await user.selectOptions(sprintSelects[0], 'sprint-1');

		await waitFor(() => {
			const patchCagrisi = fetchMock.mock.calls.find(
				([_, opts]) => opts?.method === 'PATCH',
			);
			expect(patchCagrisi).toBeTruthy();

			const body = JSON.parse(patchCagrisi?.[1]?.body as string);
			expect(body.sprintId).toBe('sprint-1');
		});
	});
});

describe('BacklogBoard — API hata yönetimi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('work-items API başarısız olursa yine de render edilmeli', async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error('Ağ hatası'));

		render(<BacklogBoard projectId="proj-1" />);

		// Yükleme sonrası boş board render edilmeli (hata state'i yok, sadece boş)
		await waitFor(() => {
			// Spinner kaybolmalı
			const spinner = document.querySelector('.animate-spin');
			expect(spinner).toBeFalsy();
		});
	});

	it('sprint API başarısız olursa work item\'lar yine de gösterilmeli', async () => {
		global.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes('/sprints')) {
				return Promise.reject(new Error('Sprint API hatası'));
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve(ORNEK_ITEMS), headers: { get: (n: string) => n === 'X-Total-Count' ? String(ORNEK_ITEMS.length) : null } });
		});

		render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			// Work item'lar görünmeli (sprint yüklenemese de)
			expect(screen.getByText('Kullanıcı giriş sayfası')).toBeInTheDocument();
		});
	});
});

describe('BacklogBoard — fetch yeniden çağrımı', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('projectId değişince yeni fetch yapılmalı', async () => {
		const fetchMock = fetchBasariMock();
		global.fetch = fetchMock;

		const { rerender } = render(<BacklogBoard projectId="proj-1" />);

		await waitFor(() => {
			const urls = fetchMock.mock.calls.map(([url]) => url as string);
			expect(urls.some((u) => u.includes('/projects/proj-1/work-items'))).toBe(true);
		});

		// projectId değiştir
		await act(async () => {
			rerender(<BacklogBoard projectId="proj-2" />);
		});

		await waitFor(() => {
			const urls = fetchMock.mock.calls.map(([url]) => url as string);
			expect(urls.some((u) => u.includes('/projects/proj-2/work-items'))).toBe(true);
		});
	});
});
