import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectReport from '../pages/studio/ProjectReport';

// v4.0: fetchContextMetrics mock — report fetch'i etkilememesi için
// v4.1: fetchSearchObservability mock — SearchObservability bileşeni ayrı bir istek yapar,
// bu mock sayesinde spinner ProjectReport yüklendikten sonra DOM'da kalmaz.
vi.mock('../lib/studio-api/analytics.js', async (importOriginal) => {
	const actual = await importOriginal() as Record<string, unknown>;
	return {
		...actual,
		fetchContextMetrics: vi.fn().mockResolvedValue(null),
	};
});

vi.mock('../lib/studio-api', async (importOriginal) => {
	const actual = await importOriginal() as Record<string, unknown>;
	return {
		...actual,
		fetchSearchObservability: vi.fn().mockResolvedValue({
			totalSearches: 0,
			totalHits: 0,
			totalMisses: 0,
			hitRate: 0,
			avgLatencyMs: 0,
			avgResultCount: 0,
			avgTopRank: 0,
			hourlyBreakdown: [],
			recentSearches: [],
		}),
	};
});

// global.fetch'i mockla — studio API transport katmanı HTTP çağrılarını buradan geçirir
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Başarılı yanıt üretici yardımcı fonksiyon
function mockBasariliYanit(data: object, ok = true, status = 200) {
	return Promise.resolve({
		ok,
		status,
		json: () => Promise.resolve(data),
	} as Response);
}

// Örnek rapor verisi
const ORNEK_RAPOR = {
	summary: {
		totalTasks: 20,
		completedTasks: 15,
		failedTasks: 3,
		totalCostUsd: 1.2345,
		durationMs: 7320000, // 2 saat 2 dakika → "2.0h"
	},
	quality: {
		reviewPassRate: 0.85,
		avgRevisions: 1.4,
		firstPassRate: 0.72,
	},
	topChangedFiles: [
		{ path: 'src/index.ts', changeCount: 12 },
		{ path: 'src/app.ts', changeCount: 7 },
		{ path: 'console/src/main.tsx', changeCount: 3 },
	],
};

describe('ProjectReport — yükleme durumu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('veri yüklenirken spinner gösterilmeli', () => {
		// Asla çözülmeyen promise — sonsuz yükleme durumu simüle eder
		mockFetch.mockReturnValue(new Promise(() => {}));

		render(<ProjectReport projectId="proj-1" />);

		const spinner = document.querySelector('.animate-spin');
		expect(spinner).toBeTruthy();
	});
});

describe('ProjectReport — hata durumu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('fetch reject olunca hata mesajı gösterilmeli', async () => {
		mockFetch.mockRejectedValue(new Error('Ağ hatası'));

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Ağ hatası')).toBeInTheDocument();
		});
	});

	it('hata durumunda Retry butonu gösterilmeli', async () => {
		mockFetch.mockRejectedValue(new Error('Sunucu bağlantı hatası'));

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Retry')).toBeInTheDocument();
		});
	});

	it('res.ok false olunca hata mesajı gösterilmeli — rapor verisi render edilmemeli', async () => {
		// HTTP 500: res.ok = false, data.error var
		mockFetch.mockResolvedValue({
			ok: false,
			status: 500,
			json: () => Promise.resolve({ error: 'Dahili sunucu hatası' }),
		} as Response);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Dahili sunucu hatası')).toBeInTheDocument();
		});

		// Rapor içeriği render edilmemeli
		expect(screen.queryByText('Project Report')).not.toBeInTheDocument();
		expect(screen.queryByText('Total Tasks')).not.toBeInTheDocument();
	});

	it('res.ok false ve data.error yoksa HTTP status hata mesajı gösterilmeli', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 403,
			json: () => Promise.resolve({}),
		} as Response);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('HTTP 403')).toBeInTheDocument();
		});
	});

	it('Retry butonuna tıklanınca veri yeniden yüklenmeli', async () => {
		// İlk load: report fetch reject, tasks fetch resolve; Retry: her ikisi de başarılı
		mockFetch
			.mockRejectedValueOnce(new Error('Geçici hata'))
			.mockResolvedValue(mockBasariliYanit(ORNEK_RAPOR));

		const user = userEvent.setup();
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => screen.getByText('Retry'));
		await user.click(screen.getByText('Retry'));

		await waitFor(() => {
			expect(screen.getByText('Project Report')).toBeInTheDocument();
		});

		// İlk load (2 fetch) + retry (2 fetch) = en az 3 çağrı
		expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3);
	});
});

