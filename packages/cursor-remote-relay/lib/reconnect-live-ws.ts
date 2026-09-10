export type LiveSocket = {
  readyState: number;
  close: () => void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

export type ReconnectingLiveOpts = {
  url: () => string;
  onMessage: (data: string) => void;
  onDisconnected?: () => void;
  /** True when the Relay is accepting HTTP again. Failed probes must not open a WebSocket. */
  probe?: (signal: AbortSignal) => Promise<boolean>;
  probeUrl?: () => string;
  probeTimeoutMs?: number;
  createWebSocket?: (url: string) => LiveSocket;
  reconnectMs?: number;
  /** Minimum wait after a live socket closes without OPEN (Chrome can leave TCP Pending). */
  handshakeRetryMs?: number;
  maxReconnectMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type ReconnectingLive = {
  stop: () => void;
};

const CONNECTING = 0;
const OPEN = 1;

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function probeRelay(
  probe: ((signal: AbortSignal) => Promise<boolean>) | undefined,
  probeUrl: () => string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (probe) return probe(signal);

  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  try {
    const res = await fetch(probeUrl(), { signal: combined });
    return res.ok;
  } catch {
    return false;
  }
}

export function startReconnectingWebSocket(opts: ReconnectingLiveOpts): ReconnectingLive {
  const reconnectMs = opts.reconnectMs ?? 1_000;
  const handshakeRetryMs = opts.handshakeRetryMs ?? 5_000;
  const maxReconnectMs = opts.maxReconnectMs ?? 30_000;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 2_000;
  const probeUrl = opts.probeUrl ?? (() => "/api/hosts");
  const create = opts.createWebSocket ?? ((url: string) => new WebSocket(url) as LiveSocket);
  const sleep = opts.sleep ?? defaultSleep;

  let stopped = false;
  let socket: LiveSocket | null = null;
  let waitAbort: AbortController | null = null;
  let probeAbort: AbortController | null = null;
  let probing = false;
  let backoffMs = reconnectMs;

  function abortWait(): void {
    waitAbort?.abort();
    waitAbort = null;
  }

  function connect(): void {
    if (stopped) return;
    if (socket && (socket.readyState === CONNECTING || socket.readyState === OPEN)) return;

    const current = create(opts.url());
    socket = current;
    let reachedOpen = false;

    current.onopen = () => {
      if (socket !== current) return;
      reachedOpen = true;
      backoffMs = reconnectMs;
    };

    current.onmessage = (event) => {
      if (socket !== current) return;
      opts.onMessage(String(event.data));
    };

    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      opts.onDisconnected?.();
      if (stopped) return;
      // A CONNECTING close can be Chrome dropping the JS socket while TCP
      // is still Pending. Wait before the next constructor.
      if (!reachedOpen) {
        const wait = Math.max(backoffMs, handshakeRetryMs);
        backoffMs = Math.min(backoffMs * 2, maxReconnectMs);
        void schedule(wait);
        return;
      }
      void schedule(0);
    };
  }

  async function schedule(waitMs: number): Promise<void> {
    if (stopped || probing || waitAbort) return;
    if (waitMs <= 0) {
      await tryReconnect();
      return;
    }
    const ac = new AbortController();
    waitAbort = ac;
    try {
      await sleep(waitMs, ac.signal);
    } catch {
      return;
    } finally {
      if (waitAbort === ac) waitAbort = null;
    }
    if (stopped || ac.signal.aborted) return;
    await tryReconnect();
  }

  async function tryReconnect(): Promise<void> {
    if (stopped) return;
    if (socket && (socket.readyState === CONNECTING || socket.readyState === OPEN)) return;
    if (probing) return;

    probing = true;
    const ac = new AbortController();
    probeAbort = ac;
    let up = false;
    try {
      up = await probeRelay(opts.probe, probeUrl, probeTimeoutMs, ac.signal);
    } catch {
      up = false;
    } finally {
      probing = false;
      probeAbort = null;
    }
    if (stopped) return;
    if (up) {
      backoffMs = reconnectMs;
      connect();
      return;
    }
    const wait = backoffMs;
    backoffMs = Math.min(backoffMs * 2, maxReconnectMs);
    void schedule(wait);
  }

  function stop(): void {
    stopped = true;
    abortWait();
    probeAbort?.abort();
    probeAbort = null;
    const current = socket;
    socket = null;
    if (!current) return;
    current.onclose = null;
    current.onopen = null;
    current.onmessage = null;
    if (current.readyState === CONNECTING || current.readyState === OPEN) {
      current.close();
    }
  }

  connect();
  return { stop };
}
