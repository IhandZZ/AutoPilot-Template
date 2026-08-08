const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''

// FastAPI's default validation-error shape puts `detail` as an array of
// {loc, msg, type} objects rather than a plain string — rendering that
// directly (or via String()) produces the unhelpful "[object Object]".
// Flatten it into a readable message instead.
function stringifyErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item) {
          const loc = 'loc' in item && Array.isArray((item as { loc?: unknown[] }).loc)
            ? (item as { loc: unknown[] }).loc.slice(-1)[0]
            : null
          return loc ? `${loc}: ${(item as { msg: string }).msg}` : String((item as { msg: string }).msg)
        }
        return typeof item === 'string' ? item : JSON.stringify(item)
      })
      .join('; ')
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return ''
}

/**
 * A robust API client that handles authentication and base path resolution.
 *
 * Note: this intentionally does NOT call next-auth's getSession() before
 * every request. This app runs with AUTH_BYPASS=true on the backend (it
 * ignores the Authorization header entirely) and NextAuth is configured to
 * always auto-authenticate as "Dev User" — there's no real session check
 * happening anywhere. Calling getSession() here added a full extra
 * round-trip to /api/auth/session before every single API call (dashboard
 * loads, notice status polling every 4s, recent-submissions polling every
 * 8s, etc.), which was the single biggest source of perceived app-wide
 * slowness. If real auth is ever wired in, re-add a token here.
 *
 * @param endpoint The API endpoint to call, e.g., '/api/test' or '/api/admin/dashboard'.
 *                 The endpoint should include the '/api' prefix.
 * @param options Standard fetch options (method, body, etc.).
 */
async function apiClientFetch<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})

  // Construct the full URL: http://localhost:8001/app1/api/test
  const fullUrl = `${API_URL}${BASE_PATH}${endpoint}`

  const response = await fetch(fullUrl, { ...options, headers })

  // If the backend returns a 401, log it but don't force redirect in dev mode
  if (response.status === 401) {
    console.warn('[API] 401 Unauthorized — check backend AUTH_BYPASS setting')
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      detail: response.statusText,
    }))
    throw new Error(stringifyErrorDetail(errorData?.detail) || 'An API error occurred.')
  }

  // Handle responses with no content
  if (response.status === 204) {
    return null as T
  }

  return response.json() as Promise<T>
}

/**
 * API client with convenience methods for common HTTP operations.
 */
export const apiClient = {
  /**
   * Perform a GET request.
   */
  get: <T = unknown>(endpoint: string, options?: RequestInit): Promise<T> => {
    return apiClientFetch<T>(endpoint, { ...options, method: 'GET' })
  },

  /**
   * Perform a POST request.
   */
  post: <T = unknown>(endpoint: string, data?: unknown, options?: RequestInit): Promise<T> => {
    return apiClientFetch<T>(endpoint, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  /**
   * Perform a PUT request.
   */
  put: <T = unknown>(endpoint: string, data?: unknown, options?: RequestInit): Promise<T> => {
    return apiClientFetch<T>(endpoint, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  /**
   * Perform a PATCH request.
   */
  patch: <T = unknown>(endpoint: string, data?: unknown, options?: RequestInit): Promise<T> => {
    return apiClientFetch<T>(endpoint, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  /**
   * Perform a DELETE request.
   */
  delete: <T = unknown>(endpoint: string, options?: RequestInit): Promise<T> => {
    return apiClientFetch<T>(endpoint, { ...options, method: 'DELETE' })
  },
}

// Default export for backward compatibility
export default apiClientFetch
