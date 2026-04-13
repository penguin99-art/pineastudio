import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, Save, Check } from 'lucide-react';
import { api, type BackendInfo, type ModelInfo } from '../api/client';

const TTS_VOICES_ZH = [
  { value: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao (女, 温暖)' },
  { value: 'zh-CN-YunxiNeural', label: 'Yunxi (男, 年轻)' },
  { value: 'zh-CN-YunjianNeural', label: 'Yunjian (男, 沉稳)' },
  { value: 'zh-CN-XiaoyiNeural', label: 'Xiaoyi (女, 活泼)' },
  { value: 'zh-CN-YunyangNeural', label: 'Yunyang (男, 新闻播报)' },
];

const TTS_VOICES_EN = [
  { value: 'en-US-AriaNeural', label: 'Aria (Female, warm)' },
  { value: 'en-US-GuyNeural', label: 'Guy (Male, casual)' },
  { value: 'en-US-JennyNeural', label: 'Jenny (Female, friendly)' },
  { value: 'en-US-DavisNeural', label: 'Davis (Male, calm)' },
];

export default function Settings() {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [formId, setFormId] = useState('');
  const [formType, setFormType] = useState('ollama');
  const [formUrl, setFormUrl] = useState('http://localhost:11434');
  const [adding, setAdding] = useState(false);
  const [backendError, setBackendError] = useState('');

  // Preferences
  const [prefs, setPrefs] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(() => {
    api.backends().then(setBackends);
    api.models().then((d) => setModels(d.models));
    api.getSettings().then(setPrefs);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!formId.trim() || !formUrl.trim()) return;
    setAdding(true);
    setBackendError('');
    try {
      await api.addBackend({ id: formId, type: formType, base_url: formUrl });
      setShowAdd(false);
      setFormId('');
      refresh();
    } catch (e) {
      setBackendError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm(`移除后端 "${id}"?`)) return;
    await api.removeBackend(id);
    refresh();
  };

  const updatePref = (key: string, value: unknown) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSavePrefs = async () => {
    setSaving(true);
    try {
      const result = await api.updateSettings(prefs);
      setPrefs(result);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Save failed', e);
    } finally {
      setSaving(false);
    }
  };

  const TYPES = [
    { value: 'ollama', label: 'Ollama', defaultUrl: 'http://localhost:11434' },
    { value: 'llama-server', label: 'llama-server', defaultUrl: 'http://localhost:8080' },
    { value: 'openai-compat', label: 'OpenAI Compatible', defaultUrl: 'http://localhost:8080' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-8">
        <h1 className="text-lg font-semibold">设置</h1>

        {/* ── Model Preferences ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-zinc-300 border-b border-zinc-800 pb-2">模型配置</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-500 block mb-1.5">助理模型 (Chat)</label>
              <select
                value={(prefs.assistant_model as string) || ''}
                onChange={(e) => updatePref('assistant_model', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                <option value="">自动 (第一个可用模型)</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
              <p className="text-[10px] text-zinc-600 mt-1">助理主界面使用的模型</p>
            </div>

            <div>
              <label className="text-xs text-zinc-500 block mb-1.5">实时语音模型</label>
              <select
                value={(prefs.realtime_model as string) || ''}
                onChange={(e) => updatePref('realtime_model', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
              <p className="text-[10px] text-zinc-600 mt-1">Realtime 和诞生仪式使用的模型</p>
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1.5">Ollama 地址</label>
            <input
              value={(prefs.ollama_host as string) || ''}
              onChange={(e) => updatePref('ollama_host', e.target.value)}
              className="w-full max-w-md bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
            />
          </div>
        </section>

        {/* ── TTS ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-zinc-300 border-b border-zinc-800 pb-2">语音合成 (TTS)</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-500 block mb-1.5">中文语音</label>
              <select
                value={(prefs.tts_voice_zh as string) || ''}
                onChange={(e) => updatePref('tts_voice_zh', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                {TTS_VOICES_ZH.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-zinc-500 block mb-1.5">英文语音</label>
              <select
                value={(prefs.tts_voice_en as string) || ''}
                onChange={(e) => updatePref('tts_voice_en', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                {TTS_VOICES_EN.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* ── ASR ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-zinc-300 border-b border-zinc-800 pb-2">语音识别 (ASR)</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-500 block mb-1.5">Whisper 模型大小</label>
              <select
                value={(prefs.asr_model as string) || 'base'}
                onChange={(e) => updatePref('asr_model', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                <option value="tiny">tiny (最快, 精度低)</option>
                <option value="base">base (推荐)</option>
                <option value="small">small (更准, 更慢)</option>
                <option value="medium">medium (高精度)</option>
                <option value="large-v3">large-v3 (最准, 最慢)</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-zinc-500 block mb-1.5">语言</label>
              <select
                value={(prefs.asr_language as string) || 'auto'}
                onChange={(e) => updatePref('asr_language', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                <option value="auto">自动检测</option>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
              </select>
            </div>
          </div>
        </section>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            onClick={handleSavePrefs}
            disabled={saving}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm transition-colors ${
              saved
                ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            } disabled:opacity-50`}
          >
            {saved ? <><Check size={14} /> 已保存</> : <><Save size={14} /> {saving ? '保存中…' : '保存设置'}</>}
          </button>
        </div>

        {/* ── Backends ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <h2 className="text-sm font-medium text-zinc-300">推理后端</h2>
            <div className="flex gap-1.5">
              <button onClick={refresh} className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800">
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => setShowAdd(!showAdd)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs rounded-lg border border-zinc-700"
              >
                <Plus size={12} /> 添加后端
              </button>
            </div>
          </div>

          {showAdd && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
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
                  <label className="text-xs text-zinc-500 block mb-1">类型</label>
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
              {backendError && <div className="text-xs text-red-400">{backendError}</div>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300">
                  取消
                </button>
                <button onClick={handleAdd} disabled={adding} className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-sm rounded-lg disabled:opacity-50">
                  {adding ? '添加中…' : '添加'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {backends.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 bg-zinc-900 rounded-xl border border-zinc-800">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${b.healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200">{b.id}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {b.type} · {b.base_url} · {b.model_count} 个模型
                  </div>
                </div>
                <button onClick={() => handleRemove(b.id)} className="p-1.5 text-zinc-600 hover:text-red-400" title="移除">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {backends.length === 0 && (
              <div className="text-zinc-500 text-sm py-6 text-center">
                没有推理后端。点击"添加后端"开始。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
