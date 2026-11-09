#!/usr/bin/env node
/**
 * Unit tests for supabase/functions/files/handler.js, run in Node with fakes for
 * Supabase and B2, plus the REAL aws4fetch signer (to check the link format).
 *
 * Limits: this does not talk to Backblaze or Supabase. It checks our logic
 * (who may upload/sign/delete, size and PDF checks, what is recorded). The real
 * B2 path is checked by hand after deployment (docs/storage-b2.md).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AwsClient } from 'aws4fetch';
import { createHandler, MAX_BYTES } from '../functions/files/handler.js';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const RES = '33333333-3333-4333-8333-333333333333';
const FILE_UUID = '44444444-4444-4444-8444-444444444444';
const ORIGIN = 'http://127.0.0.1:5173';

function setup({ visible = true, deletable = new Set(), b2Status = 200, insertError = null } = {}) {
  const b2 = [];      // requests sent to B2
  const files = [];   // rows written with the service role
  const deletedRows = [];
  const realSigner = new AwsClient({ accessKeyId: 'KEYID', secretAccessKey: 'SECRET', service: 's3', region: 'us-east-005' });
  const handle = createHandler({
    env: { bucket: 'hub-files', endpoint: 'https://s3.us-east-005.backblazeb2.com', allowedOrigins: [ORIGIN] },
    aws: {
      fetch: async (url, init) => { b2.push({ url, method: init.method, type: init.headers?.['content-type'] }); return init.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response('', { status: b2Status }); },
      sign: (url, init) => realSigner.sign(url, init),
    },
    userIdFromToken: async (t) => ({ 'alice-token': ALICE, 'bob-token': BOB }[t] ?? null),
    userDb: (auth) => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: visible && auth ? { id: RES, title: 'Kinematics: notes!', resource_type: 'pdf', storage_path: `${ALICE}/${FILE_UUID}.pdf` } : null, error: null,
      }) }) }) }),
      rpc: async (_fn, { p_path }) => ({ data: deletable.has(`${auth}|${p_path}`), error: null }),
    }),
    adminDb: { from: () => ({
      insert: async (row) => { if (insertError) return { error: insertError }; files.push(row); return { error: null }; },
      delete: () => ({ eq: async (_c, v) => { deletedRows.push(v); return { error: null }; } }),
    }) },
    uuid: () => FILE_UUID,
  });
  return { handle, b2, files, deletedRows };
}

const req = (action, { token, body, json, headers = {} } = {}) => new Request('https://x.supabase.co/functions/v1/files', {
  method: 'POST',
  headers: { origin: ORIGIN, 'x-action': action, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  body: json ? JSON.stringify(json) : body,
});
const pdf = (n = 100) => { const b = new Uint8Array(n); b.set([37, 80, 68, 70, 45]); return b; }; // "%PDF-"

test('upload: signed-out callers are refused', async () => {
  const { handle, b2 } = setup();
  const res = await handle(req('upload', { body: pdf() }));
  assert.equal(res.status, 401);
  assert.equal(b2.length, 0);
});

test('upload: the publishable key counts as signed out', async () => {
  const { handle } = setup();
  assert.equal((await handle(req('upload', { token: 'sb_publishable_abc', body: pdf() }))).status, 401);
});

test('upload: a PDF is stored in the caller\'s own folder and recorded', async () => {
  const { handle, b2, files } = setup();
  const res = await handle(req('upload', { token: 'alice-token', body: pdf(1234) }));
  assert.equal(res.status, 200);
  const { path } = await res.json();
  assert.equal(path, `${ALICE}/${FILE_UUID}.pdf`);
  assert.deepEqual(b2, [{ url: `https://s3.us-east-005.backblazeb2.com/hub-files/${path}`, method: 'PUT', type: 'application/pdf' }]);
  assert.deepEqual(files, [{ path, owner_id: ALICE, size: 1234 }]);
});

test('upload: a non-PDF (wrong signature) is refused and nothing is stored', async () => {
  const { handle, b2, files } = setup();
  const res = await handle(req('upload', { token: 'alice-token', body: new TextEncoder().encode('<html><script>alert(1)</script>') }));
  assert.equal(res.status, 415);
  assert.equal(b2.length + files.length, 0);
});

test('upload: files over 20 MB are refused', async () => {
  const { handle, b2 } = setup();
  const res = await handle(req('upload', { token: 'alice-token', body: pdf(MAX_BYTES + 1) }));
  assert.equal(res.status, 413);
  assert.equal(b2.length, 0);
});

test('upload: if recording fails, the stored object is deleted again', async () => {
  const { handle, b2 } = setup({ insertError: { message: 'boom' } });
  const res = await handle(req('upload', { token: 'alice-token', body: pdf() }));
  assert.equal(res.status, 500);
  assert.deepEqual(b2.map((r) => r.method), ['PUT', 'DELETE']);
});

test('upload: a B2 failure is reported and nothing is recorded', async () => {
  const { handle, files } = setup({ b2Status: 503 });
  assert.equal((await handle(req('upload', { token: 'alice-token', body: pdf() }))).status, 502);
  assert.equal(files.length, 0);
});

test('upload: an unreachable or malformed B2 endpoint gives a clear message, not "Something went wrong"', async () => {
  const { handle } = setup();
  // Rebuild with a fetch that throws, like a bad hostname or an endpoint missing https://
  const h2 = createHandler({
    env: { bucket: 'b', endpoint: 's3.us-east-005.backblazeb2.com', allowedOrigins: [ORIGIN] },
    aws: { fetch: async () => { throw new TypeError('Invalid URL'); }, sign: async () => ({ url: '' }) },
    userIdFromToken: async () => ALICE, userDb: () => ({}), adminDb: { from: () => ({}) }, uuid: () => FILE_UUID,
  });
  const res = await h2(req('upload', { token: 'alice-token', body: pdf() }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /B2_ENDPOINT secret must start with https:\/\//);
  assert.ok(handle);
});

test('upload: B2 refusing the key (403) points at the key secrets', async () => {
  const { handle } = setup({ b2Status: 403 });
  const res = await handle(req('upload', { token: 'alice-token', body: pdf() }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /B2 key secrets/);
});

test('sign: a resource the caller cannot see (RLS returns nothing) gets no link', async () => {
  const { handle } = setup({ visible: false });
  const res = await handle(req('sign', { token: 'bob-token', json: { resourceId: RES } }));
  assert.equal(res.status, 404);
});

test('sign: malformed ids are refused before any database call', async () => {
  const { handle } = setup();
  assert.equal((await handle(req('sign', { json: { resourceId: "1' or 1=1" } }))).status, 400);
});

test('sign: visible PDFs get two signed 1-hour links (view inline, download as attachment)', async () => {
  const { handle } = setup();
  const res = await handle(req('sign', { token: 'alice-token', json: { resourceId: RES } }));
  assert.equal(res.status, 200);
  const { view, download, expiresIn } = await res.json();
  assert.equal(expiresIn, 3600);
  for (const link of [view, download]) {
    const u = new URL(link);
    assert.equal(u.host, 's3.us-east-005.backblazeb2.com');
    assert.equal(u.pathname, `/hub-files/${ALICE}/${FILE_UUID}.pdf`);
    assert.equal(u.searchParams.get('X-Amz-Expires'), '3600');
    assert.equal(u.searchParams.get('response-content-type'), 'application/pdf');
    assert.match(u.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
    assert.match(u.searchParams.get('X-Amz-Credential'), /^KEYID\/\d{8}\/us-east-005\/s3\/aws4_request$/);
    assert.ok(!link.includes('SECRET'), 'secret must never appear in a link');
  }
  assert.equal(new URL(view).searchParams.get('response-content-disposition'), 'inline');
  assert.equal(new URL(download).searchParams.get('response-content-disposition'), 'attachment; filename="Kinematics notes.pdf"');
});

test('delete: only paths the database allows are deleted; others are refused', async () => {
  const ok = `${ALICE}/${FILE_UUID}.pdf`;
  const other = `${BOB}/${FILE_UUID}.pdf`;
  const { handle, b2, deletedRows } = setup({ deletable: new Set([`Bearer alice-token|${ok}`]) });
  const res = await handle(req('delete', { token: 'alice-token', json: { paths: [ok, other] } }));
  assert.deepEqual(await res.json(), { deleted: [ok], refused: [other] });
  assert.deepEqual(b2.map((r) => r.method), ['DELETE']);
  assert.deepEqual(deletedRows, [ok]);
});

test('delete: signed-out callers and invalid paths are refused', async () => {
  const { handle } = setup();
  assert.equal((await handle(req('delete', { json: { paths: [`${ALICE}/${FILE_UUID}.pdf`] } }))).status, 401);
  assert.equal((await handle(req('delete', { token: 'alice-token', json: { paths: ['../../etc/passwd'] } }))).status, 400);
});

test('CORS: only listed origins are echoed back; preflight works', async () => {
  const { handle } = setup();
  const pre = await handle(new Request('https://x/functions/v1/files', { method: 'OPTIONS', headers: { origin: ORIGIN } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  const evil = await handle(new Request('https://x/functions/v1/files', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assert.equal(evil.headers.get('access-control-allow-origin'), 'null');
});
