import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CeremonyPanel from '../pages/studio/CeremonyPanel';

// AgentAvatar bileşenini basit bir span ile mockla
vi.mock('../components/AgentAvatar', () => ({
	default: ({ name }: { avatar?: string; name: string; size?: string }) => (
		<span data-testid="agent-avatar">{name}</span>
	),
}));

// ---------------------------------------------------------------------------
// Test sabitleri
// ---------------------------------------------------------------------------

const PROJE_ID = 'proje-abc-123';

const ORNEK_STANDUP_YANITI = {
	runAt: '2026-04-16T09:00:00.000Z',
	agents: [
		{
			agentId: 'agent-1',
			agentName: 'Frontend Dev',
			role: 'frontend',
			completed: ['Login sayfası tamamlandı', 'Navbar bileşeni eklendi'],
			inProgress: ['Dashboard bileşeni üzerinde çalışılıyor'],
			blockers: [],
		},
		{
			agentId: 'agent-2',
			agentName: 'Backend Dev',
			role: 'backend',
			completed: [],
			inProgress: ['Auth API implementasyonu'],
			blockers: ['Veritabanı bağlantısı kesildi'],
		},
	],
};

const ORNEK_RETRO_YANITI = {
	runAt: '2026-04-15T18:00:00.000Z',
	data: {
		wentWell: ['Hızlı iterasyon', 'İyi iletişim'],
		couldImprove: ['Test kapsamı artırılabilir'],
		actionItems: ['Haftalık retrospektif toplantısı planlanacak'],
	},
	agentStats: [
		{
			agentId: 'agent-1',
			agentName: 'Frontend Dev',
			tasksCompleted: 8,
			avgRevisions: 1.25,
			successRate: 0.92,
		},
		{
			agentId: 'agent-2',
			agentName: 'Backend Dev',
			tasksCompleted: 5,
			avgRevisions: 1.8,
			successRate: 0.71,
		},
	],
};

// ---------------------------------------------------------------------------
// global.fetch mock yardımcısı
// ---------------------------------------------------------------------------

function fetchOlustur(yanit: unknown, ok = true): typeof fetch {
	return vi.fn().mockResolvedValue({
		ok,
		json: vi.fn().mockResolvedValue(yanit),
	}) as unknown as typeof fetch;
}

// Fetch'i sonsuz beklemede tut (yükleme durumu testi için)
function fetchAsla(): typeof fetch {
	return vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// 1. Yükleme durumu
// ---------------------------------------------------------------------------

describe('CeremonyPanel — yükleme durumu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('standup verisi yüklenirken spinner gösterilmeli', async () => {
		// Fetch hiç çözülmediğinde yükleme durumu devam eder
		global.fetch = fetchAsla();

		render(<CeremonyPanel projectId={PROJE_ID} />);

		// Spinner DOM'da bulunmalı
		await waitFor(() => {
			const spinner = document.querySelector('.animate-spin');
			expect(spinner).toBeTruthy();
		});
	});
});

// ---------------------------------------------------------------------------
// 2. Varsayılan sekme — Standup
// ---------------------------------------------------------------------------

describe('CeremonyPanel — varsayılan sekme', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('açılışta aktif sekme "Standup" olmalı', async () => {
		// Standup GET boş ajan listesiyle dönüyor
		global.fetch = fetchOlustur({ agents: [] });

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			// "Run Standup" butonu görünmeli — retro sekmesinde değil
			expect(screen.getByText('Run Standup')).toBeInTheDocument();
		});
	});

	it('başlangıçta "Run Standup" butonu mevcut olmalı, "Run Retrospective" olmamalı', async () => {
		global.fetch = fetchOlustur({ agents: [] });

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('Run Standup')).toBeInTheDocument();
			expect(screen.queryByText('Run Retrospective')).not.toBeInTheDocument();
		});
	});
});

// ---------------------------------------------------------------------------
// 3. Sekme geçişi
// ---------------------------------------------------------------------------

