export interface AeProfile {
  email: string;
  name: string;
  /** E.164. The only number the voice agent will ever dial for this AE. */
  phone: string;
}

export interface AeDirectory {
  /** Matches on the verified sender address, case-insensitively. */
  lookup(email: string | null): AeProfile | null;
}

export function createAeDirectory(entries: readonly AeProfile[]): AeDirectory {
  const byEmail = new Map(
    entries.map((entry) => [entry.email.trim().toLowerCase(), entry])
  );
  return {
    lookup(email) {
      return email ? (byEmail.get(email.trim().toLowerCase()) ?? null) : null;
    },
  };
}

export interface DemoAeEnv {
  demoEmail: string | undefined;
  demoName: string | undefined;
  demoPhone: string | undefined;
}

/**
 * Production would load this from the CRM or HR system. For the demo there is one AE whose
 * phone is supplied through the environment, so no number is ever hardcoded. If any part
 * is missing the directory is empty and every sender is treated as unknown.
 */
export function buildDemoAeDirectory(env: DemoAeEnv): AeDirectory {
  if (env.demoEmail && env.demoName && env.demoPhone) {
    return createAeDirectory([
      { email: env.demoEmail, name: env.demoName, phone: env.demoPhone },
    ]);
  }
  return createAeDirectory([]);
}