describe('ProjectReport — özet stat kartları', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue(mockBasariliYanit(ORNEK_RAPOR));
	});

	it('"Total Tasks" kartı doğru değerle gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Total Tasks')).toBeInTheDocument();
			expect(screen.getByText('20')).toBeInTheDocument();
		});
	});

	it('"Completed" kartı doğru değerle gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Completed')).toBeInTheDocument();
			expect(screen.getByText('15')).toBeInTheDocument();
		});
	});

	it('"Failed" kartı doğru değerle gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Failed')).toBeInTheDocument();
			// "3" birden fazla yerde geçebilir (dosya sıralama no, changeCount) — getAllByText kullan
			const ucler = screen.getAllByText('3');
			expect(ucler.length).toBeGreaterThanOrEqual(1);
		});
	});

	it('"Total Cost" kartı 4 ondalık basamakla gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Total Cost')).toBeInTheDocument();
			expect(screen.getByText('$1.2345')).toBeInTheDocument();
		});
	});

	it('tamamlanma oranı "Total Tasks" alt metni olarak gösterilmeli', async () => {
		// 15/20 = %75
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('75% complete')).toBeInTheDocument();
		});
	});

	it('başarısızlık oranı "Failed" alt metni olarak gösterilmeli', async () => {
		// 3/20 = %15
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('15% failure rate')).toBeInTheDocument();
		});
	});

	it('başarısızlık yoksa "Failed" kartında alt metin gösterilmemeli', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				summary: { ...ORNEK_RAPOR.summary, failedTasks: 0 },
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.queryByText(/failure rate/i)).not.toBeInTheDocument();
		});
	});
});

describe('ProjectReport — tamamlanma ve başarısızlık oranı hesaplamaları', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue(mockBasariliYanit(ORNEK_RAPOR));
	});

	it('totalTasks 0 ise tamamlanma oranı %0 olmalı', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				summary: {
					...ORNEK_RAPOR.summary,
					totalTasks: 0,
					completedTasks: 0,
					failedTasks: 0,
				},
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('0% complete')).toBeInTheDocument();
		});
	});

	it('tam tamamlanma oranı (tüm görevler tamamlandı) %100 göstermeli', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				summary: {
					...ORNEK_RAPOR.summary,
					totalTasks: 10,
					completedTasks: 10,
					failedTasks: 0,
				},
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('100% complete')).toBeInTheDocument();
		});
	});

	it('"Task Completion Rate" metrik satırı doğru yüzde ile gösterilmeli', async () => {
		// 15/20 = %75
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Task Completion Rate')).toBeInTheDocument();
			// %75 metrik satırında da gösterilmeli
			const yuzde75 = screen.getAllByText('75%');
			expect(yuzde75.length).toBeGreaterThanOrEqual(1);
		});
	});
});

describe('ProjectReport — kalite metrikleri', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue(mockBasariliYanit(ORNEK_RAPOR));
	});

	it('"Quality Metrics" bölüm başlığı gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Quality Metrics')).toBeInTheDocument();
		});
	});

	it('"Review Pass Rate" doğru yüzdeyle gösterilmeli', async () => {
		// reviewPassRate: 0.85 → %85
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Review Pass Rate')).toBeInTheDocument();
			expect(screen.getByText('85%')).toBeInTheDocument();
		});
	});

	it('"First Pass Rate" doğru yüzdeyle gösterilmeli', async () => {
		// firstPassRate: 0.72 → %72
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('First Pass Rate')).toBeInTheDocument();
			expect(screen.getByText('72%')).toBeInTheDocument();
		});
	});

	it('"Avg Revisions per Task" doğru ondalık değerle gösterilmeli', async () => {
		// avgRevisions: 1.4 → "1.4"
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Avg Revisions per Task')).toBeInTheDocument();
			expect(screen.getByText('1.4')).toBeInTheDocument();
		});
	});

	it('kalite metrikleri bölümü için ilerleme çubukları render edilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			// İlerleme çubuklarını içeren div'ler: MetricRow bar prop ile render edilmeli
			// bg-[#1a1a1a] rounded-full overflow-hidden class'lı container'lar
			const barContainers = document.querySelectorAll('.h-1\\.5.bg-\\[\\#1a1a1a\\].rounded-full');
			expect(barContainers.length).toBeGreaterThan(0);
		});
	});
});

describe('ProjectReport — en çok değişen dosyalar', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue(mockBasariliYanit(ORNEK_RAPOR));
	});

	it('"Top Changed Files" bölüm başlığı gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Top Changed Files')).toBeInTheDocument();
		});
	});

	it('dosya yolları listede gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('src/index.ts')).toBeInTheDocument();
			expect(screen.getByText('src/app.ts')).toBeInTheDocument();
			expect(screen.getByText('console/src/main.tsx')).toBeInTheDocument();
		});
	});

	it('changeCount değerleri dosya satırlarında gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('12')).toBeInTheDocument();
			expect(screen.getByText('7')).toBeInTheDocument();
		});
	});

	it('dosya sayısı başlık badge\'inde gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('3 files')).toBeInTheDocument();
		});
	});

	it('topChangedFiles boş ise bölüm render edilmemeli', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				topChangedFiles: [],
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.queryByText('Top Changed Files')).not.toBeInTheDocument();
		});
	});

	it('dosya sıralama numaraları (1, 2, 3) gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			// Sıralama numaraları birden fazla "1", "2", "3" içeren DOM'da olabilir — getAllByText kullan
			expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
		});
	});
});