describe('CeremonyPanel — sekme geçişi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Retrospective sekmesine tıklanınca "Run Retrospective" butonu görünmeli', async () => {
		// İlk çağrı standup GET, ikinci çağrı retro GET
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ agents: [] }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI),
			});

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		// Standup verisi yüklensin
		await waitFor(() => screen.getByText('Run Standup'));

		// Retrospective sekmesine geç
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('Run Retrospective')).toBeInTheDocument();
			expect(screen.queryByText('Run Standup')).not.toBeInTheDocument();
		});
	});

	it('Standup sekmesine geri dönünce "Run Standup" tekrar görünmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ agents: [] }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI),
			});

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));

		// Retro sekmesine geç
		await user.click(screen.getByText('Retrospective'));
		await waitFor(() => screen.getByText('Run Retrospective'));

		// Standup'a geri dön
		await user.click(screen.getByText('Standup'));

		await waitFor(() => {
			expect(screen.getByText('Run Standup')).toBeInTheDocument();
		});
	});

	it('her iki sekme butonu da DOM\'da görünmeli', async () => {
		global.fetch = fetchOlustur({ agents: [] });

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Standup' })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Retrospective' })).toBeInTheDocument();
		});
	});
});

// ---------------------------------------------------------------------------
// 4. Standup görünümü
// ---------------------------------------------------------------------------

describe('CeremonyPanel — Standup görünümü', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('standup verisi yokken "No standup results yet" mesajı gösterilmeli', async () => {
		// ok:false veya parse edilemeyen yanıt — fetchCeremony null döndürür
		global.fetch = vi.fn().mockResolvedValue({ ok: false, json: vi.fn() }) as unknown as typeof fetch;

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('No standup results yet')).toBeInTheDocument();
		});
	});

	it('boş ajan listesiyle "No agents configured" mesajı gösterilmeli', async () => {
		global.fetch = fetchOlustur({ runAt: '2026-04-16T09:00:00.000Z', agents: [] });

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('No agents configured')).toBeInTheDocument();
		});
	});

	it('standup verisi gelince ajan adları görüntülenmeli', async () => {
		global.fetch = fetchOlustur(ORNEK_STANDUP_YANITI);

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('Frontend Dev')).toBeInTheDocument();
			expect(screen.getByText('Backend Dev')).toBeInTheDocument();
		});
	});

	it('ajan rolleri standup kartlarında görünmeli', async () => {
		global.fetch = fetchOlustur(ORNEK_STANDUP_YANITI);

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('frontend')).toBeInTheDocument();
			expect(screen.getByText('backend')).toBeInTheDocument();
		});
	});

	it('"Completed" bölümündeki görev maddeleri görüntülenmeli', async () => {
		global.fetch = fetchOlustur(ORNEK_STANDUP_YANITI);

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('Login sayfası tamamlandı')).toBeInTheDocument();
			expect(screen.getByText('Navbar bileşeni eklendi')).toBeInTheDocument();
		});
	});

	it('"In Progress" bölümündeki görevler görüntülenmeli', async () => {
		global.fetch = fetchOlustur(ORNEK_STANDUP_YANITI);

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('Dashboard bileşeni üzerinde çalışılıyor')).toBeInTheDocument();
		});
	});

	it('"Blockers" bölümündeki engelleyiciler görüntülenmeli', async () => {
		global.fetch = fetchOlustur(ORNEK_STANDUP_YANITI);

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('Veritabanı bağlantısı kesildi')).toBeInTheDocument();
		});
	});

	it('runAt değeri "Last run:" olarak formatlanmış şekilde gösterilmeli', async () => {
		global.fetch = fetchOlustur(ORNEK_STANDUP_YANITI);

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText(/Last run:/)).toBeInTheDocument();
		});
	});

	it('tüm alanları boş olan ajan "No updates" mesajı göstermeli', async () => {
		global.fetch = fetchOlustur({
			agents: [
				{
					agentId: 'agent-bos',
					agentName: 'Boş Ajan',
					role: 'tester',
					completed: [],
					inProgress: [],
					blockers: [],
				},
			],
		});

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('No updates')).toBeInTheDocument();
		});
	});
});

