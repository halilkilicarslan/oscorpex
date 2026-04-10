import { describe, it, expect } from 'vitest';
import { getDbConnectionInfo, parseCloudUrl, getDbStatus } from '../db-provisioner.js';

describe('db-provisioner', () => {
  // ---------------------------------------------------------------------------
  // getDbConnectionInfo — returns { envVars, connectionUrl }
  // ---------------------------------------------------------------------------
  describe('getDbConnectionInfo', () => {
    it('should return PostgreSQL connection info', () => {
      const info = getDbConnectionInfo('postgresql', 5432);
      expect(info.connectionUrl).toContain('postgresql://');
      expect(info.connectionUrl).toContain('5432');
      expect(info.envVars).toBeDefined();
      expect(info.envVars.DB_HOST).toBe('localhost');
      expect(info.envVars.DB_PORT).toBe('5432');
    });

    it('should return MySQL connection info', () => {
      const info = getDbConnectionInfo('mysql', 3306);
      expect(info.connectionUrl).toContain('mysql://');
      expect(info.connectionUrl).toContain('3306');
      expect(info.envVars).toBeDefined();
    });

    it('should return MongoDB connection info', () => {
      const info = getDbConnectionInfo('mongodb', 27017);
      expect(info.connectionUrl).toContain('mongodb://');
      expect(info.connectionUrl).toContain('27017');
    });

    it('should return Redis connection info', () => {
      const info = getDbConnectionInfo('redis', 6379);
      expect(info.connectionUrl).toContain('redis://');
    });

    it('should handle custom ports', () => {
      const info = getDbConnectionInfo('postgresql', 5433);
      expect(info.connectionUrl).toContain('5433');
      expect(info.envVars.DB_PORT).toBe('5433');
    });
  });

  // ---------------------------------------------------------------------------
  // parseCloudUrl
  // ---------------------------------------------------------------------------
  describe('parseCloudUrl', () => {
    it('should parse PostgreSQL cloud URL', () => {
      const envVars = parseCloudUrl('postgresql', 'postgresql://user:pass@db.example.com:5432/mydb');
      expect(envVars.DB_HOST).toBe('db.example.com');
      expect(envVars.DB_PORT).toBe('5432');
      expect(envVars.DB_USER).toBe('user');
      expect(envVars.DB_PASSWORD).toBe('pass');
      expect(envVars.DB_NAME).toBe('mydb');
      expect(envVars.DATABASE_URL).toBe('postgresql://user:pass@db.example.com:5432/mydb');
    });

    it('should parse MySQL cloud URL', () => {
      const envVars = parseCloudUrl('mysql', 'mysql://admin:secret@rds.aws.com:3306/appdb');
      expect(envVars.MYSQL_HOST).toBe('rds.aws.com');
      expect(envVars.MYSQL_PORT).toBe('3306');
      expect(envVars.MYSQL_USER).toBe('admin');
      expect(envVars.MYSQL_PASSWORD).toBe('secret');
      expect(envVars.MYSQL_DATABASE).toBe('appdb');
    });

    it('should parse MongoDB cloud URL', () => {
      const envVars = parseCloudUrl('mongodb', 'mongodb+srv://user:pass@cluster0.abc.mongodb.net/testdb');
      expect(envVars.MONGO_URI).toBe('mongodb+srv://user:pass@cluster0.abc.mongodb.net/testdb');
    });

    it('should parse Redis cloud URL', () => {
      const envVars = parseCloudUrl('redis', 'redis://default:secret@redis.example.com:6380');
      expect(envVars.REDIS_URL).toBe('redis://default:secret@redis.example.com:6380');
      expect(envVars.REDIS_HOST).toBe('redis.example.com');
      expect(envVars.REDIS_PORT).toBe('6380');
    });

    it('should handle URL without credentials', () => {
      const envVars = parseCloudUrl('postgresql', 'postgresql://db.example.com:5432/mydb');
      expect(envVars.DB_HOST).toBe('db.example.com');
      expect(envVars.DATABASE_URL).toBe('postgresql://db.example.com:5432/mydb');
    });

    it('should return empty for invalid URL', () => {
      const envVars = parseCloudUrl('postgresql', 'not-a-url');
      expect(Object.keys(envVars)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getDbStatus
  // ---------------------------------------------------------------------------
  describe('getDbStatus', () => {
    it('should return empty array for unknown project', () => {
      const statuses = getDbStatus('nonexistent-project-12345');
      expect(statuses).toEqual([]);
    });
  });
});
