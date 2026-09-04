export function liveWebSocketUrl(pathAndQuery: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${pathAndQuery}`;
}
