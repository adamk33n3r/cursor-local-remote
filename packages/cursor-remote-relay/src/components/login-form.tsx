"use client";

import { useState, type FormEvent } from "react";

export function LoginForm() {
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    const res = await fetch("/login", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    if (res.status === 401) {
      setFailed(true);
      return;
    }
    // Opaque 303 (status 0) still sets the Login cookie; go to the Host list.
    window.location.assign("/hosts");
  }

  return (
    <div className="relative flex min-h-dvh flex-col justify-end bg-bg px-5 pb-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#2a2a33,_transparent_55%)]" />
      <div className="relative">
        <p className="text-4xl font-semibold tracking-tight text-text">Cursor Remote</p>
        <p className="mt-2 mb-8 text-text-secondary">Login on the Host list. Then pick a Host.</p>
        <form
          method="post"
          action="/login"
          onSubmit={onSubmit}
          className="space-y-3 rounded-t-3xl bg-bg p-5"
        >
          <input
            name="username"
            placeholder="Username"
            autoComplete="username"
            autoFocus
            className="w-full rounded-2xl bg-bg-surface px-4 py-3 text-text outline-none"
          />
          <input
            name="password"
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            className="w-full rounded-2xl bg-bg-surface px-4 py-3 text-text outline-none"
          />
          <button
            type="submit"
            className="w-full rounded-2xl bg-success py-3 font-medium text-black"
          >
            Login
          </button>
          {failed ? <p className="text-sm text-warning">Wrong username or password.</p> : null}
        </form>
      </div>
    </div>
  );
}
