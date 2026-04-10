import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, Send, Phone, PhoneOff } from 'lucide-react';

/* ── Types ── */
type AppState = 'loading' | 'listening' | 'processing' | 'speaking';
type MsgRole = 'user' | 'assistant' | 'system';
interface Msg { role: MsgRole; text: string; meta?: string }

/* ── Helpers ── */
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

const STATE_COLORS: Record<AppState, string> = {
  loading: '#3a3d46',
  listening: '#4ade80',
  processing: '#f59e0b',
  speaking: '#818cf8',
};

const STATE_LABELS: Record<AppState, string> = {
  loading: 'Loading...',
  listening: 'Listening',
  processing: 'Thinking...',
  speaking: 'Speaking',
};

export default function Realtime() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [modelName, setModelName] = useState('');
  const [asrStatus, setAsrStatus] = useState('');
  const [ttsStatus, setTtsStatus] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const ambientPhaseRef = useRef(0);

  // Streaming playback state
  const streamSampleRateRef = useRef(24000);
  const streamNextTimeRef = useRef(0);
  const streamSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const speakingStartedRef = useRef(0);
  const ignoreAudioRef = useRef(false);
  const BARGE_IN_GRACE_MS = 1200;

  // Streaming text accumulator
  const assistantTextRef = useRef('');

  const appStateRef = useRef<AppState>('loading');
  const setAppStateBoth = useCallback((s: AppState) => {
    appStateRef.current = s;
    setAppState(s);
    // Raise VAD threshold during speaking to suppress echo-triggered barge-in
    const myVad = vadRef.current;
    if (myVad && typeof myVad.setOptions === 'function') {
      myVad.setOptions({
        positiveSpeechThreshold: s === 'speaking' ? 0.92 : 0.5,
      });
    }
  }, []);

  const addMsg = useCallback((role: MsgRole, text: string, meta?: string) => {
    setMessages(prev => [...prev, { role, text, meta }]);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ── Audio context ── */
  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.75;
    }
  }, []);

  /* ── Streaming PCM playback ── */
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
    if (ctx.state === 'suspended') ctx.resume();
    streamSampleRateRef.current = sampleRate || 24000;
    streamNextTimeRef.current = ctx.currentTime + 0.05;
    speakingStartedRef.current = Date.now();
    setAppStateBoth('speaking');
  }, [stopPlayback, ensureAudioCtx, setAppStateBoth]);

  const queueAudioChunk = useCallback((base64Pcm: string) => {
    ensureAudioCtx();
    const ctx = audioCtxRef.current!;
    const analyser = analyserRef.current!;

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
    source.connect(analyser);

    const startAt = Math.max(streamNextTimeRef.current, ctx.currentTime);
    source.start(startAt);
    streamNextTimeRef.current = startAt + audioBuffer.duration;
    streamSourcesRef.current.push(source);

    source.onended = () => {
      const idx = streamSourcesRef.current.indexOf(source);
      if (idx !== -1) streamSourcesRef.current.splice(idx, 1);
      if (streamSourcesRef.current.length === 0 && appStateRef.current === 'speaking') {
        setAppStateBoth('listening');
      }
    };
  }, [ensureAudioCtx, setAppStateBoth]);

  /* ── Waveform drawing ── */
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const BAR_COUNT = 40;
    const BAR_GAP = 3;
    const barW = (w - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT;
    ctx.fillStyle = STATE_COLORS[appStateRef.current] || STATE_COLORS.loading;

    let dataArray: Uint8Array<ArrayBuffer> | null = null;
    if (analyserRef.current) {
      dataArray = new Uint8Array(analyserRef.current.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      analyserRef.current.getByteFrequencyData(dataArray);
    }

    for (let i = 0; i < BAR_COUNT; i++) {
      let amp: number;
      if (dataArray) {
        const bin = Math.floor((i / BAR_COUNT) * dataArray.length * 0.6);
        amp = dataArray[bin] / 255;
      } else {
        amp = 0;
      }
      if (!dataArray || amp < 0.02) {
        ambientPhaseRef.current += 0.0001;
        const drift = Math.sin(ambientPhaseRef.current * 3 + i * 0.4) * 0.5 + 0.5;
        amp = 0.03 + drift * 0.04;
      }
      const barH = Math.max(2, amp * (h - 4));
      const x = i * (barW + BAR_GAP);
      const y = (h - barH) / 2;
      ctx.globalAlpha = 0.3 + amp * 0.7;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, Math.min(barW / 2, barH / 2, 3));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    rafRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  /* ── WebSocket ── */
  const handleWsMessage = useCallback((ev: MessageEvent) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === 'pong') return;

    if (msg.type === 'ready') {
      setModelName(msg.config?.model_name || '');
      setAsrStatus(msg.asr?.backend || '');
      setTtsStatus(msg.tts?.backend || '');
      return;
    }

    if (msg.type === 'status') {
      if (msg.phase === 'transcribing' || msg.phase === 'thinking') {
        setAppStateBoth('processing');
      }
      return;
    }

    if (msg.type === 'text') {
      if (msg.transcription) {
        // Update last user message with real transcription
        setMessages(prev => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'user') {
              copy[i] = { ...copy[i], text: msg.transcription };
              break;
            }
          }
          return copy;
        });
      }
      if (msg.text && msg.llm_time !== undefined) {
        // Finalize assistant with full text + meta
        setMessages(prev => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') {
              copy[i] = { ...copy[i], text: msg.text, meta: `LLM ${msg.llm_time}s` };
              break;
            }
          }
          return copy;
        });
        assistantTextRef.current = '';
      }
      return;
    }

    if (msg.type === 'assistant_token') {
      assistantTextRef.current += msg.text;
      const currentText = assistantTextRef.current;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && !last.meta) {
          const copy = [...prev];
          copy[copy.length - 1] = { ...last, text: currentText };
          return copy;
        }
        return [...prev, { role: 'assistant', text: currentText }];
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
        setAppStateBoth('listening');
        return;
      }
      if (msg.tts_time !== undefined) {
        setMessages(prev => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') {
              const existing = copy[i].meta || '';
              copy[i] = { ...copy[i], meta: `${existing} · TTS ${msg.tts_time}s`.trim() };
              break;
            }
          }
          return copy;
        });
      }
      return;
    }

    if (msg.type === 'error') {
      addMsg('system', msg.message);
      if (appStateRef.current === 'processing') setAppStateBoth('listening');
      return;
    }
  }, [setAppStateBoth, addMsg, startStreamPlayback, queueAudioChunk, stopPlayback]);

  /* ── VAD handlers ── */
  const handleSpeechStart = useCallback(() => {
    if (appStateRef.current === 'speaking') {
      if (Date.now() - speakingStartedRef.current < BARGE_IN_GRACE_MS) return;
      stopPlayback();
      ignoreAudioRef.current = true;
      wsRef.current?.send(JSON.stringify({ type: 'interrupt' }));
      setAppStateBoth('listening');
    }
  }, [stopPlayback, setAppStateBoth]);

  const handleSpeechEnd = useCallback((audio: Float32Array) => {
    // Only accept speech when in listening state
    if (appStateRef.current !== 'listening') return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Reject very short utterances (likely noise/echo)
    if (audio.length < 4800) return; // < 0.3s at 16kHz

    const wavB64 = float32ToWavBase64(audio);
    setAppStateBoth('processing');
    assistantTextRef.current = '';
    addMsg('user', '...');
    ws.send(JSON.stringify({ audio: wavB64 }));
  }, [setAppStateBoth, addMsg]);

  /* ── Start/Stop session ── */
  const startSession = useCallback(async () => {
    setActive(true);
    setMessages([]);
    setAppStateBoth('loading');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;
    } catch (e: any) {
      addMsg('system', `Mic error: ${e.message}`);
      setActive(false);
      return;
    }

    ensureAudioCtx();

    // Connect WebSocket
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/realtime`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setAppStateBoth('listening');
    };

    ws.onclose = () => {
      setConnected(false);
      if (appStateRef.current !== 'loading') {
        addMsg('system', 'Disconnected');
      }
    };

    ws.onmessage = handleWsMessage;

    // Initialize Silero VAD
    try {
      const vad = (window as any).vad;
      if (vad?.MicVAD) {
        const myVad = await vad.MicVAD.new({
          stream: mediaStreamRef.current,
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
        addMsg('system', 'VAD library not loaded, using text input');
      }
    } catch (err: any) {
      addMsg('system', `VAD init failed: ${err.message}`);
    }

    // Connect mic to analyser for waveform
    if (mediaStreamRef.current && audioCtxRef.current && analyserRef.current) {
      micSourceRef.current = audioCtxRef.current.createMediaStreamSource(mediaStreamRef.current);
      micSourceRef.current.connect(analyserRef.current);
    }

    drawWaveform();
  }, [ensureAudioCtx, handleWsMessage, handleSpeechStart, handleSpeechEnd, addMsg, setAppStateBoth, drawWaveform]);

  const stopSession = useCallback(() => {
    setActive(false);
    setAppStateBoth('loading');
    stopPlayback();

    if (vadRef.current) {
      try { vadRef.current.destroy(); } catch {}
      vadRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (micSourceRef.current) {
      try { micSourceRef.current.disconnect(); } catch {}
      micSourceRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    setConnected(false);
  }, [setAppStateBoth, stopPlayback]);

  // Cleanup on unmount
  useEffect(() => () => { stopSession(); }, []);

  /* ── Text input send ── */
  const sendText = useCallback(() => {
    const text = textInput.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    assistantTextRef.current = '';
    addMsg('user', text);
    wsRef.current.send(JSON.stringify({ type: 'text_input', text }));
    setTextInput('');
    setAppStateBoth('processing');
  }, [textInput, addMsg, setAppStateBoth]);

  const stateColor = STATE_COLORS[appState];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-lg" style={{ background: `linear-gradient(135deg, ${stateColor}, transparent)`, opacity: 0.7 }} />
          <h1 className="text-lg font-semibold text-zinc-100">Realtime Voice</h1>
        </div>
        {modelName && <span className="text-[11px] text-zinc-500 font-medium tracking-wide">{modelName}</span>}
        <div className="flex items-center gap-2">
          <div className={`text-[11px] font-semibold px-3 py-1 rounded-full flex items-center gap-1.5 tracking-wider uppercase ${
            connected ? 'text-green-400 bg-green-400/10' : 'text-zinc-500 bg-zinc-800'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-zinc-500'}`} />
            {connected ? 'Connected' : 'Offline'}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center max-w-2xl mx-auto w-full px-4 min-h-0">
        {/* Waveform */}
        {active && (
          <div className="w-full max-w-lg h-12 mt-4 shrink-0">
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>
        )}

        {/* Status info bar */}
        {active && (
          <div className="flex items-center gap-4 mt-2 shrink-0">
            {asrStatus && <span className="text-[10px] text-zinc-600">ASR: {asrStatus}</span>}
            {ttsStatus && <span className="text-[10px] text-zinc-600">TTS: {ttsStatus}</span>}
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: stateColor, boxShadow: `0 0 8px ${stateColor}40` }} />
              <span className="text-xs text-zinc-400 font-medium">{STATE_LABELS[appState]}</span>
            </div>
          </div>
        )}

        {/* Transcript */}
        <div className="flex-1 w-full overflow-y-auto mt-3 space-y-2 scroll-smooth min-h-0"
             style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 12px, black 100%)' }}>
          {!active && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-4">
              <div className="w-20 h-20 rounded-2xl bg-zinc-800/50 flex items-center justify-center">
                <Mic className="w-8 h-8 text-zinc-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-400">Realtime Voice Assistant</p>
                <p className="text-xs mt-1 text-zinc-600">ASR → LLM → TTS pipeline</p>
                <p className="text-xs mt-0.5 text-zinc-600">Press Start to begin a voice conversation</p>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : m.role === 'system' ? 'justify-center' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-3.5 py-2.5 rounded-xl text-[13.5px] leading-relaxed animate-in fade-in slide-in-from-bottom-1 ${
                m.role === 'user'
                  ? 'bg-green-500/8 text-green-200/80 rounded-br-sm'
                  : m.role === 'system'
                  ? 'bg-red-500/8 text-red-300/70 text-xs'
                  : 'bg-zinc-800/50 text-zinc-300 rounded-bl-sm'
              }`}>
                {m.text === '...' ? (
                  <span className="inline-flex gap-1 items-center h-5">
                    {[0, 1, 2].map(n => (
                      <span key={n} className="w-1.5 h-1.5 rounded-full bg-green-400/50 animate-bounce" style={{ animationDelay: `${n * 0.15}s` }} />
                    ))}
                  </span>
                ) : m.text}
                {m.meta && <div className="text-[10.5px] text-zinc-500 mt-1 tabular-nums">{m.meta}</div>}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Controls */}
        <div className="w-full shrink-0 pb-4 pt-2">
          {active && (
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 text-sm bg-zinc-800/50 border border-zinc-700/30 rounded-lg text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-600 transition"
              />
              <button onClick={sendText}
                className="p-2 bg-zinc-800/50 border border-zinc-700/30 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/40 transition">
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex justify-center">
            {!active ? (
              <button onClick={startSession}
                className="flex items-center gap-2 px-6 py-3 bg-green-500/15 border border-green-500/20 rounded-xl text-green-400 text-sm font-semibold hover:bg-green-500/25 transition">
                <Phone className="w-4 h-4" />
                Start Conversation
              </button>
            ) : (
              <button onClick={stopSession}
                className="flex items-center gap-2 px-6 py-3 bg-red-500/15 border border-red-500/20 rounded-xl text-red-400 text-sm font-semibold hover:bg-red-500/25 transition">
                <PhoneOff className="w-4 h-4" />
                End Conversation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
