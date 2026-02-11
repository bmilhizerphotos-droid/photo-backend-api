const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeBase(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

export function getApiBase(): string {
  const env = (import.meta as any)?.env ?? {};
  const configuredBase = normalizeBase(env.VITE_API_BASE_URL);

  if (!configuredBase) return "";

  // Guard rail: while developing on localhost, avoid accidentally forcing
  // requests to a remote production host, which causes browser CORS failures.
  if (typeof window !== "undefined" && LOCALHOST_HOSTS.has(window.location.hostname)) {
    try {
      const configuredHost = new URL(configuredBase).hostname;
      if (!LOCALHOST_HOSTS.has(configuredHost)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[api] Ignoring VITE_API_BASE_URL="${configuredBase}" while running on ${window.location.hostname}; using Vite proxy (/api) instead.`
        );
        return "";
      }
    } catch {
      return "";
    }
  }

  return configuredBase;
}
