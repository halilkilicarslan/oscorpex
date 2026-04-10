// ---------------------------------------------------------------------------
// Orenda — Database Provisioner
// Docker container ile veritabanı servislerini yönetir.
// PostgreSQL, MySQL, MongoDB, Redis destekler.
// ---------------------------------------------------------------------------

import { execSync, spawn, ChildProcess } from 'node:child_process';
import type { DatabaseType, DetectedDatabase } from './runtime-analyzer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DbProvisionMethod = 'docker' | 'local' | 'cloud';

export interface DbProvisionConfig {
  type: DatabaseType;
  method: DbProvisionMethod;
  /** Docker: image adı, Local/Cloud: bağlantı URL'si */
  connectionUrl?: string;
  /** Docker container port (host tarafı) */
  port: number;
  /** Docker container adı */
  containerName?: string;
}

export interface DbStatus {
  type: DatabaseType;
  method: DbProvisionMethod;
  running: boolean;
  port: number;
  containerName?: string;
  connectionUrl?: string;
}

// ---------------------------------------------------------------------------
// Default Docker credentials
// ---------------------------------------------------------------------------

const DB_DEFAULTS: Record<DatabaseType, {
  envVars: Record<string, string>;
  connectionUrl: (port: number) => string;
  healthCmd: (containerName: string) => string;
}> = {
  postgresql: {
    envVars: {
      DB_HOST: 'localhost',
      DB_USER: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_NAME: 'app_dev',
      DB_PORT: '5432',
    },
    connectionUrl: (port) => `postgresql://postgres:postgres@localhost:${port}/app_dev`,
    healthCmd: (c) => `docker exec ${c} pg_isready -U postgres`,
  },
  mysql: {
    envVars: {
      MYSQL_HOST: 'localhost',
      MYSQL_USER: 'root',
      MYSQL_PASSWORD: 'root',
      MYSQL_DATABASE: 'app_dev',
      MYSQL_PORT: '3306',
    },
    connectionUrl: (port) => `mysql://root:root@localhost:${port}/app_dev`,
    healthCmd: (c) => `docker exec ${c} mysqladmin ping -h localhost -u root -proot`,
  },
  mongodb: {
    envVars: {
      MONGO_URI: 'mongodb://localhost:27017/app_dev',
    },
    connectionUrl: (port) => `mongodb://localhost:${port}/app_dev`,
    healthCmd: (c) => `docker exec ${c} mongosh --eval "db.runCommand('ping')"`,
  },
  redis: {
    envVars: {
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
      REDIS_URL: 'redis://localhost:6379',
    },
    connectionUrl: (port) => `redis://localhost:${port}`,
    healthCmd: (c) => `docker exec ${c} redis-cli ping`,
  },
  sqlite: {
    envVars: {},
    connectionUrl: () => '',
    healthCmd: () => 'true',
  },
};

// ---------------------------------------------------------------------------
// State — running containers
// ---------------------------------------------------------------------------

const runningContainers = new Map<string, DbStatus>();

function containerKey(projectId: string, dbType: DatabaseType): string {
  return `${projectId}:${dbType}`;
}

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

