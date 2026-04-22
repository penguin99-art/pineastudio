import { useState, useEffect, useRef } from 'react';
import {
  Film, Wand2, Loader2, Trash2, Download, Play,
  Sparkles, Settings2, X, RefreshCw,
} from 'lucide-react';
import { api, type VideoModel, type VideoJob } from '../api/client';

const PROMPT_PRESETS = [
  {
    label: '雪豹·喜马拉雅',
    prompt:
      'A majestic snow leopard walking gracefully across a moonlit Himalayan ridge, fur shimmering in soft blue light, slow cinematic camera follow, ultra detailed, 8k.',
  },
  {
    label: '湖光·日出',
    prompt:
      'A breathtaking aerial shot of a serene mountain lake at sunrise, golden light reflecting on still water, mist gently rising from the surface, cinematic, ultra high quality.',
  },
  {
    label: '赛博朋克·街头',
    prompt:
      'A neon-lit cyberpunk Tokyo street at night, rain falling, holographic billboards, a lone figure with an umbrella walking past, cinematic shallow depth of field.',
  },
  {
    label: '宇宙·星云',
    prompt:
      'A slow camera fly-through of a colorful nebula in deep space, stars twinkling, dust clouds rolling, NASA-style cinematic.',
  },
];

const NEG_DEFAULT = 'blurry, low quality, distorted, watermark, text, oversaturated, deformed';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

function fmtRel(ts: number | null): string {
  if (!ts) return '-';
  const diff = (Date.now() / 1000) - ts;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleString();
}

