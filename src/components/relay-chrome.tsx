export function RelayChrome() {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
      <a href="/hosts" className="rounded px-2 py-1 text-sm text-text-secondary hover:bg-bg-hover">
        Hosts
      </a>
      <form method="post" action="/logout">
        <button type="submit" className="text-sm text-text-muted hover:text-text">
          Logout
        </button>
      </form>
    </div>
  );
}
