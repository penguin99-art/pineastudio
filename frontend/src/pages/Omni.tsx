import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Settings2, Send, Keyboard, Camera, CameraOff } from 'lucide-react';

type SessionState = 'idle' | 'starting_server' | 'initializing' | 'loading_omni' | 'ready' | 'listening' | 'speaking' | 'error';

interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
}

const PRESETS = {
  zh: {
    label: '中文通话',
    prompt: '扮演一个具有以上声音特征的助手。请认真、高质量地回复用户的问题。请用高自然度的方式和用户聊天。你处于双工模式，可以一边听、一边说。你是由面壁智能开发的人工智能助手：面壁小钢炮。',
  },
  en: {
    label: 'English Call',
    prompt: 'You are a helpful voice assistant. Please answer questions naturally and conversationally. You are in duplex mode — you can listen and speak simultaneously.',
  },
};

const STATE_LABELS: Record<SessionState, string> = {
  idle: 'Ready to start',
  starting_server: 'Starting omni server...',
  initializing: 'Connecting...',
  loading_omni: 'Loading MiniCPM-o modules (30-60s)...',
  ready: 'Session active — speak now',
  listening: 'Listening...',
  speaking: 'Speaking...',
  error: 'Error',
};

export default function Omni() {
  const [state, setState] = useState<SessionState>('idle');
  const [muted, setMuted] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentText, setCurrentText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [duplexMode, setDuplexMode] = useState(true);
  const [omniStatus, setOmniStatus] = useState<{ registered: boolean; running: boolean; healthy: boolean } | null>(null);
  const [micAvailable, setMicAvailable] = useState(true);
  const [textInput, setTextInput] = useState('');
  const [preset, setPreset] = useState<'zh' | 'en'>('zh');
  const [cameraOn, setCameraOn] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const recordingStartRef = useRef<number>(0);
  const audioBytesSentRef = useRef<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = state !== 'idle' && state !== 'error';

  useEffect(() => {
    fetch('/api/omni/status').then(r => r.json()).then(setOmniStatus).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, currentText]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = cameraStreamRef.current;
    if (cameraOn && video && stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
  }, [cameraOn]);

  const addSystemMsg = useCallback((text: string) => {
    setTranscript(t => [...t, { role: 'system', text, timestamp: Date.now() }]);
  }, []);

  const connectWS = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/omni`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (msg.type === 'status') {
        const s = msg.state as SessionState;
        setState(s);
        if (s === 'error') setErrorMsg(msg.message || 'Unknown error');
        if (s === 'initializing') addSystemMsg('Connecting...');
        if (s === 'loading_omni') addSystemMsg('Loading MiniCPM-o modules...');
        if (s === 'ready') addSystemMsg('Session active — speak now');
      } else if (msg.type === 'text') {
        if (msg.content) {
          setCurrentText(prev => prev + msg.content);
        }
        if (msg.is_listen) {
          setCurrentText(prev => {
            if (prev.trim()) {
              setTranscript(t => [
                ...t,
                { role: 'assistant', text: prev.trim(), timestamp: Date.now() },
                { role: 'system', text: '— end of turn —', timestamp: Date.now() },
              ]);
            }
            return '';
          });
        }
      } else if (msg.type === 'audio') {
        playAudioChunk(msg.data);
      } else if (msg.type === 'error') {
        setErrorMsg(msg.message);
        setState('error');
        addSystemMsg(`Error: ${msg.message}`);
      }
    };

    ws.onclose = () => {
      setState('idle');
      wsRef.current = null;
    };

    return ws;
  }, [addSystemMsg]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ws = wsRef.current;
    if (!video || !canvas || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = Math.min(video.videoWidth, 640);
    canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const b64 = dataUrl.split(',')[1];
    ws.send(JSON.stringify({ type: 'image', data: b64 }));
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      cameraStreamRef.current = stream;
      setCameraOn(true);
      cameraIntervalRef.current = setInterval(captureFrame, 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addSystemMsg(`Camera: ${msg}`);
    }
  }, [captureFrame, addSystemMsg]);

  const stopCamera = useCallback(() => {
    if (cameraIntervalRef.current) {
      clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const toggleCamera = useCallback(() => {
    if (cameraOn) stopCamera();
    else startCamera();
  }, [cameraOn, startCamera, stopCamera]);

  const startCall = async () => {
    if (isActive) return;
    setState('initializing');
    setTranscript([]);
    setCurrentText('');
    setErrorMsg('');

    const ws = connectWS();

    ws.onerror = () => {
      setErrorMsg('WebSocket connection failed.');
      setState('error');
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'start',
        config: { media_type: 2, use_tts: ttsEnabled, duplex_mode: duplexMode },
      }));
      recordingStartRef.current = Date.now();
      audioBytesSentRef.current = 0;

      (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
          });
          streamRef.current = stream;
          try {
            startAudioCapture(stream);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setErrorMsg(`Audio capture: ${msg}`);
            setMicAvailable(false);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setErrorMsg(`Mic: ${msg}. Text input available.`);
          setMicAvailable(false);
        }
      })();
    };
  };

  const handleTextSend = () => {
    const text = textInput.trim();
    if (!text || !wsRef.current) return;
    setTranscript(t => [...t, { role: 'user', text, timestamp: Date.now() }]);
    setTextInput('');
  };

  const endCall = () => {
    if (currentText.trim()) {
      setTranscript(t => [...t, { role: 'assistant', text: currentText.trim(), timestamp: Date.now() }]);
      setCurrentText('');
    }
    // Show recording stats
    if (recordingStartRef.current > 0) {
      const dur = ((Date.now() - recordingStartRef.current) / 1000).toFixed(1);
      const kb = (audioBytesSentRef.current / 1024).toFixed(0);
      addSystemMsg(`Recording: ${dur}s mono WAV (${kb} KB)`);
    }
    setMicAvailable(true);
    stopCamera();
    wsRef.current?.send(JSON.stringify({ type: 'stop' }));
    wsRef.current?.close();
    wsRef.current = null;
    stopAudioCapture();
    setState('idle');
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    wsRef.current?.send(JSON.stringify({ type: 'mute', muted: next }));
  };

  const startAudioCapture = (stream: MediaStream) => {
    const ctx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    source.connect(analyser);

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    source.connect(processor);
    processor.connect(ctx.destination);

    const TARGET_SAMPLES = 16000;
    let accumulator = new Int16Array(0);

    processor.onaudioprocess = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
      }

      const merged = new Int16Array(accumulator.length + int16.length);
      merged.set(accumulator);
      merged.set(int16, accumulator.length);
      accumulator = merged;

      if (accumulator.length >= TARGET_SAMPLES) {
        const chunk = accumulator.slice(0, TARGET_SAMPLES);
        accumulator = accumulator.slice(TARGET_SAMPLES);

        // RMS energy check — skip sending background noise
        let sumSq = 0;
        for (let i = 0; i < chunk.length; i++) sumSq += chunk[i] * chunk[i];
        const rms = Math.sqrt(sumSq / chunk.length);
        if (rms < 200) return; // ~-50dB threshold, skip silence/noise

        const rawBytes = new Uint8Array(chunk.buffer);
        audioBytesSentRef.current += rawBytes.length;
        const b64 = btoa(String.fromCharCode(...rawBytes));
        wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
      }
    };

    const updateLevel = () => {
      if (!analyserRef.current) return;
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setAudioLevel(avg / 255);
      animFrameRef.current = requestAnimationFrame(updateLevel);
    };
    updateLevel();
  };

  const stopAudioCapture = () => {
    cancelAnimationFrame(animFrameRef.current);
    processorRef.current?.disconnect();
    audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setAudioLevel(0);
  };

  const playAudioChunk = async (b64: string) => {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      audioQueueRef.current.push(bytes.buffer);
      if (!isPlayingRef.current) drainAudioQueue();
    } catch { /* skip */ }
  };

  const drainAudioQueue = async () => {
    isPlayingRef.current = true;
    while (audioQueueRef.current.length > 0) {
      const buf = audioQueueRef.current.shift()!;
      try {
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(ctx.destination);
        source.start();
        await new Promise<void>(resolve => { source.onended = () => resolve(); });
        ctx.close();
      } catch { /* skip */ }
    }
    isPlayingRef.current = false;
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800/60">
        {/* Preset selector + status */}
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${
              state === 'ready' || state === 'listening' ? 'bg-emerald-400 animate-pulse'
              : state === 'speaking' ? 'bg-blue-400 animate-pulse'
              : isActive ? 'bg-amber-400 animate-pulse'
              : 'bg-zinc-600'
            }`} />
            <span className="text-sm font-medium text-zinc-200">MiniCPM-o 4.5</span>
          </div>

          {/* Preset tabs */}
          <div className="flex gap-1 ml-3">
            {(Object.entries(PRESETS) as [keyof typeof PRESETS, typeof PRESETS.zh][]).map(([key, p]) => (
              <button
                key={key}
                onClick={() => !isActive && setPreset(key)}
                disabled={isActive}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  preset === key
                    ? 'bg-zinc-700 text-zinc-100 font-medium'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                } disabled:opacity-50`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {errorMsg && (
              <span className="text-xs text-amber-400 truncate max-w-xs">{errorMsg}</span>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-800"
            >
              <Settings2 size={14} />
            </button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="px-5 py-3 border-t border-zinc-800/40 bg-zinc-900/30 space-y-3">
            {/* System prompt */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">System Prompt</label>
              <div className="text-xs text-zinc-400 bg-zinc-800/50 rounded-lg px-3 py-2 leading-relaxed">
                {PRESETS[preset].prompt}
              </div>
            </div>

            {/* Options row */}
            <div className="flex items-center gap-4 text-xs text-zinc-400">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={duplexMode} onChange={e => setDuplexMode(e.target.checked)}
                  className="rounded accent-emerald-500" disabled={isActive} />
                Full Duplex
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={ttsEnabled} onChange={e => setTtsEnabled(e.target.checked)}
                  className="rounded accent-emerald-500" disabled={isActive} />
                TTS Voice
              </label>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-600">Ref Audio: default (6s)</span>
            </div>

            {omniStatus && (
              <div className="text-[10px] text-zinc-600">
                Backend: {omniStatus.registered ? 'registered' : 'not registered'} |
                Server: {omniStatus.running ? 'running' : omniStatus.healthy ? 'healthy' : 'stopped'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Conversation area */}
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {/* Camera preview */}
        <div className={`flex justify-center mb-4 ${cameraOn ? '' : 'hidden'}`}>
          <div className="relative rounded-xl overflow-hidden border border-zinc-700/50 shadow-lg">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-48 h-36 object-cover bg-black"
            />
            <div className="absolute bottom-1.5 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/60 rounded text-[10px] text-zinc-300">
              <Camera size={10} className="text-red-400" />
              <span>5s interval</span>
            </div>
          </div>
        </div>

        {transcript.length === 0 && !currentText && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
            <div className="w-16 h-16 rounded-full bg-zinc-800/80 flex items-center justify-center">
              <Mic size={28} className="text-zinc-500" />
            </div>
            <p className="text-sm">Press Start Call to begin a voice conversation</p>
            <p className="text-xs text-zinc-700">MiniCPM-o supports real-time voice, vision (camera), and TTS</p>
            {!window.isSecureContext && (
              <p className="text-xs text-amber-500/80 max-w-sm text-center mt-2">
                ⚠ Page is not in a secure context. Mic requires HTTPS or localhost.
                Start server with <code className="bg-zinc-800 px-1 rounded">--ssl</code> flag.
              </p>
            )}
          </div>
        )}

        <div className="max-w-2xl mx-auto space-y-3">
          {transcript.map((entry, i) => {
            if (entry.role === 'system') {
              const isEndOfTurn = entry.text === '— end of turn —';
              if (isEndOfTurn) {
                return (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <div className="flex-1 h-px bg-zinc-800/60" />
                    <span className="text-[10px] text-zinc-600 whitespace-nowrap">end of turn</span>
                    <div className="flex-1 h-px bg-zinc-800/60" />
                  </div>
                );
              }
              return (
                <div key={i} className="flex items-center gap-2 py-1">
                  <span className="w-4 h-4 rounded-full bg-zinc-800 shrink-0 flex items-center justify-center">
                    <span className="block w-1.5 h-1.5 rounded-full bg-zinc-500" />
                  </span>
                  <span className="text-xs text-zinc-500">{entry.text}</span>
                </div>
              );
            }

            return (
              <div key={i} className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-lg rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  entry.role === 'user'
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-800/60 text-zinc-300'
                }`}>
                  {entry.role === 'assistant' && (
                    <div className="text-[10px] text-rose-400/70 mb-1 font-semibold">AI</div>
                  )}
                  <div className="whitespace-pre-wrap">{entry.text}</div>
                </div>
              </div>
            );
          })}

          {currentText && (
            <div className="flex justify-start">
              <div className="max-w-lg rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-zinc-800/60 text-zinc-300">
                <div className="text-[10px] text-rose-400/70 mb-1 font-semibold">AI</div>
                <div className="whitespace-pre-wrap">
                  {currentText}
                  <span className="inline-block w-1.5 h-4 bg-rose-400/50 ml-0.5 animate-pulse" />
                </div>
              </div>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Audio level */}
      {isActive && micAvailable && (
        <div className="shrink-0 px-5 py-1.5">
          <div className="max-w-md mx-auto h-1.5 bg-zinc-800/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500/80 to-emerald-400/80 rounded-full transition-all duration-75"
              style={{ width: `${Math.min(audioLevel * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Text input fallback */}
      {isActive && !micAvailable && (
        <div className="shrink-0 px-5 py-2">
          <div className="max-w-2xl mx-auto flex gap-2">
            <div className="flex items-center gap-1.5 px-2 text-zinc-600">
              <Keyboard size={14} />
            </div>
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleTextSend()}
              placeholder="Type a message (mic unavailable)..."
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={handleTextSend}
              disabled={!textInput.trim()}
              className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:hover:bg-emerald-600 text-white transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="shrink-0 px-5 pb-6 pt-3 border-t border-zinc-800/40">
        <div className="flex items-center justify-center gap-4">
          {!isActive ? (
            <button
              onClick={startCall}
              className="flex items-center gap-2.5 px-8 py-3 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors shadow-lg shadow-emerald-900/30"
            >
              <Phone size={18} />
              <span>Start Call</span>
            </button>
          ) : (
            <>
              {micAvailable && (
                <button
                  onClick={toggleMute}
                  className={`p-3 rounded-full transition-colors ${
                    muted
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              )}

              <button
                onClick={toggleCamera}
                className={`p-3 rounded-full transition-colors ${
                  cameraOn
                    ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
                title={cameraOn ? 'Turn off camera' : 'Turn on camera'}
              >
                {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
              </button>

              <button
                onClick={endCall}
                className="p-3 rounded-full bg-red-600 hover:bg-red-500 text-white transition-colors"
                title="End call"
              >
                <PhoneOff size={18} />
              </button>

              <button
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={`p-3 rounded-full transition-colors ${
                  ttsEnabled
                    ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    : 'bg-zinc-800 text-zinc-600 hover:bg-zinc-700'
                }`}
                title={ttsEnabled ? 'Disable voice' : 'Enable voice'}
              >
                {ttsEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
            </>
          )}
        </div>

        {/* Status label */}
        <div className="text-center mt-2">
          <span className={`text-xs ${
            state === 'ready' || state === 'listening' ? 'text-emerald-500/70'
            : state === 'speaking' ? 'text-blue-400/70'
            : isActive ? 'text-amber-400/70'
            : 'text-zinc-600'
          }`}>
            {STATE_LABELS[state]}
          </span>
        </div>
      </div>
    </div>
  );
}
