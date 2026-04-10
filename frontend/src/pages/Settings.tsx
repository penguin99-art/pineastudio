import { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { api, type BackendInfo } from '../api/client';

export default function Settings() {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [formId, setFormId] = useState('');
  const [formType, setFormType] = useState('ollama');
  const [formUrl, setFormUrl] = useState('http://localhost:11434');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => api.backends().then(setBackends);

  useEffect(() => { refresh(); }, []);

  const handleAdd = async () => {
    if (!formId.trim() || !formUrl.trim()) return;
    setAdding(true);
    setError('');
    try {
      await api.addBackend({ id: formId, type: formType, base_url: formUrl });
      setShowAdd(false);
      setFormId('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add backend');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm(`Remove backend "${id}"?`)) return;
    await api.removeBackend(id);
    refresh();
  };

  const TYPES = [
    { value: 'ollama', label: 'Ollama', defaultUrl: 'http://localhost:11434' },
    { value: 'llama-server', label: 'llama-server', defaultUrl: 'http://localhost:8080' },
    { value: 'openai-compat', label: 'OpenAI Compatible', defaultUrl: 'http://localhost:8080' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <div className="flex gap-1.5">
          <button onClick={refresh} className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800">
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-sm rounded-lg border border-zinc-700"
          >
            <Plus size={14} /> Add Backend
          </button>
        </div>
      </div>

      <div className="px-6 space-y-4">
        {/* Add form */}
        {showAdd && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
            <h2 className="text-sm font-medium text-zinc-300">New Backend</h2>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">ID</label>
                <input
                  value={formId}
                  onChange={(e) => setFormId(e.target.value)}
                  placeholder="my-ollama"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Type</label>
                <select
                  value={formType}
                  onChange={(e) => {
                    setFormType(e.target.value);
                    const t = TYPES.find((t) => t.value === e.target.value);
                    if (t) setFormUrl(t.defaultUrl);
                  }}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none"
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">URL</label>
                <input
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>
            {error && <div className="text-xs text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300">
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={adding}
                className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-sm rounded-lg disabled:opacity-50"
              >
                {adding ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {/* Backend list */}
        <div className="space-y-2">
          {backends.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3 bg-zinc-900 rounded-xl border border-zinc-800">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${b.healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200">{b.id}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {b.type} · {b.kind} · {b.base_url} · {b.model_count} models
                </div>
              </div>
              <button
                onClick={() => handleRemove(b.id)}
                className="p-1.5 text-zinc-600 hover:text-red-400"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {backends.length === 0 && (
            <div className="text-zinc-500 text-sm py-8 text-center">
              No backends configured. Click "Add Backend" to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
