/**
 * `files` Edge Function logic: the only code that holds the Backblaze B2 keys.
 *
 * Plain JavaScript with its dependencies passed in, so it runs on Supabase (Deno,
 * via index.ts) and in the Node unit tests (with fakes). It never decides who may
 * see what by itself: it asks the database, using the CALLER'S token, so the
 * same RLS rules as the rest of the site apply.
 *
 * Actions (header `x-action`):
 *   upload  body = the PDF bytes. Signed-in users only. Checks size + "%PDF-",
 *           stores it at <uid>/<uuid>.pdf, records it in public.files. -> { path }
 *   sign    { resourceId }. Anyone; the resource must be visible to the caller
 *           under RLS. -> { view, download } (1-hour links)
 *   delete  { paths: [...] } (max 100). Each must pass can_delete_file() for the
 *           caller. -> { deleted: [...], refused: [...] }
 */

export const MAX_BYTES = 20 * 1024 * 1024;
export const LINK_SECONDS = 60 * 60;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
const PATH_RE = new RegExp(`^${UUID}/${UUID}\\.pdf$`);

/**
 * @param deps {
 *   env: { allowedOrigins: string[], bucket, endpoint },
 *   aws: { fetch(url, init), sign(url, init) }       // aws4fetch AwsClient (or fake)
 *   userIdFromToken(token) -> Promise<string|null>   // verifies a Supabase session token
 *   userDb(authHeader) -> supabase client acting as the caller (RLS applies)
 *   adminDb -> supabase client with the service role (writes public.files only)
 *   uuid() -> string
 * }
 */
export function createHandler(deps) {
  const { env, aws, userIdFromToken, userDb, adminDb, uuid } = deps;
  const objectUrl = (path) => `${env.endpoint.replace(/\/$/, '')}/${env.bucket}/${path}`;

  /** B2 request that turns network/URL failures into a clear, secret-free message. */
  async function b2(url, init) {
    try {
      return await aws.fetch(url, init);
    } catch (err) {
      console.error('B2 unreachable', { endpoint: env.endpoint, bucket: env.bucket, error: String(err) });
      throw new HttpError(502, /^https:\/\//.test(env.endpoint)
        ? 'File storage could not be reached. Check the B2_ENDPOINT secret (it should look like https://s3.us-east-005.backblazeb2.com).'
        : 'File storage is misconfigured: the B2_ENDPOINT secret must start with https://');
    }
  }

  function corsHeaders(req) {
    const origin = req.headers.get('origin');
    return {
      'Access-Control-Allow-Origin': origin && env.allowedOrigins.includes(origin) ? origin : 'null',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-action',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  }

  async function callerId(req) {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token || token.startsWith('sb_')) return null; // publishable key = signed out
    return userIdFromToken(token);
  }

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function upload(req) {
    const uid = await callerId(req);
    if (!uid) throw new HttpError(401, 'Please sign in first.');
    const declared = Number(req.headers.get('content-length'));
    if (declared > MAX_BYTES) throw new HttpError(413, 'This file is larger than 20 MB.');

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new HttpError(413, 'This file is larger than 20 MB.');
    if (bytes.length < 5) throw new HttpError(400, 'This file is empty.');
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
      throw new HttpError(415, 'This file does not appear to be a valid PDF.');
    }

    const path = `${uid}/${uuid()}.pdf`;
    const put = await b2(objectUrl(path), {
      method: 'PUT', body: bytes, headers: { 'content-type': 'application/pdf' },
    });
    if (!put.ok) {
      console.error('B2 upload failed', put.status, await put.text().catch(() => ''));
      throw new HttpError(502, put.status === 403 || put.status === 401
        ? 'File storage refused the upload. Check the B2 key secrets (keyID / applicationKey) and that the key may write to this bucket.'
        : put.status === 404 ? 'File storage bucket not found. Check the B2_BUCKET and B2_REGION secrets.'
        : 'The file could not be stored. Please try again.');
    }

    const { error } = await adminDb.from('files').insert({ path, owner_id: uid, size: bytes.length });
    if (error) {
      console.error('files insert failed', error);
      await b2(objectUrl(path), { method: 'DELETE' }).catch(() => {});
      throw new HttpError(500, 'The file could not be recorded. Please try again.');
    }
    return { path };
  }

  async function sign(req, body) {
    const id = String(body?.resourceId ?? '');
    if (!UUID_RE.test(id)) throw new HttpError(400, 'Invalid resource.');
    // Read with the caller's own token: RLS decides whether they may see it.
    const { data, error } = await userDb(req.headers.get('authorization'))
      .from('resources').select('id, title, resource_type, storage_path').eq('id', id).maybeSingle();
    if (error) { console.error(error); throw new HttpError(500, 'Could not check access.'); }
    if (!data || data.resource_type !== 'pdf' || !data.storage_path) throw new HttpError(404, 'Not available.');

    const filename = `${String(data.title).replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'resource'}.pdf`;
    const link = async (disposition) => {
      const url = new URL(objectUrl(data.storage_path));
      url.searchParams.set('X-Amz-Expires', String(LINK_SECONDS));
      url.searchParams.set('response-content-type', 'application/pdf');
      url.searchParams.set('response-content-disposition', disposition);
      return (await aws.sign(url.toString(), { method: 'GET', aws: { signQuery: true } })).url;
    };
    return {
      view: await link('inline'),
      download: await link(`attachment; filename="${filename}"`),
      expiresIn: LINK_SECONDS,
    };
  }

  async function remove(req, body) {
    const uid = await callerId(req);
    if (!uid) throw new HttpError(401, 'Please sign in first.');
    const paths = Array.isArray(body?.paths) ? [...new Set(body.paths.map(String))] : [];
    if (!paths.length || paths.length > 100 || !paths.every((p) => PATH_RE.test(p))) {
      throw new HttpError(400, 'Invalid file list.');
    }
    const db = userDb(req.headers.get('authorization'));
    const deleted = [];
    const refused = [];
    for (const path of paths) {
      const { data: ok, error } = await db.rpc('can_delete_file', { p_path: path });
      if (error || ok !== true) { refused.push(path); continue; }
      const res = await b2(objectUrl(path), { method: 'DELETE' });
      // B2 answers 204 for a deleted (or already missing) object.
      if (!res.ok && res.status !== 404) { console.error('B2 delete failed', path, res.status); refused.push(path); continue; }
      const { error: delErr } = await adminDb.from('files').delete().eq('path', path);
      if (delErr) { console.error(delErr); refused.push(path); continue; }
      deleted.push(path);
    }
    return { deleted, refused };
  }

  return async function handle(req) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (status, obj) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'content-type': 'application/json' },
    });
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });

    try {
      const action = req.headers.get('x-action');
      if (action === 'upload') return json(200, await upload(req));
      const body = await req.json().catch(() => null);
      if (action === 'sign') return json(200, await sign(req, body));
      if (action === 'delete') return json(200, await remove(req, body));
      return json(400, { error: 'Unknown action.' });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error(err);
      return json(500, { error: 'Something went wrong.' });
    }
  };
}
