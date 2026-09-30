/**
 * A minimal Feishu Open Platform client for a self-built app: the tenant
 * access token (cached until shortly before it expires) and JSON calls under
 * `/open-apis`. Shared by the directory source (V1-03) and the bot transport
 * (V1-04). Errors name the Feishu code and message, never the token or the
 * app secret.
 */
export interface FeishuApiOptions {
  readonly appId: string;
  readonly appSecret: string;
  /** `https://open.feishu.cn`, or `https://open.larksuite.com` for Lark. */
  readonly baseUrl: string;
  /** Injected in tests. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export interface FeishuApi {
  call<T>(
    path: string,
    init?: {
      method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
      body?: unknown;
      /** false for the token request itself. */
      auth?: boolean;
    },
  ): Promise<T>;
}

/** Refresh the tenant token this long before Feishu says it expires. */
const TOKEN_MARGIN_MS = 5 * 60_000;

export function createFeishuApi(options: FeishuApiOptions): FeishuApi {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const base = options.baseUrl.replace(/\/+$/u, '');
  let token: { value: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  const api: FeishuApi = {
    async call<T>(
      path: string,
      init: Parameters<FeishuApi['call']>[1] = {},
    ): Promise<T> {
      const headers: Record<string, string> = {
        'content-type': 'application/json; charset=utf-8',
      };
      if (init.auth !== false)
        headers.authorization = `Bearer ${await tenantToken()}`;
      const response = await request(`${base}/open-apis${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const reply = (await response.json().catch(() => null)) as {
        code?: number;
        msg?: string;
        data?: T;
      } | null;
      if (!reply) throw new Error(`FEISHU_HTTP_${response.status}`);
      if (reply.code !== 0)
        throw new Error(
          `FEISHU_API_${reply.code ?? response.status}${reply.msg ? `: ${reply.msg}` : ''}`,
        );
      return (reply.data ?? reply) as T;
    },
  };

  async function tenantToken(): Promise<string> {
    if (token && token.expiresAt > now()) return token.value;
    // Concurrent callers share one token request.
    pending ??= api
      .call<{ tenant_access_token?: string; expire?: number }>(
        '/auth/v3/tenant_access_token/internal',
        {
          method: 'POST',
          auth: false,
          body: { app_id: options.appId, app_secret: options.appSecret },
        },
      )
      .then((reply) => {
        if (!reply.tenant_access_token) throw new Error('FEISHU_NO_TOKEN');
        token = {
          value: reply.tenant_access_token,
          expiresAt: now() + (reply.expire ?? 7200) * 1000 - TOKEN_MARGIN_MS,
        };
        return token.value;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }

  return api;
}