describe('ProjectReport — süre kartı', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('durationMs varsa "Total Duration" kartı gösterilmeli', async () => {
		mockFetch.mockResolvedValue(mockBasariliYanit(ORNEK_RAPOR));

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Total Duration')).toBeInTheDocument();
		});
	});

	it('durationMs 7320000 (2+ saat) "2.0h" formatında gösterilmeli', async () => {
		mockFetch.mockResolvedValue(mockBasariliYanit(ORNEK_RAPOR)); // durationMs: 7320000

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			// formatDuration(7320000) = (7320000/3600000).toFixed(1) + "h" = "2.0h"
			const sureItems = screen.getAllByText('2.0h');
			expect(sureItems.length).toBeGreaterThanOrEqual(1);
		});
	});

	it('durationMs dakika aralığında "Xm" formatında gösterilmeli', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				summary: { ...ORNEK_RAPOR.summary, durationMs: 120000 }, // 2 dakika
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			const sureItems = screen.getAllByText('2m');
			expect(sureItems.length).toBeGreaterThanOrEqual(1);
		});
	});

	it('durationMs saniye aralığında "Xs" formatında gösterilmeli', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				summary: { ...ORNEK_RAPOR.summary, durationMs: 45000 }, // 45 saniye
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			const sureItems = screen.getAllByText('45s');
			expect(sureItems.length).toBeGreaterThanOrEqual(1);
		});
	});

	it('durationMs yoksa "Total Duration" kartı render edilmemeli', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				summary: {
					totalTasks: 20,
					completedTasks: 15,
					failedTasks: 3,
					totalCostUsd: 1.2345,
					// durationMs yok
				},
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.queryByText('Total Duration')).not.toBeInTheDocument();
		});
	});

	it('durationMs 0 ise "Total Duration" kartı render edilmemeli', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				summary: { ...ORNEK_RAPOR.summary, durationMs: 0 },
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.queryByText('Total Duration')).not.toBeInTheDocument();
		});
	});
});

describe('ProjectReport — Refresh butonu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue(mockBasariliYanit(ORNEK_RAPOR));
	});

	it('"Refresh" butonu gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Refresh')).toBeInTheDocument();
		});
	});

	it('"Refresh" butonuna tıklanınca fetch yeniden çağrılmalı', async () => {
		const user = userEvent.setup();
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => screen.getByText('Refresh'));

		const beforeCount = mockFetch.mock.calls.length;
		await user.click(screen.getByText('Refresh'));

		await waitFor(() => {
			// Refresh sonrası en az 1 yeni fetch çağrısı yapılmış olmalı
			expect(mockFetch.mock.calls.length).toBeGreaterThan(beforeCount);
		});
	});

	it('"Refresh" butonu doğru URL ile fetch çağırmalı', async () => {
		const user = userEvent.setup();
		render(<ProjectReport projectId="proj-test-42" />);

		await waitFor(() => screen.getByText('Refresh'));
		await user.click(screen.getByText('Refresh'));

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/studio/projects/proj-test-42/report'),
				expect.objectContaining({ method: 'GET' }),
			);
		});
	});
});

describe('ProjectReport — başlık ve genel render', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue(mockBasariliYanit(ORNEK_RAPOR));
	});

	it('"Project Report" başlığı gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Project Report')).toBeInTheDocument();
		});
	});

	it('alt başlık açıklaması gösterilmeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Summary metrics and quality indicators')).toBeInTheDocument();
		});
	});

	it('yükleme tamamlandıktan sonra spinner görünmemeli', async () => {
		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Project Report')).toBeInTheDocument();
		});

		// Yükleme bitti, spinner kaybolmali — Suspense fallback'ler de resolve olmalı
		await waitFor(() => {
			const animateSpinElements = document.querySelectorAll('.animate-spin');
			expect(animateSpinElements.length).toBe(0);
		});
	});
});

describe('ProjectReport — maliyet formatlaması', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sıfır maliyet "$0.0000" olarak gösterilmeli', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				summary: { ...ORNEK_RAPOR.summary, totalCostUsd: 0 },
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('$0.0000')).toBeInTheDocument();
		});
	});

	it('küçük maliyet değeri 4 ondalık basamakla gösterilmeli', async () => {
		mockFetch.mockResolvedValue(
			mockBasariliYanit({
				...ORNEK_RAPOR,
				summary: { ...ORNEK_RAPOR.summary, totalCostUsd: 0.0023 },
			}),
		);

		render(<ProjectReport projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('$0.0023')).toBeInTheDocument();
		});
	});
});
