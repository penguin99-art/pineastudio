const BASE = '';

export async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface BackendInfo {
  id: string;
  type: string;
  kind: string;
  base_url: string;
  healthy: boolean;
  model_count: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  backend_id: string;
  backend_type: string;
  size_bytes: number | null;
  status: string;
  details: Record<string, string>;
}

export interface SystemInfo {
  cpu_count: number;
  memory_total_mb: number;
  memory_used_mb: number;
  disk_total_gb: number;
  disk_free_gb: number;
  gpus: GpuInfo[];
}

export interface GpuInfo {
  index: number;
  name: string;
  memory_total_mb: number;
  memory_used_mb: number;
  memory_free_mb: number;
  utilization_pct: number;
}

export interface HubSearchResult {
  repo_id: string;
  author: string;
  downloads: number;
  likes: number;
  tags: string[];
}

export interface DownloadTask {
  task_id: string;
  repo_id: string;
  filename: string;
  status: string;
  progress: number;
  error: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: SavedMessage[];
}

export interface SavedMessage {
  id: number;
  role: string;
  content: string;
  reasoning: string;
  model: string;
  created_at: string;
}

export interface VideoModel {
  id: string;
  name: string;
  pipeline: string;
  params_b: number;
  vram_gb_min: number;
  default_steps: number;
  default_frames: number;
  default_size: [number, number];
  default_fps: number;
  default_guidance: number;
  path: string;
  size_gb: number;
  loaded: boolean;
}

export interface VideoJob {
  id: string;
  model_id: string;
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  num_frames: number;
  num_inference_steps: number;
  guidance_scale: number;
  fps: number;
  seed: number;
  status: 'queued' | 'loading' | 'running' | 'done' | 'error';
  progress: number;
  progress_step: number;
  progress_total: number;
  output_path: string | null;
  output_size: number;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  elapsed_load_s: number | null;
  elapsed_gen_s: number | null;
}

export interface VideoGenerateRequest {
  model_id: string;
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  num_frames?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
  fps?: number;
  seed?: number;
}

export interface MemoryStatus {
  initialized: boolean;
  files: Record<string, { exists: boolean; size: number; modified: number | null }>;
}

export interface MemoryFile {
  filename: string;
  content: string;
  exists: boolean;
  size: number;
}

export const api = {
  memoryStatus: () => fetchJSON<MemoryStatus>('/api/memory/status'),
  memoryRead: (filename: string) => fetchJSON<MemoryFile>(`/api/memory/file/${filename}`),
  memoryWrite: (filename: string, content: string) =>
    fetchJSON<{ ok: boolean }>(`/api/memory/file/${filename}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  memoryReinitialize: () =>
    fetchJSON<{ ok: boolean }>('/api/memory/reinitialize', { method: 'POST' }),
  setupFinalize: (messages: { role: string; content: string }[], model = '') =>
    fetchJSON<{ ok: boolean; soul_size: number; user_size: number }>('/api/setup/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model }),
    }),

  getSettings: () => fetchJSON<Record<string, unknown>>('/api/settings'),
  updateSettings: (changes: Record<string, unknown>) =>
    fetchJSON<Record<string, unknown>>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    }),

  backends: () => fetchJSON<BackendInfo[]>('/api/backends'),
  addBackend: (body: { id: string; type: string; base_url: string }) =>
    fetchJSON<BackendInfo>('/api/backends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  removeBackend: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/backends/${id}`, { method: 'DELETE' }),

  models: () => fetchJSON<{ models: ModelInfo[] }>('/api/models'),

  system: () => fetchJSON<SystemInfo>('/api/system/info'),

  hubSearch: (q: string) => fetchJSON<HubSearchResult[]>(`/api/hub/search?q=${encodeURIComponent(q)}`),
  hubDownload: (repo_id: string, filename: string) =>
    fetchJSON<DownloadTask>('/api/hub/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_id, filename }),
    }),
  hubDownloads: () => fetchJSON<DownloadTask[]>('/api/hub/downloads'),

  conversations: () => fetchJSON<Conversation[]>('/api/conversations'),
  createConversation: (title: string, model: string) =>
    fetchJSON<{ id: string; title: string; model: string }>('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, model }),
    }),
  getConversation: (id: string) =>
    fetchJSON<ConversationDetail>(`/api/conversations/${id}`),
  updateConversation: (id: string, fields: { title?: string; model?: string }) =>
    fetchJSON<{ ok: boolean }>(`/api/conversations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    }),
  deleteConversation: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),
  addMessage: (convId: string, role: string, content: string, reasoning = '', model = '') =>
    fetchJSON<{ id: number }>(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content, reasoning, model }),
    }),
  summarizeConversation: (convId: string) =>
    fetchJSON<{ ok: boolean }>(`/api/conversations/${convId}/summarize`, { method: 'POST' }),

  videoModels: () =>
    fetchJSON<{ models: VideoModel[]; loaded: string[] }>('/api/video/models'),
  videoGenerate: (body: VideoGenerateRequest) =>
    fetchJSON<VideoJob>('/api/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  videoJobs: () => fetchJSON<{ jobs: VideoJob[] }>('/api/video/jobs'),
  videoJob: (id: string) => fetchJSON<VideoJob>(`/api/video/jobs/${id}`),
  videoDelete: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/video/jobs/${id}`, { method: 'DELETE' }),
  videoCancel: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/video/jobs/${id}/cancel`, { method: 'POST' }),
  videoUnload: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/video/unload/${id}`, { method: 'POST' }),
  videoFileUrl: (id: string) => `/api/video/jobs/${id}/file`,
};

export interface ChatChunk {
  content: string;
  reasoning: string;
}

export async function* streamChat(
  model: string,
  messages: { role: string; content: string }[],
  params: { temperature?: number; max_tokens?: number; thinking?: boolean } = {},
): AsyncGenerator<ChatChunk> {
  const { thinking, ...rest } = params;
  const body: Record<string, unknown> = { model, messages, stream: true, ...rest };
  if (thinking !== undefined) {
    body.think = thinking;
  }
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        const content = delta?.content || '';
        const reasoning = delta?.reasoning || delta?.reasoning_content || '';
        if (content || reasoning) yield { content, reasoning };
      } catch { /* skip */ }
    }
  }
}
