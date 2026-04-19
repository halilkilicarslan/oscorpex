import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageCenter from '../pages/studio/MessageCenter';
import * as studioApi from '../lib/studio-api';
import type { ProjectAgent, AgentMessage } from '../lib/studio-api';

// studio-api modulunu mockla
vi.mock('../lib/studio-api', () => ({
	fetchProjectAgents: vi.fn(),
	fetchProjectMessages: vi.fn(),
	fetchProjectMessagesPaginated: vi.fn(),
	fetchMessageThread: vi.fn(),
	sendAgentMessage: vi.fn(),
	markMessageRead: vi.fn(),
	archiveAgentMessage: vi.fn(),
	broadcastMessage: vi.fn(),
	fetchUnreadCount: vi.fn(),
	fetchAllUnreadCounts: vi.fn().mockResolvedValue({}),
}));

/** PaginatedResult sarmalayıcısı */
function paginatedMsgs(items: AgentMessage[], total?: number) {
	return { data: items, total: total ?? items.length, limit: 50, offset: 0 };
}

const ORNEK_AJANLAR: ProjectAgent[] = [
  {
    id: 'agent-1',
    projectId: 'proj-1',
    name: 'Frontend Ajan',
    role: 'frontend',
    avatar: 'F',
    gender: 'male',
    personality: 'Dikkatli',
    model: 'claude-sonnet-4-6',
    cliTool: 'claude-code',
    skills: ['React', 'TypeScript'],
    systemPrompt: 'Frontend gelistirici',
    createdAt: '2026-01-01T00:00:00Z',
    color: '#22c55e',
    pipelineOrder: 1,
  },
  {
    id: 'agent-2',
    projectId: 'proj-1',
    name: 'Backend Ajan',
    role: 'backend',
    avatar: 'B',
    gender: 'male',
    personality: 'Analitik',
    model: 'claude-sonnet-4-6',
    cliTool: 'claude-code',
    skills: ['Node.js', 'PostgreSQL'],
    systemPrompt: 'Backend gelistirici',
    createdAt: '2026-01-01T00:00:00Z',
    color: '#3b82f6',
    pipelineOrder: 2,
  },
];

const ORNEK_MESAJLAR: AgentMessage[] = [
  {
    id: 'msg-1',
    projectId: 'proj-1',
    fromAgentId: 'agent-1',
    toAgentId: 'agent-2',
    type: 'task_assignment',
    subject: 'API endpoint gorev atamasi',
    content: 'Kullanici kayit endpoint\'ini yaz',
    metadata: {},
    status: 'unread',
    createdAt: '2026-04-07T10:00:00Z',
  },
  {
    id: 'msg-2',
    projectId: 'proj-1',
    fromAgentId: 'agent-2',
    toAgentId: 'agent-1',
    type: 'task_complete',
    subject: 'Database schema tamamlandi',
    content: 'PostgreSQL schema hazir',
    metadata: {},
    status: 'read',
    createdAt: '2026-04-07T09:00:00Z',
  },
];

describe('MessageCenter — yukleme durumu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
	});

	it('mesajlar yuklenirken spinner gosterilmeli', async () => {
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockReturnValue(new Promise(() => {}));

		render(<MessageCenter projectId="proj-1" />);

		// Spinner DOM'da olmali
		const spinner = document.querySelector('.animate-spin');
		expect(spinner).toBeTruthy();
	});

	it('mesajlar yuklendikten sonra baslik gosterilmeli', async () => {
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs(ORNEK_MESAJLAR));

		render(<MessageCenter projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Mesaj Merkezi')).toBeInTheDocument();
		});
	});
});

