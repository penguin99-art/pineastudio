import { useState, useEffect } from 'react';
import { Search, Download, HardDrive, Loader2 } from 'lucide-react';
import { api, type ModelInfo, type HubSearchResult, type DownloadTask } from '../api/client';

export default function Models() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HubSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [repoFiles, setRepoFiles] = useState<{ filename: string; size_bytes: number | null }[]>([]);
  const [tab, setTab] = useState<'local' | 'hub'>('local');

  useEffect(() => {
    loadModels();
    loadDownloads();
  }, []);

  const loadModels = () => api.models().then((r) => setModels(r.models));
  const loadDownloads = () => api.hubDownloads().then(setDownloads);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.hubSearch(query);
      setSearchResults(res);
    } finally {
      setSearching(false);
    }
  };

  const handleExpandRepo = async (repo_id: string) => {
    if (expandedRepo === repo_id) { setExpandedRepo(null); return; }
    setExpandedRepo(repo_id);
    const res = await fetch(`/api/hub/model/${repo_id}`).then((r) => r.json());
    setRepoFiles(res.gguf_files || []);
  };

  const handleDownload = async (repo_id: string, filename: string) => {
    await api.hubDownload(repo_id, filename);
    loadDownloads();
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '—';
    const gb = bytes / 1e9;
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
  };

  const formatDownloads = (n: number) => {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-6 pt-5 pb-3">
        <h1 className="text-lg font-semibold">Models</h1>
      </div>

      {/* Tabs */}
      <div className="shrink-0 px-6 flex gap-1 border-b border-zinc-800">
        {(['local', 'hub'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize border-b-2 transition-colors ${
              tab === t
                ? 'border-zinc-300 text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t === 'local' ? 'Local Models' : 'HuggingFace Hub'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {tab === 'local' ? (
          /* ── Local Models ── */
          <div className="space-y-2">
            {models.length === 0 ? (
              <div className="text-zinc-500 text-sm py-8 text-center">
                No models found. Add a backend or download from HuggingFace.
              </div>
            ) : (
              models.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3 bg-zinc-900 rounded-xl border border-zinc-800">
                  <HardDrive size={16} className="text-zinc-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-200 truncate">{m.name}</div>
                    <div className="text-xs text-zinc-500 flex gap-2 mt-0.5">
                      <span>{m.backend_id}</span>
                      {m.details.parameter_size && <span>{m.details.parameter_size}</span>}
                      {m.details.quantization && <span>{m.details.quantization}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-600">{formatSize(m.size_bytes)}</div>
                  <div className={`text-xs px-2 py-0.5 rounded-full ${
                    m.status === 'ready' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {m.status}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* ── HuggingFace Hub ── */
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search GGUF models (e.g. Qwen3 8B)"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm rounded-lg border border-zinc-700 disabled:opacity-50"
              >
                {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
              </button>
            </div>

            {/* Downloads */}
            {downloads.filter((d) => d.status === 'downloading').length > 0 && (
              <div className="space-y-1.5">
                {downloads.filter((d) => d.status === 'downloading').map((d) => (
                  <div key={d.task_id} className="flex items-center gap-3 px-4 py-2.5 bg-blue-950/30 border border-blue-900/40 rounded-lg text-sm">
                    <Loader2 size={14} className="animate-spin text-blue-400" />
                    <span className="text-zinc-300 truncate flex-1">{d.filename}</span>
                    <span className="text-blue-400 text-xs">{(d.progress * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}

            {/* Results */}
            <div className="space-y-2">
              {searchResults.map((r) => (
                <div key={r.repo_id} className="bg-zinc-900 rounded-xl border border-zinc-800">
                  <button
                    onClick={() => handleExpandRepo(r.repo_id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 rounded-xl"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">{r.repo_id}</div>
                      <div className="text-xs text-zinc-500 mt-0.5 flex gap-3">
                        <span>↓ {formatDownloads(r.downloads)}</span>
                        <span>♥ {r.likes}</span>
                      </div>
                    </div>
                  </button>

                  {expandedRepo === r.repo_id && (
                    <div className="border-t border-zinc-800 px-4 py-2 space-y-1.5">
                      {repoFiles.length === 0 ? (
                        <div className="text-xs text-zinc-500 py-2">Loading files...</div>
                      ) : (
                        repoFiles.map((f) => (
                          <div key={f.filename} className="flex items-center gap-2 py-1.5">
                            <span className="text-xs text-zinc-400 truncate flex-1">{f.filename}</span>
                            <span className="text-xs text-zinc-600 shrink-0">{formatSize(f.size_bytes)}</span>
                            <button
                              onClick={() => handleDownload(r.repo_id, f.filename)}
                              className="p-1 text-zinc-500 hover:text-emerald-400"
                              title="Download"
                            >
                              <Download size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
