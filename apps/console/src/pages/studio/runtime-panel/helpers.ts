export const FRAMEWORK_META: Record<string, { label: string; color: string }> = {
	express: { label: 'Express.js', color: '#22c55e' },
	hono: { label: 'Hono', color: '#ff6b35' },
	fastify: { label: 'Fastify', color: '#000000' },
	koa: { label: 'Koa', color: '#33333d' },
	nestjs: { label: 'NestJS', color: '#e0234e' },
	nextjs: { label: 'Next.js', color: '#000000' },
	nuxt: { label: 'Nuxt', color: '#00dc82' },
	vite: { label: 'Vite', color: '#646cff' },
	cra: { label: 'Create React', color: '#61dafb' },
	angular: { label: 'Angular', color: '#dd0031' },
	django: { label: 'Django', color: '#092e20' },
	fastapi: { label: 'FastAPI', color: '#009688' },
	flask: { label: 'Flask', color: '#000000' },
	'spring-boot': { label: 'Spring Boot', color: '#6db33f' },
	go: { label: 'Go', color: '#00add8' },
	gin: { label: 'Gin', color: '#00add8' },
	rails: { label: 'Rails', color: '#cc0000' },
	'rust-actix': { label: 'Rust/Actix', color: '#dea584' },
	'rust-axum': { label: 'Rust/Axum', color: '#dea584' },
	'generic-node': { label: 'Node.js', color: '#339933' },
	'generic-python': { label: 'Python', color: '#3776ab' },
	unknown: { label: 'Unknown', color: '#666' },
};

export const DB_META: Record<string, { label: string; color: string; icon: string }> = {
	postgresql: { label: 'PostgreSQL', color: '#336791', icon: '🐘' },
	mysql: { label: 'MySQL', color: '#4479a1', icon: '🐬' },
	mongodb: { label: 'MongoDB', color: '#47a248', icon: '🍃' },
	redis: { label: 'Redis', color: '#dc382d', icon: '⚡' },
	sqlite: { label: 'SQLite', color: '#003b57', icon: '📦' },
};

export const CATEGORY_LABELS: Record<string, string> = {
	database: 'Veritabani',
	auth: 'Kimlik Dogrulama',
	api: 'API Anahtarlari',
	app: 'Uygulama',
	other: 'Diger',
};
