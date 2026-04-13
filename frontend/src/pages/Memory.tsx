import { useState, useEffect, useCallback } from 'react';
import { Brain, Save, Check, RefreshCw, AlertTriangle, Calendar, BarChart3, FileText } from 'lucide-react';
import { api, fetchJSON } from '../api/client';

type Tab = 'overview' | 'soul' | 'user' | 'memory' | 'daily';

interface DailyEntry {
  date: string;
  size: number;
}

interface FileStats {
  chars: number;
  limit: number | null;
  usage_pct: number | null;
  lines: number;
}

export default function Memory() {
  const [tab, setTab] = useState<Tab>('overview');

  // File contents
  const [soul, setSoul] = useState('');
  const [user, setUser] = useState('');
  const [memory, setMemory] = useState('');

  // Editing
  const [editingSoul, setEditingSoul] = useState('');
  const [editingUser, setEditingUser] = useState('');
  const [editingMemory, setEditingMemory] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Stats
  const [stats, setStats] = useState<Record<string, FileStats | number>>({});

  // Daily
  const [dailyList, setDailyList] = useState<DailyEntry[]>([]);
  const [dailyContent, setDailyContent] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const loadAll = useCallback(() => {
    api.memoryRead('SOUL.md').then((d) => { setSoul(d.content); setEditingSoul(d.content); });
    api.memoryRead('USER.md').then((d) => { setUser(d.content); setEditingUser(d.content); });
    api.memoryRead('MEMORY.md').then((d) => { setMemory(d.content); setEditingMemory(d.content); });
    fetchJSON<Record<string, FileStats | number>>('/api/memory/stats').then(setStats);
    fetchJSON<{ files: DailyEntry[] }>('/api/memory/daily/list').then((d) => setDailyList(d.files));
    setDirty(false);
    setSaved(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSave = useCallback(async (filename: string, content: string) => {
    setSaving(true);
    try {
      await api.memoryWrite(filename, content);
      if (filename === 'SOUL.md') setSoul(content);
      if (filename === 'USER.md') setUser(content);
      if (filename === 'MEMORY.md') setMemory(content);
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2000);
      fetchJSON<Record<string, FileStats | number>>('/api/memory/stats').then(setStats);
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleReinitialize = useCallback(async () => {
    if (!confirm('确认重新初始化？当前记忆将被备份，然后需要重新进行诞生仪式。')) return;
    await api.memoryReinitialize();
    window.location.href = '/';
  }, []);

  const loadDaily = useCallback(async (date: string) => {
    setSelectedDate(date);
    const d = await fetchJSON<{ content: string }>(`/api/memory/daily/${date}`);
    setDailyContent(d.content);
  }, []);

  const soulStats = stats['SOUL.md'] as FileStats | undefined;
  const userStats = stats['USER.md'] as FileStats | undefined;
  const memStats = stats['MEMORY.md'] as FileStats | undefined;
  const dailyCount = (stats['daily_count'] as number) || 0;

  const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'overview', label: '概览', icon: BarChart3 },
    { id: 'soul', label: 'SOUL', icon: Brain },
    { id: 'user', label: 'USER', icon: FileText },
    { id: 'memory', label: 'MEMORY', icon: FileText },
    { id: 'daily', label: '日志', icon: Calendar },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <Brain size={20} className="text-purple-400" />
          <h1 className="text-lg font-semibold">记忆系统</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadAll} className="p-2 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800" title="刷新">
            <RefreshCw size={15} />
          </button>
          <button
            onClick={handleReinitialize}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400/70 hover:text-red-400 rounded-lg hover:bg-red-900/20 border border-transparent hover:border-red-800/30"
          >
            <AlertTriangle size={12} />
            重新初始化
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-3 flex gap-1 border-b border-zinc-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-lg border-b-2 transition-colors ${
              tab === id
                ? 'border-purple-400 text-white bg-zinc-800/50'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* ── Overview ── */}
        {tab === 'overview' && (
          <div className="max-w-2xl space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                title="SOUL.md"
                subtitle="人格定义"
                chars={soulStats?.chars || 0}
                lines={soulStats?.lines || 0}
                color="purple"
                onClick={() => setTab('soul')}
              />
              <StatCard
                title="USER.md"
                subtitle="用户画像"
                chars={userStats?.chars || 0}
                limit={userStats?.limit || undefined}
                usagePct={userStats?.usage_pct || undefined}
                lines={userStats?.lines || 0}
                color="blue"
                onClick={() => setTab('user')}
              />
              <StatCard
                title="MEMORY.md"
                subtitle="长期记忆"
                chars={memStats?.chars || 0}
                limit={memStats?.limit || undefined}
                usagePct={memStats?.usage_pct || undefined}
                lines={memStats?.lines || 0}
                color="green"
                onClick={() => setTab('memory')}
              />
            </div>

            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={14} className="text-zinc-500" />
                <span className="text-sm text-zinc-400">日志</span>
                <span className="text-xs text-zinc-600">{dailyCount} 天</span>
              </div>
              {dailyList.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {dailyList.slice(0, 14).map((d) => (
                    <button
                      key={d.date}
                      onClick={() => { setTab('daily'); loadDaily(d.date); }}
                      className="px-2 py-1 rounded text-[11px] bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                    >
                      {d.date}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-zinc-600">暂无日志记录</div>
              )}
            </div>

            {/* Preview cards */}
            <div className="space-y-3">
              <FilePreview title="SOUL.md" content={soul} color="purple" onClick={() => setTab('soul')} />
              <FilePreview title="USER.md" content={user} color="blue" onClick={() => setTab('user')} />
              <FilePreview title="MEMORY.md" content={memory || '(空)'} color="green" onClick={() => setTab('memory')} />
            </div>
          </div>
        )}

        {/* ── SOUL Editor ── */}
        {tab === 'soul' && (
          <FileEditor
            filename="SOUL.md"
            subtitle="人格定义 — 定义 AI 的性格、说话风格和行为原则"
            content={editingSoul}
            color="purple"
            onChange={(v) => { setEditingSoul(v); setDirty(v !== soul); }}
            onSave={() => handleSave('SOUL.md', editingSoul)}
            saving={saving}
            saved={saved}
            dirty={dirty}
          />
        )}

        {/* ── USER Editor ── */}
        {tab === 'user' && (
          <FileEditor
            filename="USER.md"
            subtitle="用户画像 — AI 对你的了解"
            content={editingUser}
            color="blue"
            limit={1375}
            onChange={(v) => { setEditingUser(v); setDirty(v !== user); }}
            onSave={() => handleSave('USER.md', editingUser)}
            saving={saving}
            saved={saved}
            dirty={dirty}
          />
        )}

        {/* ── MEMORY Editor ── */}
        {tab === 'memory' && (
          <FileEditor
            filename="MEMORY.md"
            subtitle="长期记忆 — AI 在对话中主动记录的信息"
            content={editingMemory}
            color="green"
            limit={2200}
            onChange={(v) => { setEditingMemory(v); setDirty(v !== memory); }}
            onSave={() => handleSave('MEMORY.md', editingMemory)}
            saving={saving}
            saved={saved}
            dirty={dirty}
          />
        )}

        {/* ── Daily ── */}
        {tab === 'daily' && (
          <div className="max-w-2xl">
            <div className="flex gap-4">
              <div className="w-36 shrink-0 space-y-1">
                <div className="text-xs text-zinc-500 mb-2">日志列表</div>
                {dailyList.map((d) => (
                  <button
                    key={d.date}
                    onClick={() => loadDaily(d.date)}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      d.date === selectedDate
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    }`}
                  >
                    {d.date}
                    <span className="text-zinc-600 ml-1">({d.size}B)</span>
                  </button>
                ))}
                {dailyList.length === 0 && (
                  <div className="text-xs text-zinc-600 py-4 text-center">暂无日志</div>
                )}
              </div>
              <div className="flex-1">
                {selectedDate ? (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="text-sm text-zinc-400 mb-3">{selectedDate}</div>
                    <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-sans leading-relaxed">
                      {dailyContent || '(空)'}
                    </pre>
                  </div>
                ) : (
                  <div className="text-sm text-zinc-600 py-8 text-center">选择一个日期查看日志</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function StatCard({ title, subtitle, chars, limit, usagePct, lines, color, onClick }: {
  title: string;
  subtitle: string;
  chars: number;
  limit?: number;
  usagePct?: number;
  lines: number;
  color: string;
  onClick: () => void;
}) {
  const borderColors: Record<string, string> = {
    purple: 'border-purple-800/40 hover:border-purple-700/60',
    blue: 'border-blue-800/40 hover:border-blue-700/60',
    green: 'border-green-800/40 hover:border-green-700/60',
  };

  return (
    <button
      onClick={onClick}
      className={`text-left bg-zinc-900 rounded-xl border p-4 transition-colors ${borderColors[color]}`}
    >
      <div className="text-xs font-mono text-zinc-500">{title}</div>
      <div className="text-[10px] text-zinc-600 mb-3">{subtitle}</div>
      <div className="text-2xl font-light text-zinc-200">{chars}</div>
      <div className="text-[10px] text-zinc-600 mt-1">
        {lines} 行
        {limit && <> · {usagePct}% 已用</>}
      </div>
      {limit && usagePct !== undefined && (
        <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              usagePct > 80 ? 'bg-red-500' : usagePct > 50 ? 'bg-yellow-500' : 'bg-green-500'
            }`}
            style={{ width: `${Math.min(usagePct, 100)}%` }}
          />
        </div>
      )}
    </button>
  );
}

function FilePreview({ title, content, color, onClick }: {
  title: string;
  content: string;
  color: string;
  onClick: () => void;
}) {
  const borderColors: Record<string, string> = {
    purple: 'border-purple-800/30',
    blue: 'border-blue-800/30',
    green: 'border-green-800/30',
  };

  const preview = content.slice(0, 300) + (content.length > 300 ? '…' : '');

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-zinc-900/50 rounded-xl border p-4 transition-colors hover:bg-zinc-900 ${borderColors[color]}`}
    >
      <div className="text-xs font-mono text-zinc-500 mb-2">{title}</div>
      <pre className="text-xs text-zinc-500 whitespace-pre-wrap font-sans leading-relaxed line-clamp-4">
        {preview}
      </pre>
    </button>
  );
}

function FileEditor({ filename, subtitle, content, color, limit, onChange, onSave, saving, saved, dirty }: {
  filename: string;
  subtitle: string;
  content: string;
  color: string;
  limit?: number;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  dirty: boolean;
}) {
  const borderColors: Record<string, string> = {
    purple: 'border-purple-800/40 focus-within:border-purple-600/60',
    blue: 'border-blue-800/40 focus-within:border-blue-600/60',
    green: 'border-green-800/40 focus-within:border-green-600/60',
  };
  const overLimit = limit ? content.length > limit : false;

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-mono text-zinc-300">{filename}</span>
          <span className="text-xs text-zinc-600 ml-2">{subtitle}</span>
        </div>
        <div className="flex items-center gap-3">
          {limit && (
            <span className={`text-xs ${overLimit ? 'text-red-400' : 'text-zinc-600'}`}>
              {content.length} / {limit}
            </span>
          )}
          <button
            onClick={onSave}
            disabled={saving || !dirty || overLimit}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm transition-colors ${
              saved
                ? 'bg-green-600/20 text-green-400'
                : dirty
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-zinc-800 text-zinc-500'
            } disabled:opacity-40`}
          >
            {saved ? <><Check size={14} /> 已保存</> : <><Save size={14} /> 保存</>}
          </button>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full h-[60vh] bg-zinc-900 border rounded-xl px-4 py-3 text-sm text-zinc-300 font-mono leading-relaxed resize-none focus:outline-none ${borderColors[color]}`}
      />
    </div>
  );
}
