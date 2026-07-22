// Thin fetch wrapper around the JSON API. Vite proxies /api -> :3005 in dev;
// in production the same origin serves it. Throws ApiError on non-2xx so views
// can render a real failure state instead of silently rendering undefined.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiGet(path, { signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, { headers: { accept: 'application/json' }, signal });
  } catch (cause) {
    throw new ApiError('Brak połączenia z serwerem.', 0);
  }
  if (!res.ok) {
    throw new ApiError(`Serwer zwrócił błąd ${res.status}.`, res.status);
  }
  return res.json();
}

export const getLatestDraw = (opts) => apiGet('/draws/latest', opts);
export const getDraw = (nr, opts) => apiGet(`/draws/${nr}`, opts);
export const getNumberCareer = (n, opts) => apiGet(`/numbers/${n}`, opts);
