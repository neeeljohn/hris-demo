export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: isForm ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? 'Something went wrong. Try again.');
  }
  return data as T;
}