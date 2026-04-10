import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send, Square, ChevronDown, ChevronRight, Brain,
  Plus, Trash2, MessageSquare, Lightbulb,
} from 'lucide-react';
import { api, streamChat, type ModelInfo, type Conversation } from '../api/client';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  model?: string;
}

function ThinkingBlock({ reasoning, isStreaming }: { reasoning: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} />
        <span>思考过程</span>
        {isStreaming && <span className="inline-block w-1 h-3 bg-zinc-500 ml-1 animate-pulse" />}
      </button>
      {open && (
        <div className="mt-1.5 pl-3 border-l-2 border-zinc-700 text-xs text-zinc-500 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
          {reasoning}
        </div>
      )}
    </div>
  );
}

function modelShortName(modelId: string): string {
  const name = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  return name.replace(/:latest$/, '');
}

export default function Chat() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [thinking, setThinking] = useState(true);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.models().then((r) => {
      setModels(r.models);
      if (r.models.length > 0 && !selectedModel) {
        setSelectedModel(r.models[0].id);
      }
    });
    loadConversations();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversations = async () => {
    const convs = await api.conversations();
    setConversations(convs);
  };

  const loadConversation = useCallback(async (convId: string) => {
    const detail = await api.getConversation(convId);
    setActiveConvId(convId);
    setMessages(
      detail.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        reasoning: m.reasoning || undefined,
        model: m.model || undefined,
      }))
    );
    if (detail.model) setSelectedModel(detail.model);
  }, []);

  const handleNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setInput('');
  };

  const handleDeleteConv = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.deleteConversation(convId);
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
    loadConversations();
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !selectedModel || streaming) return;

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    let convId = activeConvId;

    if (!convId) {
      const title = text.length > 30 ? text.slice(0, 30) + '…' : text;
      const res = await api.createConversation(title, selectedModel);
      convId = res.id;
      setActiveConvId(convId);
      loadConversations();
    }

    await api.addMessage(convId, 'user', text, '', selectedModel);

    const assistantMsg: Message = {
      role: 'assistant', content: '', reasoning: '', model: selectedModel,
    };
    setMessages([...newMessages, assistantMsg]);

    try {
      for await (const chunk of streamChat(
        selectedModel, newMessages, { temperature, thinking },
      )) {
        if (chunk.reasoning) assistantMsg.reasoning = (assistantMsg.reasoning || '') + chunk.reasoning;
        if (chunk.content) assistantMsg.content += chunk.content;
        setMessages((prev) => [...prev.slice(0, -1), { ...assistantMsg }]);
      }
    } catch (e) {
      if (assistantMsg.content === '' && !assistantMsg.reasoning) {
        assistantMsg.content = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
        setMessages((prev) => [...prev.slice(0, -1), { ...assistantMsg }]);
      }
    } finally {
      setStreaming(false);
    }

    await api.addMessage(
      convId, 'assistant', assistantMsg.content,
      assistantMsg.reasoning || '', selectedModel,
    );
    loadConversations();
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    const gb = bytes / 1e9;
    return gb >= 1 ? `${gb.toFixed(1)}G` : `${(bytes / 1e6).toFixed(0)}M`;
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      <div className="w-56 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/30">
        <div className="p-2">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <Plus size={14} />
            <span>New Chat</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => loadConversation(c.id)}
              className={`w-full group flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                activeConvId === c.id
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <MessageSquare size={13} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate">{c.title}</div>
                <div className="text-[10px] text-zinc-600">
                  {modelShortName(c.model)} · {formatTime(c.updated_at)}
                </div>
              </div>
              <button
                onClick={(e) => handleDeleteConv(c.id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-600 hover:text-red-400 transition-opacity"
              >
                <Trash2 size={12} />
              </button>
            </button>
          ))}
          {conversations.length === 0 && (
            <div className="text-xs text-zinc-600 text-center py-8">No conversations yet</div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800">
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="appearance-none bg-zinc-800 text-sm text-zinc-200 pl-3 pr-8 py-1.5 rounded-lg border border-zinc-700 focus:outline-none focus:border-zinc-500 cursor-pointer"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {formatSize(m.size_bytes)} — {m.backend_id}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span>temp</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-20 accent-zinc-500"
            />
            <span className="w-6 text-zinc-400">{temperature}</span>
          </div>

          <button
            onClick={() => setThinking(!thinking)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
              thinking
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
            }`}
            title={thinking ? '关闭深度思考' : '开启深度思考'}
          >
            <Lightbulb size={12} />
            <span>Thinking</span>
          </button>

          <button
            onClick={handleNewChat}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded hover:bg-zinc-800"
          >
            Clear
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
              Select a model and start chatting
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-2xl rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-800/60 text-zinc-300'
                }`}
              >
                {msg.role === 'assistant' && msg.model && (
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/80 text-zinc-400 font-mono">
                      {modelShortName(msg.model)}
                    </span>
                  </div>
                )}
                {msg.role === 'assistant' && msg.reasoning && (
                  <ThinkingBlock
                    reasoning={msg.reasoning}
                    isStreaming={streaming && i === messages.length - 1 && !msg.content}
                  />
                )}
                <div className="whitespace-pre-wrap">
                  {msg.content}
                  {streaming && i === messages.length - 1 && msg.role === 'assistant' && (
                    <span className="inline-block w-1.5 h-4 bg-zinc-400 ml-0.5 animate-pulse" />
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 pb-4 pt-2">
          <div className="flex items-end gap-2 bg-zinc-800/80 rounded-2xl border border-zinc-700 px-3 py-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="flex-1 bg-transparent resize-none text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none max-h-32"
              style={{ minHeight: '24px' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 128) + 'px';
              }}
            />
            {streaming ? (
              <button onClick={handleStop} className="p-1.5 text-zinc-400 hover:text-white">
                <Square size={16} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="p-1.5 text-zinc-400 hover:text-white disabled:text-zinc-700"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