function isPortInUse(port: number): boolean {
  try {
    execSync(`lsof -i :${port} -sTCP:LISTEN`, { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** DB tipi + port için env var'lar üret */
function buildEnvVars(
  dbType: DatabaseType,
  port: number,
  defaults: typeof DB_DEFAULTS[DatabaseType],
): Record<string, string> {
  const envVars = { ...defaults.envVars };
  if (dbType === 'postgresql') envVars.DB_PORT = String(port);
  if (dbType === 'mysql') envVars.MYSQL_PORT = String(port);
  if (dbType === 'redis') {
    envVars.REDIS_PORT = String(port);
    envVars.REDIS_URL = `redis://localhost:${port}`;
  }
  return envVars;
}

/** Port kullanımdaysa otomatik artır (max 10 deneme) */
function findAvailablePort(basePort: number): number {
  let port = basePort;
  for (let i = 0; i < 10; i++) {
    if (!isPortInUse(port)) return port;
    port++;
  }
  return port; // Son çare — Docker hata verirse kullanıcıya bildirilir
}

// ---------------------------------------------------------------------------
// Docker helpers
// ---------------------------------------------------------------------------

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isContainerRunning(containerName: string): boolean {
  try {
    const result = execSync(`docker inspect -f '{{.State.Running}}' ${containerName} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return result === 'true';
  } catch {
    return false;
  }
}

function containerExists(containerName: string): boolean {
  try {
    execSync(`docker inspect ${containerName} 2>/dev/null`, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Docker container ile veritabanı başlat.
 * Mevcut container varsa restart eder, yoksa yeni oluşturur.
 */
export async function provisionDatabase(
  projectId: string,
  db: DetectedDatabase,
  onLog: (msg: string) => void,
): Promise<{ envVars: Record<string, string>; status: DbStatus }> {
  const key = containerKey(projectId, db.type);
  const containerName = `studio-${db.type}-${projectId.slice(0, 8)}`;
  const defaults = DB_DEFAULTS[db.type];

  // Port conflict auto-resolve: kullanımda olan portu otomatik artır
  const port = findAvailablePort(db.port);
  if (port !== db.port) {
    onLog(`[db-provisioner] Port ${db.port} kullanımda, ${port} kullanılacak`);
  }

  if (db.type === 'sqlite') {
    const status: DbStatus = { type: 'sqlite', method: 'local', running: true, port: 0 };
    runningContainers.set(key, status);
    return { envVars: {}, status };
  }

  if (!isDockerAvailable()) {
    throw new Error('Docker çalışmıyor. Docker Desktop başlatın veya Cloud URL kullanın.');
  }

  // Container zaten çalışıyor mu?
  if (isContainerRunning(containerName)) {
    onLog(`[db-provisioner] ${db.type} container zaten çalışıyor: ${containerName}`);
    const status: DbStatus = {
      type: db.type, method: 'docker', running: true,
      port, containerName, connectionUrl: defaults.connectionUrl(port),
    };
    runningContainers.set(key, status);

    return { envVars: buildEnvVars(db.type, port, defaults), status };
  }

  // Eski durmuş container varsa kaldır
  if (containerExists(containerName)) {
    onLog(`[db-provisioner] Eski container kaldırılıyor: ${containerName}`);
    try { execSync(`docker rm -f ${containerName}`, { stdio: 'ignore', timeout: 10000 }); } catch { /* */ }
  }

  // Yeni container başlat
  onLog(`[db-provisioner] ${db.type} başlatılıyor: ${db.image} → port ${port}`);

  let dockerCmd: string;
  switch (db.type) {
    case 'postgresql':
      dockerCmd = `docker run -d --name ${containerName} -p ${port}:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_dev ${db.image}`;
      break;
    case 'mysql':
      dockerCmd = `docker run -d --name ${containerName} -p ${port}:3306 -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=app_dev ${db.image}`;
      break;
    case 'mongodb':
      dockerCmd = `docker run -d --name ${containerName} -p ${port}:27017 ${db.image}`;
      break;
    case 'redis':
      dockerCmd = `docker run -d --name ${containerName} -p ${port}:6379 ${db.image}`;
      break;
    default:
      throw new Error(`Desteklenmeyen veritabanı tipi: ${db.type}`);
  }

  try {
    execSync(dockerCmd, { encoding: 'utf-8', timeout: 30000 });
    onLog(`[db-provisioner] ${db.type} container başlatıldı: ${containerName}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Port kullanımda — bir üst port dene (tek retry)
    if (msg.includes('port is already allocated') || msg.includes('address already in use')) {
      const retryPort = findAvailablePort(port + 1);
      onLog(`[db-provisioner] Port ${port} Docker tarafında da meşgul, ${retryPort} deneniyor...`);
      try { execSync(`docker rm -f ${containerName}`, { stdio: 'ignore', timeout: 5000 }); } catch { /* */ }
      const retryCmd = dockerCmd.replace(`-p ${port}:`, `-p ${retryPort}:`);
      try {
        execSync(retryCmd, { encoding: 'utf-8', timeout: 30000 });
        onLog(`[db-provisioner] ${db.type} container başlatıldı: ${containerName} (port ${retryPort})`);
        // Aşağıda port değişkenini kullanamayız, bu yüzden erken return
        const retryStatus: DbStatus = {
          type: db.type, method: 'docker', running: true,
          port: retryPort, containerName, connectionUrl: defaults.connectionUrl(retryPort),
        };
        runningContainers.set(key, retryStatus);
        const retryEnvVars = buildEnvVars(db.type, retryPort, defaults);
        return { envVars: retryEnvVars, status: retryStatus };
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new Error(`${db.type} başlatılamadı (port ${retryPort}): ${retryMsg.slice(0, 300)}`);
      }
    }
    throw new Error(`${db.type} başlatılamadı: ${msg.slice(0, 300)}`);
  }

  // Health check — DB'nin hazır olmasını bekle
  onLog(`[db-provisioner] ${db.type} hazır olması bekleniyor...`);
  const healthCmd = defaults.healthCmd(containerName);
  const maxAttempts = 20;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      execSync(healthCmd, { stdio: 'ignore', timeout: 5000 });
      onLog(`[db-provisioner] ${db.type} hazır! (${i + 1}s)`);
      break;
    } catch {
      if (i === maxAttempts - 1) {
        onLog(`[db-provisioner] ${db.type} health check timeout — devam ediliyor`);
      }
    }
  }

  const status: DbStatus = {
    type: db.type, method: 'docker', running: true,
    port, containerName, connectionUrl: defaults.connectionUrl(port),
  };
  runningContainers.set(key, status);

  return { envVars: buildEnvVars(db.type, port, defaults), status };
}

/**
 * Proje için çalışan DB container'ını durdur.
 */
export async function stopDatabase(projectId: string, dbType: DatabaseType): Promise<void> {
  const key = containerKey(projectId, dbType);
  const status = runningContainers.get(key);
  if (!status?.containerName) return;

  try {
    execSync(`docker stop ${status.containerName}`, { stdio: 'ignore', timeout: 10000 });
    execSync(`docker rm ${status.containerName}`, { stdio: 'ignore', timeout: 10000 });
  } catch { /* ignore */ }

  runningContainers.delete(key);
}

/**
 * Proje için tüm DB container'larını durdur.
 */
export async function stopAllDatabases(projectId: string): Promise<void> {
  for (const [key, status] of runningContainers) {
    if (key.startsWith(`${projectId}:`)) {
      if (status.containerName) {
        try {
          execSync(`docker stop ${status.containerName}`, { stdio: 'ignore', timeout: 10000 });
          execSync(`docker rm ${status.containerName}`, { stdio: 'ignore', timeout: 10000 });
        } catch { /* ignore */ }
      }
      runningContainers.delete(key);
    }
  }
}

/**
 * Tüm çalışan DB durumlarını listele.
 */
export function getDbStatus(projectId: string): DbStatus[] {
  const statuses: DbStatus[] = [];
  for (const [key, status] of runningContainers) {
    if (key.startsWith(`${projectId}:`)) {
      // Gerçek durumu kontrol et
      if (status.containerName) {
        status.running = isContainerRunning(status.containerName);
      }
      statuses.push(status);
    }
  }
  return statuses;
}

/**
 * Belirli bir DB tipinin bağlantı bilgilerini döndürür.
 */
export function getDbConnectionInfo(dbType: DatabaseType, port: number): {
  envVars: Record<string, string>;
  connectionUrl: string;
} {
  const defaults = DB_DEFAULTS[dbType];
  return {
    envVars: buildEnvVars(dbType, port, defaults),
    connectionUrl: defaults.connectionUrl(port),
  };
}

/**
 * Cloud URL'den env var'ları üret.
 * Kullanıcı Neon, PlanetScale vs. URL girdiğinde bunu parse eder.
 */
export function parseCloudUrl(dbType: DatabaseType, url: string): Record<string, string> {
  try {
    const parsed = new URL(url);
    switch (dbType) {
      case 'postgresql':
        return {
          DB_HOST: parsed.hostname,
          DB_PORT: parsed.port || '5432',
          DB_USER: parsed.username,
          DB_PASSWORD: parsed.password,
          DB_NAME: parsed.pathname.slice(1), // remove leading /
          DATABASE_URL: url,
        };
      case 'mysql':
        return {
          MYSQL_HOST: parsed.hostname,
          MYSQL_PORT: parsed.port || '3306',
          MYSQL_USER: parsed.username,
          MYSQL_PASSWORD: parsed.password,
          MYSQL_DATABASE: parsed.pathname.slice(1),
        };
      case 'mongodb':
        return { MONGO_URI: url };
      case 'redis':
        return {
          REDIS_HOST: parsed.hostname,
          REDIS_PORT: parsed.port || '6379',
          REDIS_URL: url,
        };
      default:
        return {};
    }
  } catch {
    return {};
  }
}
