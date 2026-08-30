/** Server-side only helper - calls apps/api, which owns all product business logic. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) throw new Error("API_URL is not configured");

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API request to ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
