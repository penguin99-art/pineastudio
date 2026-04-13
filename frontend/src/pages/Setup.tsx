import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Send, Keyboard } from 'lucide-react';
import OrbVisualizer from '../components/OrbVisualizer';
import { api } from '../api/client';

type Phase = 'welcome' | 'conversation' | 'finalizing' | 'done';
type OrbStatus = 'idle' | 'listening' | 'speaking' | 'thinking';

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

export default function Setup() {
  const [phase, setPhase] = useState<Phase>('welcome');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [orbState, setOrbState] = useState<OrbStatus>('idle');
  const [showTextInput, setShowTextInput] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // WebSocket + audio refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamSampleRateRef = useRef(24000);
  const streamNextTimeRef = useRef(0);
  const streamSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // VAD + mic refs
  const vadRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speakingStartedRef = useRef(0);
  const BARGE_IN_GRACE_MS = 1200;
  const ignoreAudioRef = useRef(false);

  // Streaming text ref
  const assistantBufRef = useRef('');
  const [streamingText, setStreamingText] = useState('');

  // State ref for callbacks
  const orbStateRef = useRef<OrbStatus>('idle');
  const setOrbStateBoth = useCallback((s: OrbStatus) => {
    orbStateRef.current = s;
    setOrbState(s);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // ── Audio Context ──
  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  // ── PCM Playback ──
  const stopPlayback = useCallback(() => {
    for (const src of streamSourcesRef.current) {
      try { src.stop(); } catch {}
    }
    streamSourcesRef.current = [];
    streamNextTimeRef.current = 0;
  }, []);

  const startStreamPlayback = useCallback((sampleRate: number) => {
    stopPlayback();
    ensureAudioCtx();
    const ctx = audioCtxRef.current!;
    streamSampleRateRef.current = sampleRate || 24000;
    streamNextTimeRef.current = ctx.currentTime + 0.05;
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

  // ── VAD Handlers ──
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
    setMessages(prev => [...prev, { role: 'user', content: '...' }]);
    ws.send(JSON.stringify({ audio: wavB64 }));
    setOrbStateBoth('thinking');
    assistantBufRef.current = '';
    setStreamingText('');
  }, [setOrbStateBoth]);

  // ── WebSocket Message Handler ──
  const handleWsMessage = useCallback((event: MessageEvent) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'ready' || msg.type === 'mode' || msg.type === 'pong') return;

    if (msg.type === 'status') {
      if (msg.phase === 'transcribing' || msg.phase === 'thinking') {
        setOrbStateBoth('thinking');
      }
      return;
    }

    if (msg.type === 'text') {
      if (msg.transcription) {
        setMessages(prev => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'user') {
              copy[i] = { ...copy[i], content: msg.transcription };
              break;
            }
          }
          return copy;
        });
      }
      if (msg.text && msg.llm_time !== undefined) {
        setMessages(prev => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') {
              copy[i] = { ...copy[i], content: msg.text };
              break;
            }
          }
          return copy;
        });
        assistantBufRef.current = '';
        setStreamingText('');
      }
      return;
    }

    if (msg.type === 'assistant_token') {
      assistantBufRef.current += msg.text;
      const text = assistantBufRef.current;
      setStreamingText(text);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.content === '...') {
          const copy = [...prev];
          copy[copy.length - 1] = { ...last, content: text };
          return copy;
        }
        if (!last || last.role !== 'assistant') {
          return [...prev, { role: 'assistant', content: text }];
        }
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
      console.error('Setup WS error:', msg.message);
      setOrbStateBoth('listening');
      return;
    }
  }, [setOrbStateBoth, startStreamPlayback, queueAudioChunk, stopPlayback]);

  // ── Start Ceremony ──
  const startConversation = useCallback(async () => {
    setPhase('conversation');
    ensureAudioCtx();

    // Request mic
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;
      setMicActive(true);
    } catch {
      setShowTextInput(true);
    }

    // Connect WebSocket
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/realtime`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'setup_start' }));
      ws.send(JSON.stringify({ type: 'text_input', text: '你好' }));
      setOrbStateBoth('thinking');
      assistantBufRef.current = '';
      setStreamingText('');
    };

    ws.onmessage = handleWsMessage;

    ws.onclose = () => {
      wsRef.current = null;
    };

    // Initialize VAD if mic available
    if (stream) {
      try {
        const vad = (window as any).vad;
        if (vad?.MicVAD) {
          const myVad = await vad.MicVAD.new({
            stream,
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
        } else {
          setShowTextInput(true);
        }
      } catch {
        setShowTextInput(true);
      }
    }
  }, [ensureAudioCtx, handleWsMessage, handleSpeechStart, handleSpeechEnd, setOrbStateBoth]);

  // ── Text fallback ──
  const sendText = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    ws.send(JSON.stringify({ type: 'text_input', text }));
    setInput('');
    setOrbStateBoth('thinking');
    assistantBufRef.current = '';
    setStreamingText('');
  }, [input, setOrbStateBoth]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  };

  // ── Finalize ──
  const handleFinalize = useCallback(async () => {
    setPhase('finalizing');
    setOrbStateBoth('thinking');

    // Stop mic + VAD
    if (vadRef.current) {
      try { vadRef.current.destroy(); } catch {}
      vadRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      await api.setupFinalize(messages);
      setPhase('done');
      setOrbStateBoth('idle');
      setTimeout(() => { window.location.href = '/'; }, 2500);
    } catch (err) {
      console.error('Finalize failed:', err);
      setPhase('conversation');
      setOrbStateBoth('listening');
    }
  }, [messages, setOrbStateBoth]);

  // Cleanup on unmount
  useEffect(() => () => {
    stopPlayback();
    if (vadRef.current) { try { vadRef.current.destroy(); } catch {} }
    if (wsRef.current) { wsRef.current.close(); }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
    }
  }, [stopPlayback]);

  const turnCount = messages.filter(m => m.role === 'assistant').length;

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-[#0a0a1a] to-[#1a1a3a] flex flex-col items-center justify-center text-white overflow-hidden">
      {/* Welcome */}
      {phase === 'welcome' && (
        <div className="flex flex-col items-center gap-8 animate-fade-in">
          <OrbVisualizer state="idle" size={200} />
          <h1 className="text-2xl font-light tracking-wide">准备好认识你的 AI 伙伴了吗？</h1>
          <p className="text-zinc-500 text-sm max-w-md text-center">
            接下来会进行一段简短的语音对话，帮助 AI 了解你，并建立属于你们的独特连接。
          </p>
          <button
            onClick={startConversation}
            className="px-8 py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-lg transition-all hover:scale-105"
          >
            开始
          </button>
        </div>
      )}

      {/* Conversation / Finalizing */}
      {(phase === 'conversation' || phase === 'finalizing') && (
        <div className="flex flex-col items-center w-full max-w-2xl h-full py-8 px-4">
          {/* Orb */}
          <div className="shrink-0 mb-2 relative">
            <OrbVisualizer state={orbState} size={140} />
            {/* Status label */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[11px] text-zinc-500 tracking-wide">
              {orbState === 'listening' && '正在聆听…'}
              {orbState === 'thinking' && '思考中…'}
              {orbState === 'speaking' && '说话中…'}
            </div>
          </div>

          {/* Mic status */}
          {micActive && (
            <div className="flex items-center gap-1.5 text-[11px] text-green-400/70 mb-3">
              <Mic size={12} />
              <span>麦克风已开启 · 直接说话即可</span>
            </div>
          )}

          {/* Message history */}
          <div className="flex-1 w-full overflow-y-auto space-y-3 mb-4 px-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-white/10 text-zinc-200'
                      : 'bg-white/5 text-zinc-300'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          {phase === 'conversation' && (
            <div className="w-full max-w-lg space-y-3">
              {/* Toggle text input */}
              {!showTextInput && micActive && (
                <button
                  onClick={() => setShowTextInput(true)}
                  className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors mx-auto"
                >
                  <Keyboard size={12} />
                  切换到文字输入
                </button>
              )}

              {/* Text input (always show if no mic, or user toggled) */}
              {(showTextInput || !micActive) && (
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入你的回答…"
                    disabled={orbState === 'thinking' || orbState === 'speaking'}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm placeholder-zinc-600 focus:outline-none focus:border-white/30"
                  />
                  <button
                    onClick={sendText}
                    disabled={!input.trim() || orbState === 'thinking' || orbState === 'speaking'}
                    className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-colors"
                  >
                    <Send size={16} />
                  </button>
                </div>
              )}

              {/* Finalize button after enough turns */}
              {turnCount >= 4 && (
                <button
                  onClick={handleFinalize}
                  className="w-full py-2.5 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/30 text-sm transition-colors"
                >
                  完成初始化
                </button>
              )}
            </div>
          )}

          {phase === 'finalizing' && (
            <div className="text-zinc-400 text-sm animate-pulse">正在生成人格…</div>
          )}

          {/* Progress dots */}
          <div className="flex gap-2 mt-4">
            {[0, 1, 2, 3, 4].map(i => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i < Math.min(turnCount, 5) ? 'bg-blue-400' : 'bg-zinc-700'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && (
        <div className="flex flex-col items-center gap-6 animate-fade-in">
          <OrbVisualizer state="idle" size={160} />
          <h2 className="text-xl font-light">初始化完成</h2>
          <p className="text-zinc-400 text-sm">即将进入助理界面…</p>
        </div>
      )}
    </div>
  );
}
