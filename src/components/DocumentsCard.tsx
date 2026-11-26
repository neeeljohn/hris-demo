import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { Card, btnPrimary, fmtDate, inputCls } from './ui';

type Doc = { id: string; name: string; type: string; sizeBytes: number; uploadedAt: string };

const TYPE_LABEL: Record<string, string> = {
  contract: 'Contract', government_id: 'Government ID', certificate: 'Certificate',
  medical: 'Medical', other: 'Other',
};
const fmtSize = (b: number) =>
  b < 1024 ? `${b} B` : b < 1_048_576 ? `${Math.round(b / 1024)} KB` : `${(b / 1_048_576).toFixed(1)} MB`;

export default function DocumentsCard({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [type, setType] = useState('contract');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() =>
    api<{ documents: Doc[]; uploadsEnabled: boolean }>(`/documents/employee/${employeeId}`)
      .then((d) => { setDocs(d.documents); setEnabled(d.uploadsEnabled); })
      .catch((e: Error) => setError(e.message)), [employeeId]);

  useEffect(() => { load(); }, [load]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choose a file to upload.'); return; }
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    setBusy(true);
    setError('');
    try {
      await api(`/documents/employee/${employeeId}`, { method: 'POST', body: form });
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await api(`/documents/${id}`, { method: 'DELETE' });
      setConfirmId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Documents</h2>
        {docs && <span className="text-sm text-muted">{docs.length} {docs.length === 1 ? 'file' : 'files'}</span>}
      </div>

      <ul className="divide-y divide-line">
        {docs?.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-violet-tint text-violet-text">
              <FileText size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <a href={`/api/documents/${d.id}/download`} target="_blank" rel="noreferrer"
                className="block truncate text-sm font-medium hover:text-violet-text">
                {d.name}
              </a>
              <div className="text-xs text-muted">
                {TYPE_LABEL[d.type] ?? 'Other'} · {fmtSize(d.sizeBytes)} · {fmtDate(d.uploadedAt.slice(0, 10))}
              </div>
            </div>
            {canManage && enabled && (confirmId === d.id ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">Delete?</span>
                <button onClick={() => remove(d.id)} className="font-semibold text-red-700">Yes</button>
                <button onClick={() => setConfirmId('')} className="text-muted">No</button>
              </div>
            ) : (
              <button aria-label={`Delete ${d.name}`} onClick={() => setConfirmId(d.id)}
                className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-700">
                <Trash2 size={16} />
              </button>
            ))}
          </li>
        ))}
      </ul>
      {docs?.length === 0 && <p className="py-3 text-sm text-muted">No documents yet.</p>}

      {canManage && enabled && (
        <form onSubmit={upload} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <label className="block min-w-0 flex-[1_1_240px] text-sm font-medium">
            File (PDF, JPG, PNG or Word, up to 5 MB)
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.docx"
              className="mt-1.5 block w-full text-sm file:mr-3 file:h-10 file:cursor-pointer file:rounded-lg file:border-0 file:bg-violet-tint file:px-4 file:font-semibold file:text-violet-text" />
          </label>
          <label className="block w-44 text-sm font-medium">
            Type
            <select value={type} onChange={(e) => setType(e.target.value)} className={`${inputCls} mt-1.5`}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button disabled={busy} className={btnPrimary}>
            <Upload size={16} aria-hidden="true" /> {busy ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      )}
      {canManage && !enabled && (
        <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
          Uploads are turned off in this demo. Sample files are shown.
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </Card>
  );
}