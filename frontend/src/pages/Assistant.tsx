import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Send, Plus, Trash2 } from 'lucide-react';
import OrbVisualizer from '../components/OrbVisualizer';
import { api, streamChat, type Conversation, type SavedMessage } from '../api/client';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function float32ToWavBase64(samples: Float32Array): string {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export default function Assistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [orbState, setOrbState] = useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle');
  const [soulName, setSoulName] = useState('Pine');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState('');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [error, setError] = useState('');
  const [voiceActive, setVoiceActive] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Voice mode refs
  const orbStateRef = useRef(orbState);
  const wsRef = useRef<WebSocket | null>(null);
  const vadRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamSampleRateRef = useRef(24000);
  const streamNextTimeRef = useRef(0);
  const streamSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const speakingStartedRef = useRef(0);
  const ignoreAudioRef = useRef(false);
  const assistantBufRef = useRef('');
  const BARGE_IN_GRACE_MS = 1200;

  const setOrbStateBoth = useCallback((s: typeof orbState) => {
    orbStateRef.current = s;
    setOrbState(s);
  }, []);

  useEffect(() => {
    api.memoryRead('SOUL.md').then((data) => {
      const match = data.content.match(/^#\s*(\S+)/m);
      if (match) setSoulName(match[1]);
    }).catch(() => {});

    api.conversations().then(setConversations).catch(() => {});

    Promise.all([api.models(), api.getSettings()])
      .then(([modelsData, settings]) => {
        const preferredModel = settings.assistant_model as string;
        const availableModels = modelsData.models;
        if (preferredModel && availableModels.some((m) => m.id === preferredModel)) {
          setDefaultModel(preferredModel);
        } else if (availableModels.length > 0) {
          setDefaultModel(availableModels[0].id);
        }
        setModelsLoaded(true);
      })
      .catch(() => {
        api.models().then((data) => {
          if (data.models.length > 0) setDefaultModel(data.models[0].id);
          setModelsLoaded(true);
        }).catch(() => setModelsLoaded(true));
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Audio helpers ──
  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
  }, []);

  const stopPlayback = useCallback(() => {
    for (const src of streamSourcesRef.current) { try { src.stop(); } catch {} }
    streamSourcesRef.current = [];
    streamNextTimeRef.current = 0;
  }, []);

  const startStreamPlayback = useCallback((sampleRate: number) => {
    stopPlayback();
    ensureAudioCtx();
    streamSampleRateRef.current = sampleRate || 24000;
    streamNextTimeRef.current = audioCtxRef.current!.currentTime + 0.05;
    speakingStartedRef.current = Date.now();
    setOrbStateBoth('speaking');
  }, [stopPlayback, ensureAudioCtx, setOrbStateBoth]);

  const queueAudioChunk = useCallback((base64Pcm: string) => {
    ensureAudioCtx();
    const ctx = audioCtxRef.current!;
    const bin = atob(base64Pcm);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer as ArrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const audioBuffer = ctx.createBuffer(1, float32.length, streamSampleRateRef.current);
    audioBuffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const startAt = Math.max(streamNextTimeRef.current, ctx.currentTime);
    source.start(startAt);
    streamNextTimeRef.current = startAt + audioBuffer.duration;
    streamSourcesRef.current.push(source);

    source.onended = () => {
      const idx = streamSourcesRef.current.indexOf(source);
      if (idx !== -1) streamSourcesRef.current.splice(idx, 1);
      if (streamSourcesRef.current.length === 0 && orbStateRef.current === 'speaking') {
        setOrbStateBoth('listening');
      }
    };
  }, [ensureAudioCtx, setOrbStateBoth]);

  // ── VAD handlers ──
  const handleSpeechStart = useCallback(() => {
    if (orbStateRef.current === 'speaking') {
      if (Date.now() - speakingStartedRef.current < BARGE_IN_GRACE_MS) return;
      stopPlayback();
      ignoreAudioRef.current = true;
      wsRef.current?.send(JSON.stringify({ type: 'interrupt' }));
      setOrbStateBoth('listening');
    }
  }, [stopPlayback, setOrbStateBoth]);

  const handleSpeechEnd = useCallback((audio: Float32Array) => {
    if (orbStateRef.current !== 'listening') return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (audio.length < 4800) return;

    const wavB64 = float32ToWavBase64(audio);
    setMessages(prev => [...prev, { role: 'user', content: '…' }]);
    ws.send(JSON.stringify({ audio: wavB64 }));
    setOrbStateBoth('thinking');
    assistantBufRef.current = '';
  }, [setOrbStateBoth]);

  // ── WS message handler ──
  const handleWsMessage = useCallback((event: MessageEvent) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'ready' || msg.type === 'pong') return;

    if (msg.type === 'status') {
      if (msg.phase === 'transcribing' || msg.phase === 'thinking') setOrbStateBoth('thinking');
      return;
    }

    if (msg.type === 'text') {
      if (msg.transcription) {
        setMessages(prev => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'user') { copy[i] = { ...copy[i], content: msg.transcription }; break; }
          }
          return copy;
        });
      }
      if (msg.text && msg.llm_time !== undefined) {
        setMessages(prev => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], content: msg.text }; break; }
          }
          return copy;
        });
        assistantBufRef.current = '';
      }
      return;
    }

    if (msg.type === 'assistant_token') {
      assistantBufRef.current += msg.text;
      const text = assistantBufRef.current;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && (last.content === '…' || last.content === assistantBufRef.current.slice(0, -msg.text.length))) {
          const copy = [...prev];
          copy[copy.length - 1] = { ...last, content: text };
          return copy;
        }
        if (!last || last.role !== 'assistant') return [...prev, { role: 'assistant', content: text }];
        const copy = [...prev];
        copy[copy.length - 1] = { ...last, content: text };
        return copy;
      });
      return;
    }

    if (msg.type === 'audio_start') {
      if (ignoreAudioRef.current) return;
      startStreamPlayback(msg.sample_rate);
      return;
    }
    if (msg.type === 'audio_chunk') {
      if (ignoreAudioRef.current) return;
      queueAudioChunk(msg.audio);
      return;
    }
    if (msg.type === 'audio_end') {
      if (ignoreAudioRef.current) {
        ignoreAudioRef.current = false;
        stopPlayback();
        setOrbStateBoth('listening');
      }
      return;
    }
    if (msg.type === 'error') {
      setError(msg.message);
      setOrbStateBoth('listening');
    }
  }, [setOrbStateBoth, startStreamPlayback, queueAudioChunk, stopPlayback]);

  // ── Toggle voice mode ──
  const toggleVoice = useCallback(async () => {
    if (voiceActive) {
      // Stop voice
      stopPlayback();
      if (vadRef.current) { try { vadRef.current.destroy(); } catch {} vadRef.current = null; }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null; }
      setVoiceActive(false);
      setOrbStateBoth('idle');
      return;
    }

    // Start voice
    ensureAudioCtx();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;
    } catch {
      setError('无法访问麦克风');
      return;
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/realtime`);
    wsRef.current = ws;

    ws.onopen = () => {
      setVoiceActive(true);
      setOrbStateBoth('listening');
    };
    ws.onmessage = handleWsMessage;
    ws.onclose = () => {
      wsRef.current = null;
      setVoiceActive(false);
      setOrbStateBoth('idle');
    };

    try {
      const vad = (window as any).vad;
      if (vad?.MicVAD) {
        const myVad = await vad.MicVAD.new({
          stream: mediaStreamRef.current!,
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.25,
          redemptionMs: 600,
          minSpeechMs: 300,
          preSpeechPadMs: 300,
          onSpeechStart: handleSpeechStart,
          onSpeechEnd: handleSpeechEnd,
          onVADMisfire: () => {},
          onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
          baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
        });
        myVad.start();
        vadRef.current = myVad;
      }
    } catch (err) {
      console.error('VAD init failed:', err);
    }
  }, [voiceActive, ensureAudioCtx, handleWsMessage, handleSpeechStart, handleSpeechEnd, stopPlayback, setOrbStateBoth]);

  // Cleanup on unmount
  useEffect(() => () => {
    stopPlayback();
    if (vadRef.current) { try { vadRef.current.destroy(); } catch {} }
    if (wsRef.current) wsRef.current.close();
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
  }, [stopPlayback]);

  // ── Text send (also works in voice mode via WS) ──
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError('');

    // If voice mode is on, send via WebSocket
    if (voiceActive && wsRef.current?.readyState === WebSocket.OPEN) {
      setMessages(prev => [...prev, { role: 'user', content: text }]);
      wsRef.current.send(JSON.stringify({ type: 'text_input', text }));
      setOrbStateBoth('thinking');
      assistantBufRef.current = '';
      return;
    }

    if (!defaultModel) {
      setError('没有可用的模型，请在工作台中检查模型状态');
      return;
    }

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setStreaming(true);
    setOrbStateBoth('thinking');

    let convId = activeConvId;
    if (!convId) {
      try {
        const conv = await api.createConversation(text.slice(0, 50), defaultModel);
        convId = conv.id;
        setActiveConvId(convId);
        setConversations(prev => [{ ...conv, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...prev]);
      } catch {}
    }
    if (convId) api.addMessage(convId, 'user', text).catch(() => {});

    let assistantText = '';
    setMessages([...newMessages, { role: 'assistant', content: '' }]);

    try {
      for await (const chunk of streamChat(defaultModel, newMessages.map(m => ({ role: m.role, content: m.content })))) {
        assistantText += chunk.content;
        setMessages([...newMessages, { role: 'assistant', content: assistantText }]);
        setOrbStateBoth('speaking');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!assistantText) setError(`对话出错: ${errMsg}`);
      setMessages([...newMessages, ...(assistantText ? [{ role: 'assistant' as const, content: assistantText }] : [])]);
    }

    if (convId && assistantText) api.addMessage(convId, 'assistant', assistantText).catch(() => {});
    setStreaming(false);
    setOrbStateBoth('idle');
  }, [input, messages, streaming, activeConvId, defaultModel, voiceActive, setOrbStateBoth]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Conversation management ──
  const loadConversation = useCallback(async (id: string) => {
    try {
      const detail = await api.getConversation(id);
      setActiveConvId(id);
      setMessages(detail.messages.map((m: SavedMessage) => ({ role: m.role as 'user' | 'assistant', content: m.content })));
    } catch {}
  }, []);

  const startNewConversation = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
    setError('');
  }, []);

  const deleteConversation = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch {}
  }, [activeConvId]);

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      <div className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-900/30 flex flex-col">
        <div className="p-3 border-b border-zinc-800">
          <button
            onClick={startNewConversation}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Plus size={14} />
            新对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => loadConversation(conv.id)}
              className={`group flex items-center gap-1 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                conv.id === activeConvId
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              <span className="flex-1 truncate">{conv.title || '未命名对话'}</span>
              <button
                onClick={(e) => deleteConversation(conv.id, e)}
                className="hidden group-hover:block p-0.5 text-zinc-600 hover:text-red-400 shrink-0"
                title="删除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Status bar */}
        {modelsLoaded && defaultModel && (
          <div className="px-4 py-1.5 border-b border-zinc-800/50 flex items-center gap-2 text-[11px] text-zinc-600">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500/60" />
            {defaultModel}
            {voiceActive && (
              <span className="ml-auto flex items-center gap-1 text-green-400/70">
                <Mic size={10} />
                语音模式
              </span>
            )}
          </div>
        )}

        {/* Welcome */}
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-zinc-400">
            <OrbVisualizer state={orbState} size={120} />
            <div className="text-lg font-medium text-zinc-300">{soulName}</div>
            <div className="text-sm">有什么我可以帮你的？</div>
            {voiceActive && <div className="text-xs text-green-400/60">直接说话即可</div>}
            {!modelsLoaded && <div className="text-xs text-zinc-600">正在加载模型…</div>}
            {modelsLoaded && !defaultModel && <div className="text-xs text-red-400/70">没有检测到可用模型</div>}
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-blue-600/20 text-zinc-200 rounded-br-md'
                    : 'bg-zinc-800 text-zinc-300 rounded-bl-md'
                }`}>
                  {msg.content || (streaming && msg.role === 'assistant' ? '…' : '')}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Orb when chatting */}
        {messages.length > 0 && orbState !== 'idle' && (
          <div className="flex justify-center py-2">
            <OrbVisualizer state={orbState} size={48} />
          </div>
        )}

        {error && (
          <div className="mx-4 mb-2 px-4 py-2 rounded-lg bg-red-900/20 border border-red-800/30 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-zinc-800 p-4">
          <div className="flex items-end gap-2 max-w-3xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={voiceActive ? '说话或输入文字…' : (defaultModel ? '输入消息…' : '等待模型加载…')}
              disabled={!defaultModel && !voiceActive}
              rows={1}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-500 disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              className="p-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={16} />
            </button>
            <button
              onClick={toggleVoice}
              className={`p-3 rounded-xl transition-colors ${
                voiceActive
                  ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-600/30'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
              title={voiceActive ? '关闭语音' : '开启语音'}
            >
              {voiceActive ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
