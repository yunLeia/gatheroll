// Deliberately isolated: replace with HttpOnly sessions when the architecture needs them.
// localStorage credentials are accessible to same-origin JS; XSS can steal them.
// "host-participant" is kept distinct from "participant" so opening the guest
// invite link in the host's own browser never mixes the two sessions.
type Role = "host" | "participant" | "host-participant";
const memory = new Map<string, string>();
const key = (role: Role, share: string) => `gatheroll:v1:${role}:${share}`;
const valid = (token: string | null): token is string =>
  !!token && /^[A-Za-z0-9_-]{43}$/.test(token);

export function saveCredential(
  role: Role,
  share: string,
  token: string,
): boolean {
  if (!valid(token)) throw new Error("Invalid credential format");
  memory.set(key(role, share), token);
  try {
    localStorage.setItem(key(role, share), token);
    return true;
  } catch {
    return false;
  }
}

export function readCredential(role: Role, share: string): string | null {
  try {
    const token = localStorage.getItem(key(role, share));
    if (valid(token)) return token;
  } catch {
    /* Keep the current tab usable without persistence. */
  }
  return memory.get(key(role, share)) ?? null;
}

export function forgetCredential(role: Role, share: string) {
  memory.delete(key(role, share));
  try {
    localStorage.removeItem(key(role, share));
  } catch {
    /* Storage unavailable. */
  }
}

export function restoreHost(share: string): {
  token: string | null;
  persisted: boolean;
} {
  const fragment = new URLSearchParams(window.location.hash.slice(1)).get(
    "token",
  );
  // Remove credentials before API requests or any copy/share action.
  if (window.location.hash)
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
  const token = valid(fragment) ? fragment : readCredential("host", share);
  return {
    token,
    persisted: token ? saveCredential("host", share, token) : true,
  };
}

export function managePath(share: string, token: string): string {
  return `/manage/${encodeURIComponent(share)}#token=${encodeURIComponent(token)}`;
}

export function inviteLink(origin: string, share: string): string {
  return `${origin}/e/${encodeURIComponent(share)}`;
}