// ---------------------------------------------------------------------------
// 5. Retrospective görünümü
// ---------------------------------------------------------------------------

describe('CeremonyPanel — Retrospective görünümü', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('retro verisi yokken "No retrospective results yet" mesajı gösterilmeli', async () => {
		// Standup GET başarılı, Retro GET başarısız
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: false, json: vi.fn() });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('No retrospective results yet')).toBeInTheDocument();
		});
	});

	it('"What Went Well" sütunu görüntülenmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('What Went Well')).toBeInTheDocument();
		});
	});

	it('"Could Improve" sütunu görüntülenmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('Could Improve')).toBeInTheDocument();
		});
	});

	it('"Action Items" sütunu görüntülenmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('Action Items')).toBeInTheDocument();
		});
	});

	it('"wentWell" maddeleri listede görünmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('Hızlı iterasyon')).toBeInTheDocument();
			expect(screen.getByText('İyi iletişim')).toBeInTheDocument();
		});
	});

	it('"couldImprove" maddeleri listede görünmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('Test kapsamı artırılabilir')).toBeInTheDocument();
		});
	});

	it('"actionItems" maddeleri listede görünmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('Haftalık retrospektif toplantısı planlanacak')).toBeInTheDocument();
		});
	});

	it('agentStats tablosu "Agent Performance" başlığıyla görüntülenmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('Agent Performance')).toBeInTheDocument();
		});
	});

	it('ajan istatistikleri tabloda satır olarak gösterilmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			// Her iki ajan adı tablo satırlarında görünmeli
			const frontendItems = screen.getAllByText('Frontend Dev');
			const backendItems = screen.getAllByText('Backend Dev');
			expect(frontendItems.length).toBeGreaterThanOrEqual(1);
			expect(backendItems.length).toBeGreaterThanOrEqual(1);
		});
	});

	it('başarı oranı yüzde formatında gösterilmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			// Frontend Dev: 0.92 → %92, Backend Dev: 0.71 → %71
			expect(screen.getByText('92%')).toBeInTheDocument();
			expect(screen.getByText('71%')).toBeInTheDocument();
		});
	});
});

// ---------------------------------------------------------------------------
// 6. Run Standup butonu
// ---------------------------------------------------------------------------

describe('CeremonyPanel — Run Standup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('"Run Standup" tıklanınca POST isteği atılmalı ve sonuç gösterilmeli', async () => {
		// GET: boş, POST: dolu
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_STANDUP_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Run Standup'));

		await waitFor(() => {
			expect(screen.getByText('Frontend Dev')).toBeInTheDocument();
		});

		// POST isteğinin doğru URL ve method ile çağrıldığını doğrula
		const postCagrisi = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			(args) => args[1]?.method === 'POST',
		);
		expect(postCagrisi).toBeTruthy();
		expect(postCagrisi![0]).toContain(`/api/studio/projects/${PROJE_ID}/ceremonies/standup`);
	});

	it('"Run Standup" çalışırken buton "Running..." metnini göstermeli ve devre dışı olmalı', async () => {
		// GET başarılı, POST asla çözülmez (loading durumu devam eder)
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockReturnValueOnce(new Promise(() => {}));

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Run Standup'));

		await waitFor(() => {
			expect(screen.getByText('Running...')).toBeInTheDocument();
			const buton = screen.getByRole('button', { name: /running/i });
			expect(buton).toBeDisabled();
		});
	});
});

// ---------------------------------------------------------------------------
// 7. Run Retrospective butonu
// ---------------------------------------------------------------------------

