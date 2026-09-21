import type { FetchLike } from '../src/index.js';

/**
 * A recording fetch double.
 *
 * Offline and deterministic — no test in this package reaches the network, and
 * none needs a real timer.
 */

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface FetchDouble {
  fetch: FetchLike;
  requests: RecordedRequest[];
  /** The single request, asserting exactly one was made. */
  only(): RecordedRequest;
}

export type Responder = (
  request: RecordedRequest,
  callIndex: number,
) => Response | Promise<Response>;

/** Build a fetch double from a responder or a queue of responses. */
export function createFetchDouble(responder: Responder | Response[]): FetchDouble {
  const requests: RecordedRequest[] = [];
  let call = 0;

  const respond: Responder =
    typeof responder === 'function'
      ? responder
      : (_request, index) => {
          const response = responder[index];
          if (response === undefined) throw new Error(`no queued response for call ${index}`);
          return response;
        };

  const fetch: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    const record: RecordedRequest = {
      url: input,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
    };
    requests.push(record);

    // Honour an already-aborted signal the way a real fetch would.
    if (init.signal?.aborted === true) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }

    const index = call;
    call += 1;
    return respond(record, index);
  };

  return {
    fetch,
    requests,
    only() {
      if (requests.length !== 1) {
        throw new Error(`expected exactly 1 request, saw ${requests.length}`);
      }
      return requests[0]!;
    },
  };
}

/** A JSON response. */
export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

/** A Graph error response. */
export function errorResponse(
  status: number,
  error: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return jsonResponse({ error }, { status, ...(headers ? { headers } : {}) });
}

/** A fetch that never resolves until the request's signal aborts. */
export const neverResolves: FetchLike = (_input, init) =>
  new Promise((_resolve, reject) => {
    const signal = init.signal;
    const fail = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal?.aborted === true) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });

/** A fetch that fails the way a dropped connection does. */
export const connectionFails: FetchLike = () => Promise.reject(new TypeError('fetch failed'));

/** A successful send response, in Meta's documented shape. */
export const SEND_OK = {
  messaging_product: 'whatsapp',
  contacts: [{ input: '15555550123', wa_id: '15555550123' }],
  messages: [
    {
      id: 'wamid.HBgLMTU1NTU1NTAxMjMVAgARGBI3MTE5MjVBOTE3MDk5QUVFM0YA',
      message_status: 'accepted',
    },
  ],
};

export const TEST_TOKEN = 'test_access_token_not_a_real_value';
export const GRAPH_VERSION = 'v24.0';
export const WABA_ID = '102290129340398';
export const PHONE_NUMBER_ID = '106540352242922';

/**
 * Await a promise expected to reject, and return the rejection typed.
 *
 * `promise.catch((e) => e as T)` widens to `T | ResolvedType`, which defeats
 * property access in assertions. This narrows it and fails loudly if the
 * promise resolves instead.
 */
export async function rejectionOf<T = Error>(promise: Promise<unknown>): Promise<T> {
  try {
    await promise;
  } catch (caught) {
    return caught as T;
  }
  throw new Error('expected the promise to reject, but it resolved');
}
