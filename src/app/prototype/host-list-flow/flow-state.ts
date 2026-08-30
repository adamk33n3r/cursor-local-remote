"use client";

import { useCallback, useMemo, useState } from "react";

export type Screen = "login" | "list" | "host";

export type HostRow = {
  id: string;
  displayName: string;
  online: boolean;
};

export type FlowState = {
  screen: Screen;
  loggedIn: boolean;
  username: string;
  hosts: HostRow[];
  selectedHostId: string | null;
  stickyPath: string;
  lastAction: string;
  notice: string | null;
};

const INITIAL_HOSTS: HostRow[] = [
  { id: "host-office", displayName: "Office PC", online: true },
  { id: "host-travel", displayName: "Travel laptop", online: false },
];

function hostPath(id: string): string {
  return `/h/${id}`;
}

export const INITIAL_FLOW: FlowState = {
  screen: "login",
  loggedIn: false,
  username: "",
  hosts: INITIAL_HOSTS,
  selectedHostId: null,
  stickyPath: "/",
  lastAction: "open Host list URL (logged out)",
  notice: null,
};

export function useHostListFlow() {
  const [state, setState] = useState<FlowState>(INITIAL_FLOW);

  const selectedHost = useMemo(
    () => state.hosts.find((h) => h.id === state.selectedHostId) ?? null,
    [state.hosts, state.selectedHostId],
  );

  const login = useCallback((username: string, password: string) => {
    if (!username.trim() || !password) {
      setState((s) => ({
        ...s,
        lastAction: "login failed (empty fields)",
        notice: "Username and password are required.",
      }));
      return;
    }
    setState((s) => ({
      ...s,
      screen: "list",
      loggedIn: true,
      username: username.trim(),
      selectedHostId: null,
      stickyPath: "/",
      lastAction: `Login as ${username.trim()} (cookie stand-in: 7 days)`,
      notice: null,
    }));
  }, []);

  const logout = useCallback(() => {
    setState((s) => ({
      ...s,
      screen: "login",
      loggedIn: false,
      username: "",
      selectedHostId: null,
      stickyPath: "/",
      lastAction: "Logout (Relay cookie gone; Token path unchanged)",
      notice: null,
    }));
  }, []);

  const pick = useCallback((id: string) => {
    setState((s) => {
      const host = s.hosts.find((h) => h.id === id);
      if (!host) {
        return { ...s, lastAction: `pick missing ${id}`, notice: "Unknown Host." };
      }
      if (!host.online) {
        return {
          ...s,
          screen: "list",
          selectedHostId: null,
          stickyPath: "/",
          lastAction: `offline pick refused: ${host.displayName}`,
          notice: "Offline is not a live pick. Stay on the Host list.",
        };
      }
      return {
        ...s,
        screen: "host",
        selectedHostId: host.id,
        stickyPath: hostPath(host.id),
        lastAction: `pick ${host.displayName} → sticky ${hostPath(host.id)}`,
        notice: null,
      };
    });
  }, []);

  const backToList = useCallback(() => {
    setState((s) => ({
      ...s,
      screen: "list",
      selectedHostId: null,
      stickyPath: "/",
      lastAction: "back to Host list (still logged in)",
      notice: null,
    }));
  }, []);

  const forget = useCallback((id: string) => {
    setState((s) => {
      const host = s.hosts.find((h) => h.id === id);
      if (!host) return s;
      if (host.online) {
        return {
          ...s,
          lastAction: `Forget refused while ${host.displayName} is online`,
          notice: "Forget is only on offline rows.",
        };
      }
      const remaining = s.hosts.filter((h) => h.id !== id);
      return {
        ...s,
        hosts: remaining,
        lastAction: `Forget ${host.displayName}`,
        notice: `Forgot ${host.displayName}. Reconnect with the same id is this row again.`,
      };
    });
  }, []);

  const restoreDemoHosts = useCallback(() => {
    setState((s) => ({
      ...s,
      hosts: INITIAL_HOSTS,
      lastAction: "restore demo Hosts (prototype only)",
      notice: null,
    }));
  }, []);

  const flipOnline = useCallback((id: string) => {
    setState((s) => {
      const hosts = s.hosts.map((h) => (h.id === id ? { ...h, online: !h.online } : h));
      const host = hosts.find((h) => h.id === id);
      const droppedWhileInside = s.screen === "host" && s.selectedHostId === id && host && !host.online;
      if (droppedWhileInside) {
        return {
          ...s,
          hosts,
          lastAction: `Tunnel drop while inside ${host.displayName} (retry stand-in)`,
          notice: "Connection error. Retry. Direct LAN Clients are unaffected.",
        };
      }
      return {
        ...s,
        hosts,
        lastAction: `${host?.displayName ?? id} is now ${host?.online ? "online" : "offline"} (live list, no reload)`,
        notice: null,
      };
    });
  }, []);

  const openHostUrlLoggedOut = useCallback((id: string) => {
    setState((s) => {
      const host = s.hosts.find((h) => h.id === id);
      if (!host) return s;
      if (!s.loggedIn) {
        return {
          ...s,
          screen: "login",
          lastAction: `open ${hostPath(id)} while logged out → Login first`,
          notice: `After Login, ${host.online ? "land on this Host" : "show the Host list with this row offline"}.`,
        };
      }
      if (!host.online) {
        return {
          ...s,
          screen: "list",
          selectedHostId: null,
          stickyPath: "/",
          lastAction: `open ${hostPath(id)} while online-auth but Host offline`,
          notice: "Logged in, Host offline: Host list with that row visible as offline.",
        };
      }
      return {
        ...s,
        screen: "host",
        selectedHostId: id,
        stickyPath: hostPath(id),
        lastAction: `open sticky ${hostPath(id)} (still logged in, Host online)`,
        notice: null,
      };
    });
  }, []);

  return {
    state,
    selectedHost,
    login,
    logout,
    pick,
    backToList,
    forget,
    restoreDemoHosts,
    flipOnline,
    openHostUrlLoggedOut,
  };
}

export type HostListFlow = ReturnType<typeof useHostListFlow>;