describe('CeremonyPanel — Run Retrospective', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('"Run Retrospective" tıklanınca POST isteği atılmalı ve sonuç gösterilmeli', async () => {
		global.fetch = vi
			.fn()
			// Standup GET
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			// Retro GET — boş
			.mockResolvedValueOnce({ ok: false, json: vi.fn() })
			// Retro POST — dolu
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));
		await waitFor(() => screen.getByText('Run Retrospective'));

		await user.click(screen.getByText('Run Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('What Went Well')).toBeInTheDocument();
		});

		// POST isteğinin doğru path ile atıldığını doğrula
		const postCagrisi = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			(args) => args[1]?.method === 'POST',
		);
		expect(postCagrisi).toBeTruthy();
		expect(postCagrisi![0]).toContain(`/api/studio/projects/${PROJE_ID}/ceremonies/retrospective`);
	});

	it('"Run Retrospective" çalışırken buton "Running..." metnini göstermeli ve devre dışı olmalı', async () => {
		// URL'e göre ayrıştıran genel fetch mock: GET her zaman başarısız, POST asla çözülmez
		global.fetch = vi.fn().mockImplementation((_url: string, opts?: { method?: string }) => {
			const method = opts?.method ?? 'GET';
			if (method === 'POST') {
				// POST çağrısı asla resolve olmaz → running devam eder
				return new Promise(() => {});
			}
			// GET çağrıları hızlıca ok:false → fetchCeremony null döner, spinner kalkar
			return Promise.resolve({ ok: false, json: vi.fn() });
		}) as unknown as typeof fetch;

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		// Standup GET bitti → "No standup results yet"
		await waitFor(() => screen.getByText('No standup results yet'));

		// Retro sekmesine geç
		await user.click(screen.getByText('Retrospective'));

		// Retro GET bitti → "No retrospective results yet"
		await waitFor(() => screen.getByText('No retrospective results yet'));

		// "Run Retrospective" tıkla — POST asla bitmez → running === 'retro'
		await user.click(screen.getByText('Run Retrospective'));

		// Buton "Running..." ve disabled olmalı
		await waitFor(() => {
			expect(screen.getByText('Running...')).toBeInTheDocument();
		});
		const buton = screen.getByRole('button', { name: /running/i });
		expect(buton).toBeDisabled();
	});
});

// ---------------------------------------------------------------------------
// 8. Hata yönetimi — parseStandup / parseRetro guard
// ---------------------------------------------------------------------------

describe('CeremonyPanel — hata yönetimi ve parse guard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('standup API geçersiz JSON döndürünce bileşen çökmemeli', async () => {
		// agents alanı olmayan — parseStandup null döner
		global.fetch = fetchOlustur({ invalid: true });

		// Çökme olmadan render tamamlanmalı
		expect(() => render(<CeremonyPanel projectId={PROJE_ID} />)).not.toThrow();

		await waitFor(() => {
			expect(screen.getByText('No standup results yet')).toBeInTheDocument();
		});
	});

	it('retro API geçersiz JSON döndürünce bileşen çökmemeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			// Retro — data alanı eksik, parseRetro null döner
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ invalid: true }) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('No retrospective results yet')).toBeInTheDocument();
		});
	});

	it('retro API eksik wentWell alanı içerince parseRetro null döndürmeli', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					// data.wentWell eksik — parseRetro null döner
					data: { couldImprove: [], actionItems: [] },
				}),
			});

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(screen.getByText('No retrospective results yet')).toBeInTheDocument();
		});
	});

	it('fetch exception fırlatınca bileşen çökmemeli (network hatası)', async () => {
		// fetchCeremony try/catch ile null döndürür
		global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

		expect(() => render(<CeremonyPanel projectId={PROJE_ID} />)).not.toThrow();

		await waitFor(() => {
			expect(screen.getByText('No standup results yet')).toBeInTheDocument();
		});
	});

	it('standup POST hata dönünce mevcut veri korunmalı', async () => {
		global.fetch = vi
			.fn()
			// Standup GET — dolu
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_STANDUP_YANITI) })
			// Standup POST — hata
			.mockResolvedValueOnce({ ok: false, json: vi.fn() });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		// Mevcut standup verisi görüntülendi
		await waitFor(() => screen.getByText('Frontend Dev'));

		// Standup çalıştır — POST başarısız
		await user.click(screen.getByText('Run Standup'));

		await waitFor(() => {
			// Buton "Running..." durumundan çıkmış olmalı
			expect(screen.getByText('Run Standup')).toBeInTheDocument();
		});

		// Mevcut veri hâlâ gösteriliyor
		expect(screen.getByText('Frontend Dev')).toBeInTheDocument();
	});
});