describe('MessageCenter — mesaj listesi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs(ORNEK_MESAJLAR));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue(ORNEK_MESAJLAR);
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 1 });
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
	});

	it('mesaj konularini gostermeli', async () => {
		render(<MessageCenter projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('API endpoint gorev atamasi')).toBeInTheDocument();
			expect(screen.getByText('Database schema tamamlandi')).toBeInTheDocument();
		});
	});

	it('mesaj listesi bossa "Mesaj yok" gosterilmeli', async () => {
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs([]));

		render(<MessageCenter projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Mesaj yok')).toBeInTheDocument();
		});
	});

	it('mesaj icerik onizlemesi gosterilmeli', async () => {
		render(<MessageCenter projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText(/Kullanici kayit endpoint/)).toBeInTheDocument();
		});
	});
});

describe('MessageCenter — ajan kenar cubugu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs(ORNEK_MESAJLAR));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue(ORNEK_MESAJLAR);
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
	});

  it('ajan listesi kenar cubuğunda gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);

    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => {
      // Ajan adlari mesaj listesinde ve kenar cubugunda birden fazla kez gorunebilir
      const frontendAjanlar = screen.getAllByText('Frontend Ajan');
      const backendAjanlar = screen.getAllByText('Backend Ajan');
      expect(frontendAjanlar.length).toBeGreaterThanOrEqual(1);
      expect(backendAjanlar.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('"Tüm Mesajlar" butonu gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);

    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Tüm Mesajlar')).toBeInTheDocument();
    });
  });

  it('ajan yoksa kenar cubuğu bos olmali', async () => {
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);

    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => {
      // Sadece "Tüm Mesajlar" olacak, ajan adlari gozukmeyecek
      expect(screen.queryByText('Frontend Ajan')).not.toBeInTheDocument();
    });
  });
});

describe('MessageCenter — mesaj secimi ve thread goruntuleme', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs(ORNEK_MESAJLAR));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue(ORNEK_MESAJLAR);
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
		vi.mocked(studioApi.fetchMessageThread).mockResolvedValue([ORNEK_MESAJLAR[0]]);
		vi.mocked(studioApi.markMessageRead).mockResolvedValue(ORNEK_MESAJLAR[0]);
	});

  it('mesaja tiklaninca thread basligini gostermeli', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('API endpoint gorev atamasi'));
    await user.click(screen.getByText('API endpoint gorev atamasi'));

    await waitFor(() => {
      // Thread basligindaki konu
      const basliks = screen.getAllByText('API endpoint gorev atamasi');
      expect(basliks.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('mesaj secince fetchMessageThread cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('API endpoint gorev atamasi'));
    await user.click(screen.getByText('API endpoint gorev atamasi'));

    await waitFor(() => {
      expect(studioApi.fetchMessageThread).toHaveBeenCalledWith('proj-1', 'msg-1');
    });
  });

  it('okunmamis mesaja tiklaninca markMessageRead cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('API endpoint gorev atamasi'));
    await user.click(screen.getByText('API endpoint gorev atamasi'));

    await waitFor(() => {
      expect(studioApi.markMessageRead).toHaveBeenCalledWith('proj-1', 'msg-1');
    });
  });

  it('okunmus mesaja tiklaninca markMessageRead cagrisi yapilmamali', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('Database schema tamamlandi'));
    await user.click(screen.getByText('Database schema tamamlandi'));

    await waitFor(() => {
      expect(studioApi.markMessageRead).not.toHaveBeenCalled();
    });
  });

  it('mesaj secilmemisse "Bir mesaj seçin" gosterilmeli', async () => {
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Bir mesaj seçin')).toBeInTheDocument();
    });
  });

  it('thread acik iken mesaj konusu h3 basliginda gosterilmeli', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('API endpoint gorev atamasi'));
    await user.click(screen.getByText('API endpoint gorev atamasi'));

    await waitFor(() => {
      // Thread basliginda h3 elementi gosterilmeli
      const h3Elem = document.querySelector('h3');
      expect(h3Elem).toBeTruthy();
      expect(h3Elem?.textContent).toContain('API endpoint gorev atamasi');
    });
  });
});

