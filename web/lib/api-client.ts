/** fetch for signed-in screens: sends the user to the right page when the session no longer allows the call. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    window.location.assign("/login");
  } else if (res.status === 403) {
    const body: unknown = await res.clone().json().catch(() => null);
    if ((body as { code?: unknown } | null)?.code === "password_change_required") {
      window.location.assign("/account/password");
    }
  }
  return res;
}
