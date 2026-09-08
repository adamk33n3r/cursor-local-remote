interface ApiError extends Error {
  status: number;
  body: { error: string };
}

function createApiError(status: number, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.name = "ApiError";
  err.status = status;
  err.body = { error: message };
  return err;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

async function attempt(input: string, init: ApiFetchOptions, retriesLeft: number): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries: _, ...fetchInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, {
      ...fetchInit,
      credentials: "same-origin",
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 410 && typeof window !== "undefined") {
        window.location.replace("/hosts");
      }
      if (retriesLeft > 0 && RETRYABLE_STATUSES.has(res.status)) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return attempt(input, init, retriesLeft - 1);
      }

      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body.error) message = body.error;
      } catch {
        // no json body
      }
      throw createApiError(res.status, message);
    }

    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (retriesLeft > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return attempt(input, init, retriesLeft - 1);
      }
      throw createApiError(0, "Request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function apiFetch(input: string, init: ApiFetchOptions = {}): Promise<Response> {
  return attempt(input, init, init.retries ?? MAX_RETRIES);
}

export async function apiFetchJson<T>(input: string, init: ApiFetchOptions = {}): Promise<T> {
  const res = await apiFetch(input, init);
  return res.json() as Promise<T>;
}