export default function Video() {
  const [models, setModels] = useState<VideoModel[]>([]);
  const [loadedModels, setLoadedModels] = useState<string[]>([]);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0].prompt);
  const [negativePrompt, setNegativePrompt] = useState(NEG_DEFAULT);
  const [width, setWidth] = useState(832);
  const [height, setHeight] = useState(480);
  const [numFrames, setNumFrames] = useState(25);
  const [steps, setSteps] = useState(25);
  const [guidance, setGuidance] = useState(5);
  const [fps, setFps] = useState(16);
  const [seed, setSeed] = useState<number>(-1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedJob, setSelectedJob] = useState<VideoJob | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadModels = async () => {
    try {
      const r = await api.videoModels();
      setModels(r.models);
      setLoadedModels(r.loaded);
      if (!selectedModel && r.models.length > 0) {
        const first = r.models[0];
        setSelectedModel(first.id);
        applyDefaults(first);
      }
    } catch (e) {
      setError(`加载模型失败：${e}`);
    }
  };

  const loadJobs = async () => {
    try {
      const r = await api.videoJobs();
      setJobs(r.jobs);
    } catch {/* ignore */}
  };

  const applyDefaults = (m: VideoModel) => {
    setWidth(m.default_size[0]);
    setHeight(m.default_size[1]);
    setNumFrames(m.default_frames);
    setSteps(m.default_steps);
    setFps(m.default_fps);
    setGuidance(m.default_guidance);
  };

  useEffect(() => {
    loadModels();
    loadJobs();
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
      }
    };
  }, []);

  // Poll while there's an active job
  useEffect(() => {
    const hasActive = jobs.some(
      (j) => j.status === 'queued' || j.status === 'loading' || j.status === 'running'
    );
    if (hasActive && pollRef.current === null) {
      pollRef.current = window.setInterval(() => {
        loadJobs();
        loadModels();
      }, 2000);
    } else if (!hasActive && pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [jobs]);

  const handleModelChange = (id: string) => {
    setSelectedModel(id);
    const m = models.find((x) => x.id === id);
    if (m) applyDefaults(m);
  };

  const handleSubmit = async () => {
    if (!selectedModel || !prompt.trim()) {
      setError('请选择模型并填写 prompt');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const job = await api.videoGenerate({
        model_id: selectedModel,
        prompt,
        negative_prompt: negativePrompt,
        width,
        height,
        num_frames: numFrames,
        num_inference_steps: steps,
        guidance_scale: guidance,
        fps,
        seed,
      });
      setJobs((prev) => [job, ...prev]);
    } catch (e) {
      setError(`提交失败：${e}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.videoDelete(id);
    if (selectedJob?.id === id) setSelectedJob(null);
    loadJobs();
  };

  const handleCancel = async (id: string) => {
    await api.videoCancel(id);
    loadJobs();
  };

  const currentModel = models.find((m) => m.id === selectedModel);

  // Estimated time
  const estSeconds = (() => {
    if (!currentModel) return null;
    // Very rough: ~0.13s per (frames * step / 25) for 1.3B at 480p, ~5x for 14B
    const sizeFactor = (width * height) / (832 * 480);
    const frameFactor = numFrames / 25;
    const stepFactor = steps / 25;
    const modelFactor = currentModel.params_b > 5 ? 8 : 1;
    return Math.round(72 * sizeFactor * frameFactor * stepFactor * modelFactor);
  })();

  return (
    <div className="flex h-full">
      {/* Left: input panel */}
      <div className="w-[420px] shrink-0 border-r border-zinc-800 overflow-y-auto p-5 space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Film size={20} className="text-pink-400" />
          视频生成
        </div>

        {/* Model selector */}
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">模型</label>
          {models.length === 0 ? (
            <div className="text-xs text-zinc-500 bg-zinc-900 rounded px-3 py-2">
              未发现本地视频模型。请先下载（如 Wan 2.1 / Wan 2.2 / LTX-Video）到 ~/.cache/modelscope。
            </div>
          ) : (
            <div className="space-y-1.5">
              {models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleModelChange(m.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm border transition-colors ${
                    selectedModel === m.id
                      ? 'border-pink-500/60 bg-pink-500/10'
                      : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{m.name}</span>
                    {loadedModels.includes(m.id) && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                        已加载
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {m.params_b}B 参数 · {m.size_gb} GB · 默认 {m.default_size[0]}×{m.default_size[1]}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Prompt */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-zinc-500">Prompt</label>
            <div className="flex gap-1">
              {PROMPT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setPrompt(p.prompt)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-pink-500/60"
            placeholder="A majestic snow leopard walking..."
          />
        </div>

        {/* Quick params row */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-zinc-500">宽度</label>
            <input type="number" value={width} step={16} onChange={(e) => setWidth(+e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">高度</label>
            <input type="number" value={height} step={16} onChange={(e) => setHeight(+e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">帧数</label>
            <input type="number" value={numFrames} onChange={(e) => setNumFrames(+e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">采样步数</label>
            <input type="number" value={steps} onChange={(e) => setSteps(+e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">FPS</label>
            <input type="number" value={fps} onChange={(e) => setFps(+e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">CFG</label>
            <input type="number" value={guidance} step={0.5} onChange={(e) => setGuidance(+e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>

        <div>
          <button onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1">
            <Settings2 size={12} />
            {showAdvanced ? '收起高级' : '高级'}
          </button>
        </div>

        {showAdvanced && (
          <div className="space-y-3 pl-2 border-l border-zinc-800">
            <div>
              <label className="text-xs text-zinc-500">Negative Prompt</label>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={2}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Seed (-1 随机)</label>
              <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm" />
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
            {error}
          </div>
        )}

        {estSeconds !== null && (
          <div className="text-xs text-zinc-500">
            预计耗时：约 {fmtDuration(estSeconds)}（首次加载额外 +5–60s）
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || !selectedModel}
          className="w-full bg-pink-600 hover:bg-pink-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white py-2.5 rounded font-medium flex items-center justify-center gap-2 transition-colors"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
          {submitting ? '提交中…' : '生成视频'}
        </button>

        <div className="text-xs text-zinc-600 leading-relaxed">
          模型在首个任务时会加载到 GPU（5-30 秒），之后保持驻留。Wan 1.3B 在 GB10 上 480p×25帧 约需 70 秒，
          81 帧（5秒视频）约 9–10 分钟。
        </div>
      </div>

      {/* Right: jobs + preview */}
      <div className="flex-1 flex flex-col">
        <div className="border-b border-zinc-800 px-5 py-3 flex items-center justify-between">
          <div className="text-sm text-zinc-400">任务（{jobs.length}）</div>
          <button onClick={() => { loadJobs(); loadModels(); }}
            className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1">
            <RefreshCw size={12} /> 刷新
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-80 border-r border-zinc-800 overflow-y-auto">
            {jobs.length === 0 ? (
              <div className="p-6 text-sm text-zinc-500 text-center">
                <Sparkles size={24} className="mx-auto mb-2 opacity-50" />
                还没有视频。
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {jobs.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => setSelectedJob(j)}
                    className={`w-full text-left p-3 hover:bg-zinc-900 ${
                      selectedJob?.id === j.id ? 'bg-zinc-900' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={j.status} />
                      <span className="text-xs text-zinc-500 truncate">
                        {j.model_id}
                      </span>
                    </div>
                    <div className="text-sm line-clamp-2 mb-1">{j.prompt}</div>
                    <div className="text-xs text-zinc-500">
                      {j.width}×{j.height} · {j.num_frames}f · {fmtRel(j.created_at)}
                    </div>
                    {(j.status === 'running' || j.status === 'loading') && (
                      <div className="mt-1.5">
                        <div className="h-1 bg-zinc-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-pink-500 transition-all"
                            style={{ width: `${j.progress * 100}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          {j.status === 'loading'
                            ? '加载模型…'
                            : `${j.progress_step}/${j.progress_total} 步`}
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {selectedJob ? (
              <JobDetail
                job={selectedJob}
                onDelete={handleDelete}
                onCancel={handleCancel}
              />
            ) : (
              <div className="text-zinc-500 text-sm text-center mt-20">
                选择一个任务查看详情。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: VideoJob['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    queued: { label: '排队', cls: 'bg-zinc-700 text-zinc-300' },
    loading: { label: '加载中', cls: 'bg-blue-500/20 text-blue-400' },
    running: { label: '生成中', cls: 'bg-pink-500/20 text-pink-400' },
    done: { label: '完成', cls: 'bg-emerald-500/20 text-emerald-400' },
    error: { label: '错误', cls: 'bg-red-500/20 text-red-400' },
  };
  const { label, cls } = map[status] || { label: status, cls: 'bg-zinc-700' };
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  );
}

function JobDetail({
  job, onDelete, onCancel,
}: {
  job: VideoJob;
  onDelete: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <StatusBadge status={job.status} />
        <span className="text-xs text-zinc-500">{job.id}</span>
        <div className="flex-1" />
        {(job.status === 'queued') && (
          <button
            onClick={() => onCancel(job.id)}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800 flex items-center gap-1"
          >
            <X size={12} /> 取消
          </button>
        )}
        <button
          onClick={() => onDelete(job.id)}
          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 flex items-center gap-1"
        >
          <Trash2 size={12} /> 删除
        </button>
      </div>

      {job.status === 'done' && job.output_path && (
        <div className="rounded-lg overflow-hidden border border-zinc-800 bg-black">
          <video
            src={api.videoFileUrl(job.id)}
            controls
            autoPlay
            loop
            className="w-full max-h-[60vh]"
          />
          <div className="px-3 py-2 flex items-center justify-between text-xs text-zinc-500 bg-zinc-900">
            <span>{fmtBytes(job.output_size)}</span>
            <a href={api.videoFileUrl(job.id)} download
              className="text-pink-400 hover:text-pink-300 flex items-center gap-1">
              <Download size={12} /> 下载 MP4
            </a>
          </div>
        </div>
      )}

      {job.status === 'error' && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
          <div className="font-semibold mb-1">生成失败</div>
          <div className="text-xs text-red-300/80 whitespace-pre-wrap">{job.error}</div>
        </div>
      )}

      {(job.status === 'running' || job.status === 'loading' || job.status === 'queued') && (
        <div className="rounded-lg border border-zinc-800 p-4 bg-zinc-900/50">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={14} className="animate-spin text-pink-400" />
            <span className="text-sm">
              {job.status === 'queued' ? '排队中…' :
                job.status === 'loading' ? '正在加载模型权重到 GPU…' :
                  `生成中：${job.progress_step}/${job.progress_total} 步`}
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded overflow-hidden">
            <div className="h-full bg-pink-500 transition-all"
              style={{ width: `${job.progress * 100}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Field label="模型">{job.model_id}</Field>
        <Field label="尺寸">{job.width} × {job.height}</Field>
        <Field label="帧数 / FPS">{job.num_frames}f @ {job.fps} ({(job.num_frames / job.fps).toFixed(1)}s)</Field>
        <Field label="采样步数">{job.num_inference_steps}</Field>
        <Field label="CFG">{job.guidance_scale}</Field>
        <Field label="Seed">{job.seed}</Field>
        {job.elapsed_load_s !== null && (
          <Field label="加载耗时">{fmtDuration(job.elapsed_load_s)}</Field>
        )}
        {job.elapsed_gen_s !== null && (
          <Field label="生成耗时">{fmtDuration(job.elapsed_gen_s)}</Field>
        )}
      </div>

      <div>
        <div className="text-xs text-zinc-500 mb-1">Prompt</div>
        <div className="text-sm bg-zinc-900 border border-zinc-800 rounded p-3">{job.prompt}</div>
      </div>

      {job.negative_prompt && (
        <div>
          <div className="text-xs text-zinc-500 mb-1">Negative Prompt</div>
          <div className="text-sm bg-zinc-900 border border-zinc-800 rounded p-3 text-zinc-400">
            {job.negative_prompt}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div>{children}</div>
    </div>
  );
}

// re-export for unused imports
void Play;