describe('MessageCenter — mesaj arsivleme', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs(ORNEK_MESAJLAR));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue(ORNEK_MESAJLAR);
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
		vi.mocked(studioApi.archiveAgentMessage).mockResolvedValue({
			...ORNEK_MESAJLAR[0],
			status: 'archived',
		});
	});

  it('arsiv butonuna tiklaninca archiveAgentMessage cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('API endpoint gorev atamasi'));

    // Arshiv butonu (title="Arşivle") — hover ile gorunur, ama DOM'da var
    const arsivBtns = screen.getAllByTitle('Archive');
    expect(arsivBtns.length).toBeGreaterThan(0);

    await user.click(arsivBtns[0]);

    await waitFor(() => {
      expect(studioApi.archiveAgentMessage).toHaveBeenCalledWith('proj-1', 'msg-1');
    });
  });

  it('arsivleme sonrasi mesaj listeden kaybolmali', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('API endpoint gorev atamasi'));

    const arsivBtns = screen.getAllByTitle('Archive');
    await user.click(arsivBtns[0]);

    await waitFor(() => {
      expect(screen.queryByText('API endpoint gorev atamasi')).not.toBeInTheDocument();
    });
  });
});

describe('MessageCenter — filtreler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs(ORNEK_MESAJLAR));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue(ORNEK_MESAJLAR);
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 1 });
	});

  it('"Tümü" ve "Okunmamış" filtre butonlari gosterilmeli', async () => {
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Tümü')).toBeInTheDocument();
      expect(screen.getByText('Okunmamış')).toBeInTheDocument();
    });
  });

  it('"Okunmamış" filtresine tiklaninca fetchProjectMessages tekrar cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('Okunmamış'));
    await user.click(screen.getByText('Okunmamış'));

    await waitFor(() => {
      // Filtre degisince messages yeniden yuklenmeli
      expect(studioApi.fetchProjectMessages).toHaveBeenCalledWith(
        'proj-1',
        undefined,
        'unread',
      );
    });
  });

	it('"Tümü" filtresine tiklaninca tum mesajlar yuklenmeli', async () => {
		const user = userEvent.setup();
		render(<MessageCenter projectId="proj-1" />);

		await waitFor(() => screen.getByText('Tümü'));

		// Once Okunmamis'a tiklayip sonra Tümü'ye geri don
		await user.click(screen.getByText('Okunmamış'));
		await user.click(screen.getByText('Tümü'));

		await waitFor(() => {
			// Filtre yokken fetchProjectMessagesPaginated çağrılmalı
			expect(studioApi.fetchProjectMessagesPaginated).toHaveBeenCalledWith('proj-1', 50, 0);
		});
	});
});

describe('MessageCenter — okunmamis sayaci', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
	});

	it('okunmamis mesaj varsa header\'da sayac gosterilmeli', async () => {
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs([ORNEK_MESAJLAR[0]]));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue([ORNEK_MESAJLAR[0]]);
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 1 });

		render(<MessageCenter projectId="proj-1" />);

		await waitFor(() => {
			// Okunmamis mesaj sayaci (1 unread mesaj)
			const badges = screen.getAllByText('1');
			expect(badges.length).toBeGreaterThan(0);
		});
	});

	it('okunmamis mesaj yoksa sayac rozeti gosterilmemeli', async () => {
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs([ORNEK_MESAJLAR[1]]));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue([ORNEK_MESAJLAR[1]]);
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });

		render(<MessageCenter projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Mesaj Merkezi')).toBeInTheDocument();
		});

		// Sayac rozeti olmamali (yeşil renkli küçük rozet)
		const sayacRozet = document.querySelector('.rounded-full.bg-\\[\\#22c55e\\]');
		expect(sayacRozet).toBeNull();
	});
});

