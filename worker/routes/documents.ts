import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { documents, employees } from '../db/schema';
import { type AppEnv, type SessionUser, requireAuth, requireRole } from '../lib/session';

type DB = ReturnType<typeof getDb>;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const TYPES = ['contract', 'government_id', 'certificate', 'medical', 'other'];

const canView = (u: SessionUser, employeeId: string) =>
  u.role === 'admin' || u.role === 'finance' || u.employeeId === employeeId;

const inCompany = async (db: DB, employeeId: string, companyId: string) =>
  !!(await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId))).get());

const findDoc = (db: DB, id: string, companyId: string) =>
  db.select().from(documents).where(and(eq(documents.id, id), eq(documents.companyId, companyId))).get();

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// List one employee's documents
app.get('/employee/:employeeId', async (c) => {
  const user = c.get('user');
  const employeeId = c.req.param('employeeId');
  if (!canView(user, employeeId)) return c.json({ error: "You don't have access to this." }, 403);
  const db = getDb(c.env);
  if (!(await inCompany(db, employeeId, user.companyId))) return c.json({ error: 'Employee not found.' }, 404);
  const docs = await db.select({
    id: documents.id, name: documents.name, type: documents.type,
    sizeBytes: documents.sizeBytes, uploadedAt: documents.uploadedAt,
  }).from(documents)
    .where(and(eq(documents.employeeId, employeeId), eq(documents.companyId, user.companyId)))
    .orderBy(desc(documents.uploadedAt));
  return c.json({ documents: docs, uploadsEnabled: c.env.UPLOADS_ENABLED === 'true' });
});

// Upload (HR Admin only, and only when uploads are enabled)
app.post('/employee/:employeeId', requireRole('admin'), async (c) => {
  if (c.env.UPLOADS_ENABLED !== 'true') return c.json({ error: 'Uploads are turned off in the demo.' }, 403);
  const user = c.get('user');
  const employeeId = c.req.param('employeeId');
  const db = getDb(c.env);
  if (!(await inCompany(db, employeeId, user.companyId))) return c.json({ error: 'Employee not found.' }, 404);

  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'Choose a file to upload.' }, 400);
  const ext = ALLOWED[file.type];
  if (!ext) return c.json({ error: 'Upload a PDF, JPG, PNG or Word file.' }, 400);
  if (file.size === 0) return c.json({ error: 'That file is empty.' }, 400);
  if (file.size > MAX_BYTES) return c.json({ error: 'Files can be up to 5 MB.' }, 400);

  const type = typeof body.type === 'string' && TYPES.includes(body.type) ? body.type : 'other';
  const name = (typeof body.name === 'string' && body.name.trim() ? body.name.trim() : file.name).slice(0, 120);
  const id = crypto.randomUUID();
  const key = `${user.companyId}/${employeeId}/${id}.${ext}`;

  await c.env.hris_files.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await db.insert(documents).values({
    id, companyId: user.companyId, employeeId, name, type, r2Key: key, sizeBytes: file.size,
  });
  return c.json({ document: { id } }, 201);
});

// View or download a file
app.get('/:id/download', async (c) => {
  const user = c.get('user');
  const doc = await findDoc(getDb(c.env), c.req.param('id'), user.companyId);
  if (!doc || !canView(user, doc.employeeId)) return c.json({ error: 'Document not found.' }, 404);

  const obj = await c.env.hris_files.get(doc.r2Key);
  if (!obj) return c.json({ error: 'The file is missing.' }, 404);

  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  const inline = contentType === 'application/pdf' || contentType.startsWith('image/');
  const ext = doc.r2Key.split('.').pop() ?? '';
  const safe = doc.name.replace(/[^\w .-]/g, '_');
  const filename = safe.toLowerCase().endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;

  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
});

// Delete (HR Admin only, and only when uploads are enabled)
app.delete('/:id', requireRole('admin'), async (c) => {
  if (c.env.UPLOADS_ENABLED !== 'true') return c.json({ error: 'Deleting files is turned off in the demo.' }, 403);
  const db = getDb(c.env);
  const doc = await findDoc(db, c.req.param('id'), c.get('user').companyId);
  if (!doc) return c.json({ error: 'Document not found.' }, 404);
  await c.env.hris_files.delete(doc.r2Key);
  await db.delete(documents).where(eq(documents.id, doc.id));
  return c.json({ ok: true });
});

export default app;