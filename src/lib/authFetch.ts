import { fetchAuthSession } from "aws-amplify/auth";

export async function authFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();

  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("Content-Type", "application/json");

  return fetch(url, { ...init, headers });
}