describe('MessageCenter — yeni mesaj compose', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs([]));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue([]);
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
	});

  it('"Yeni Mesaj Oluştur" butonu gosterilmeli', async () => {
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Yeni Mesaj Oluştur')).toBeInTheDocument();
    });
  });

  it('"Yeni Mesaj Oluştur" butonuna tiklaninca compose alani acilmali', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Mesaj Oluştur'));
    await user.click(screen.getByText('Yeni Mesaj Oluştur'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Konu...')).toBeInTheDocument();
    });
  });

  it('compose alani konu ve icerik inputlarini icermeli', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Mesaj Oluştur'));
    await user.click(screen.getByText('Yeni Mesaj Oluştur'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Konu...')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Message content...')).toBeInTheDocument();
    });
  });

  it('gonder butonuna tiklaninca sendAgentMessage cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    const yeniMesaj: AgentMessage = {
      ...ORNEK_MESAJLAR[0],
      id: 'msg-yeni',
    };
    vi.mocked(studioApi.sendAgentMessage).mockResolvedValue(yeniMesaj);

    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Mesaj Oluştur'));
    await user.click(screen.getByText('Yeni Mesaj Oluştur'));

    await waitFor(() => screen.getByPlaceholderText('Konu...'));

    await user.type(screen.getByPlaceholderText('Konu...'), 'Test konusu');
    await user.type(screen.getByPlaceholderText('Message content...'), 'Test mesaj icerigi');

    await user.click(screen.getByText('Gönder'));

    await waitFor(() => {
      expect(studioApi.sendAgentMessage).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          subject: 'Test konusu',
          content: 'Test mesaj icerigi',
        }),
      );
    });
  });

  it('"Tüme Yayınla" butonu gosterilmeli', async () => {
    const user = userEvent.setup();
    render(<MessageCenter projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yeni Mesaj Oluştur'));
    await user.click(screen.getByText('Yeni Mesaj Oluştur'));

    await waitFor(() => {
      expect(screen.getByText('Tüme Yayınla')).toBeInTheDocument();
    });
  });
});

describe('MessageCenter — yenile butonu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs(ORNEK_MESAJLAR));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue(ORNEK_MESAJLAR);
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
	});

	it('"Yenile" butonuna tiklaninca mesajlar yeniden yuklenmeli', async () => {
		const user = userEvent.setup();
		render(<MessageCenter projectId="proj-1" />);

		// Ilk yuklemenin tamamlanmasini bekle
		await waitFor(() => screen.getByText('API endpoint gorev atamasi'));

		// Ilk yukleme sayisini kaydet
		const ilkCagriSayisi = vi.mocked(studioApi.fetchProjectMessagesPaginated).mock.calls.length;

		await user.click(screen.getByTitle('Yenile'));

		await waitFor(() => {
			// Yenileme sonrasi en az 1 ek cagri yapilmali
			const yeniCagriSayisi = vi.mocked(studioApi.fetchProjectMessagesPaginated).mock.calls.length;
			expect(yeniCagriSayisi).toBeGreaterThan(ilkCagriSayisi);
		});
	});
});

describe('MessageCenter — mesaj tipleri rozeti', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
		vi.mocked(studioApi.fetchAllUnreadCounts).mockResolvedValue({});
		vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
	});

	it('task_assignment tipi "Görev" rozeti gostermeli', async () => {
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs([ORNEK_MESAJLAR[0]]));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue([ORNEK_MESAJLAR[0]]);

		render(<MessageCenter projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Task')).toBeInTheDocument();
		});
	});

	it('task_complete tipi "Tamamlandı" rozeti gostermeli', async () => {
		vi.mocked(studioApi.fetchProjectMessagesPaginated).mockResolvedValue(paginatedMsgs([ORNEK_MESAJLAR[1]]));
		vi.mocked(studioApi.fetchProjectMessages).mockResolvedValue([ORNEK_MESAJLAR[1]]);

		render(<MessageCenter projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Completed')).toBeInTheDocument();
		});
	});
});
