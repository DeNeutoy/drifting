export async function api<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`API error: ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}
