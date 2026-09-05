export default function HostsPage() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-auto bg-bg px-4 pb-24 pt-6">
      <div className="mb-6 flex items-baseline justify-between">
        <p className="text-3xl font-semibold text-text">Hosts</p>
        <form method="post" action="/logout">
          <button type="submit" className="text-sm text-text-muted">
            Logout
          </button>
        </form>
      </div>
      <p className="text-text-muted">Nothing registered yet.</p>
    </div>
  );
}