// ---------------------------------------------------------------------------
// 9. Lazy loading — retro verisi yalnızca sekme açıldığında çekilmeli
// ---------------------------------------------------------------------------

describe('CeremonyPanel — lazy loading', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sayfa açılışında yalnızca standup GET isteği atılmalı', async () => {
		global.fetch = fetchOlustur({ agents: [] });

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});

		const ilkCagri = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(ilkCagri[0]).toContain('/ceremonies/standup');
		// method belirtilmemiş → GET
		expect(ilkCagri[1]?.method ?? 'GET').toBe('GET');
	});

	it('Retrospective sekmesine geçince retro GET isteği atılmalı', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));

		// Henüz yalnızca 1 istek atılmış olmalı (standup GET)
		expect(global.fetch).toHaveBeenCalledTimes(1);

		// Retro sekmesine geç
		await user.click(screen.getByText('Retrospective'));

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalledTimes(2);
		});

		const ikinciCagri = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
		expect(ikinciCagri[0]).toContain('/ceremonies/retrospective');
	});

	it('retro sekmesinden standup sekmesine dönünce tekrar fetch atılmamalı', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));
		await user.click(screen.getByText('Retrospective'));
		await waitFor(() => screen.getByText('What Went Well'));

		// Standup'a geri dön
		await user.click(screen.getByText('Standup'));

		await waitFor(() => screen.getByText('Run Standup'));

		// Toplam 2 fetch — standup GET + retro GET
		// Standup'a dönüşte zaten veri var, tekrar fetch atılmamalı
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});

	it('retro sekmesine ikinci kez geçince tekrar fetch atılmamalı (önbellek)', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ agents: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(ORNEK_RETRO_YANITI) });

		const user = userEvent.setup();
		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => screen.getByText('Run Standup'));

		// İlk retro geçişi
		await user.click(screen.getByText('Retrospective'));
		await waitFor(() => screen.getByText('What Went Well'));

		// Standup'a geri dön
		await user.click(screen.getByText('Standup'));
		await waitFor(() => screen.getByText('Run Standup'));

		// Retro'ya tekrar geç
		await user.click(screen.getByText('Retrospective'));
		await waitFor(() => screen.getByText('What Went Well'));

		// Yalnızca 2 fetch yapılmış olmalı — üçüncü GET yapılmamalı
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// 10. Başlık ve genel UI
// ---------------------------------------------------------------------------

describe('CeremonyPanel — genel UI', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('"Ceremonies" başlığı görüntülenmeli', async () => {
		global.fetch = fetchOlustur({ agents: [] });

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('Ceremonies')).toBeInTheDocument();
		});
	});

	it('"Scrum ceremony results" alt başlığı görüntülenmeli', async () => {
		global.fetch = fetchOlustur({ agents: [] });

		render(<CeremonyPanel projectId={PROJE_ID} />);

		await waitFor(() => {
			expect(screen.getByText('Scrum ceremony results')).toBeInTheDocument();
		});
	});

	it('farklı projectId değeriyle doğru endpoint çağrılmalı', async () => {
		const farklıId = 'farkli-proje-xyz';
		global.fetch = fetchOlustur({ agents: [] });

		render(<CeremonyPanel projectId={farklıId} />);

		await waitFor(() => {
			const ilkCagri = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(ilkCagri[0]).toContain(`/projects/${farklıId}/ceremonies/standup`);
		});
	});
});
