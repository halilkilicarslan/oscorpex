// ---------------------------------------------------------------------------
// Oscorpex — Command Policy
// Role bazlı komut kısıtlamalarını tanımlar ve prompt'a enjekte eder.
// ---------------------------------------------------------------------------

export interface CommandPolicy {
  role: string;
  allowedPatterns: string[];   // İzin verilen shell komut kalıpları (glob-benzeri)
  deniedPatterns: string[];    // Yasaklanan shell komut kalıpları
  fileWriteAllowed: boolean;   // Bu rol dosya yazabilir/oluşturabilir mi?
  destructiveAllowed: boolean; // rm, drop vb. yıkıcı komutlara izin var mı?
}

// Reviewer rolleri: sadece okuma
const REVIEWER_ROLES = new Set(['reviewer', 'frontend-reviewer', 'backend-reviewer', 'security-reviewer']);

// Pasif gözlemci rolleri: yalnızca listeleme/arama
const OBSERVER_ROLES = new Set(['product-owner', 'design-lead', 'designer']);

// Teknik dokümantasyon rolleri: okuma + yazma ama silme yok
const TECHNICAL_ROLES = new Set(['architect', 'tech-writer', 'docs-writer']);

/**
 * Verilen role göre varsayılan komut politikasını döndürür.
 * Tanımsız roller geliştirici (dev) politikasına düşer.
 */
export function getDefaultPolicy(role: string): CommandPolicy {
  if (REVIEWER_ROLES.has(role)) {
    return {
      role,
      allowedPatterns: ['cat *', 'ls *', 'find *', 'grep *'],
      deniedPatterns: ['rm *', 'mv *', 'cp *', 'git push*', 'git commit*', 'npm publish*'],
      fileWriteAllowed: false,
      destructiveAllowed: false,
    };
  }

  if (role === 'qa') {
    return {
      role,
      allowedPatterns: ['npm test*', 'pnpm test*', 'vitest*', 'jest*', 'npx *', 'cat *', 'ls *'],
      deniedPatterns: ['rm -rf*', 'git push*', 'npm publish*', 'DROP *', 'DELETE FROM*'],
      fileWriteAllowed: true,
      destructiveAllowed: false,
    };
  }

  if (OBSERVER_ROLES.has(role)) {
    return {
      role,
      allowedPatterns: ['cat *', 'ls *', 'find *'],
      deniedPatterns: ['rm *', 'mv *', 'git *', 'npm *', 'pnpm *'],
      fileWriteAllowed: false,
      destructiveAllowed: false,
    };
  }

  if (TECHNICAL_ROLES.has(role)) {
    return {
      role,
      allowedPatterns: ['cat *', 'ls *', 'find *', 'grep *', 'tree *'],
      deniedPatterns: ['rm -rf*', 'git push*', 'npm publish*'],
      fileWriteAllowed: true,
      destructiveAllowed: false,
    };
  }

  // Varsayılan: geliştirici rolü — kısıtlamasız ama kritik yıkıcı komutlar yasak
  return {
    role,
    allowedPatterns: ['*'],
    deniedPatterns: ['rm -rf /*', 'rm -rf ~*', 'DROP DATABASE*', 'npm publish*'],
    fileWriteAllowed: true,
    destructiveAllowed: false,
  };
}

/**
 * CommandPolicy'yi prompt'a eklenecek markdown bölümüne dönüştürür.
 */
export function buildPolicyPromptSection(policy: CommandPolicy): string {
  const allowedList = policy.allowedPatterns.map((p) => `  - \`${p}\``).join('\n');
  const deniedList = policy.deniedPatterns.map((p) => `  - \`${p}\``).join('\n');
  const fileWrite = policy.fileWriteAllowed ? 'Yes' : 'No';
  const destructive = policy.destructiveAllowed ? 'Allowed (use with caution)' : 'Not allowed';

  return [
    `## Security Policy`,
    `Your role has the following restrictions:`,
    `- Allowed commands:`,
    allowedList,
    `- Denied commands:`,
    deniedList,
    `- File write access: ${fileWrite}`,
    `- Destructive operations: ${destructive}`,
    ``,
    `IMPORTANT: Do not execute denied commands. If a task requires a denied command, report it in your output instead of executing it.`,
  ].join('\n');
}
