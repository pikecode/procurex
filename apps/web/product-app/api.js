export const apiBase = `${location.protocol}//${location.hostname}:3100/api/v1`;

export async function loadJson(path) {
  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) throw new Error(`${path} 未生成`);
  return response.json();
}

export async function request(path, options = {}, token = null) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error?.message || `请求失败（${response.status}）`);
  return body.data ?? body;
}

export async function login(username, password, client) {
  const session = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, client }),
  });
  return session.accessToken;
}
