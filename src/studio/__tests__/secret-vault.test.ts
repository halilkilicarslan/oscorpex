import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt, isEncrypted } from '../secret-vault.js';

describe('secret-vault', () => {
  // ---------------------------------------------------------------------------
  // encrypt / decrypt roundtrip
  // ---------------------------------------------------------------------------

  it('encrypt ve decrypt aynı değeri döndürür', () => {
    const plaintext = 'sk-test-api-key-12345';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('boş string şifrelenip çözülebilir', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('özel karakterler içeren değerleri işler', () => {
    const value = 'key with spaces & special chars: @#$%^&*()';
    expect(decrypt(encrypt(value))).toBe(value);
  });

  it('uzun değerleri şifreler ve çözer', () => {
    const longValue = 'a'.repeat(1000);
    expect(decrypt(encrypt(longValue))).toBe(longValue);
  });

  // ---------------------------------------------------------------------------
  // Rastgele IV — her seferinde farklı ciphertext
  // ---------------------------------------------------------------------------

  it('aynı plaintext için farklı ciphertext üretir (rastgele IV)', () => {
    const plaintext = 'same-api-key';
    const first = encrypt(plaintext);
    const second = encrypt(plaintext);
    expect(first).not.toBe(second);
  });

  // ---------------------------------------------------------------------------
  // isEncrypted
  // ---------------------------------------------------------------------------

  it('isEncrypted: encrypt çıktısı için true döner', () => {
    const ciphertext = encrypt('some-value');
    expect(isEncrypted(ciphertext)).toBe(true);
  });

  it('isEncrypted: düz metin için false döner', () => {
    expect(isEncrypted('sk-plaintext-key')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted('hello:world')).toBe(false);
    expect(isEncrypted('not-hex:not-hex:not-hex')).toBe(false);
  });

  it('isEncrypted: yanlış segment sayısı için false döner', () => {
    expect(isEncrypted('aabbcc')).toBe(false);
    expect(isEncrypted('aabb:ccdd')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // decrypt hata durumları
  // ---------------------------------------------------------------------------

  it('decrypt: geçersiz giriş için hata fırlatır', () => {
    expect(() => decrypt('invalid-value')).toThrow('Failed to decrypt value');
  });

  it('decrypt: bozuk ciphertext için hata fırlatır', () => {
    const valid = encrypt('test');
    const parts = valid.split(':');
    // Ciphertext kısmını bozan değer
    const corrupted = `${parts[0]}:${parts[1]}:deadbeef00`;
    expect(() => decrypt(corrupted)).toThrow('Failed to decrypt value');
  });

  it('decrypt: 2 parça için hata fırlatır', () => {
    expect(() => decrypt('aabbccdd:eeff1122')).toThrow('Failed to decrypt value');
  });

  // ---------------------------------------------------------------------------
  // getVaultKey — env var ile ve env var olmadan çalışır
  // ---------------------------------------------------------------------------

  describe('getVaultKey env var davranışı', () => {
    const ORIGINAL = process.env.OSCORPEX_VAULT_KEY;

    afterEach(() => {
      if (ORIGINAL === undefined) {
        delete process.env.OSCORPEX_VAULT_KEY;
      } else {
        process.env.OSCORPEX_VAULT_KEY = ORIGINAL;
      }
    });

    it('env var olmadan encrypt/decrypt çalışır (hostname-derived key)', () => {
      delete process.env.OSCORPEX_VAULT_KEY;
      const value = 'test-without-env';
      expect(decrypt(encrypt(value))).toBe(value);
    });

    it('env var ile encrypt/decrypt çalışır', () => {
      process.env.OSCORPEX_VAULT_KEY = 'a-very-long-and-secure-vault-key-for-testing-purposes';
      const value = 'test-with-env-key';
      expect(decrypt(encrypt(value))).toBe(value);
    });

    it('kısa env var (< 32 karakter) hostname key kullanır ve çalışır', () => {
      process.env.OSCORPEX_VAULT_KEY = 'short';
      const value = 'test-with-short-key';
      expect(decrypt(encrypt(value))).toBe(value);
    });
  });
});
