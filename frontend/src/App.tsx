import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Assistant from './pages/Assistant';
import Memory from './pages/Memory';
import Setup from './pages/Setup';
import Chat from './pages/Chat';
import Omni from './pages/Omni';
import Realtime from './pages/Realtime';
import Video from './pages/Video';
import Models from './pages/Models';
import System from './pages/System';
import Settings from './pages/Settings';
import { api } from './api/client';

function InitGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'setup'>('loading');

  useEffect(() => {
    api.memoryStatus()
      .then((s) => setState(s.initialized ? 'ready' : 'setup'))
      .catch(() => setState('ready'));
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen text-zinc-500">
        loading…
      </div>
    );
  }

  if (state === 'setup') {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <InitGate>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route element={<Layout />}>
            <Route index element={<Assistant />} />
            <Route path="/memory" element={<Memory />} />

            {/* Showcase */}
            <Route path="/showcase/omni" element={<Omni />} />
            <Route path="/showcase/realtime" element={<Realtime />} />
            <Route path="/showcase/video" element={<Video />} />

            {/* Studio */}
            <Route path="/studio/chat" element={<Chat />} />
            <Route path="/studio/models" element={<Models />} />
            <Route path="/studio/system" element={<System />} />
            <Route path="/studio/settings" element={<Settings />} />

            {/* Legacy redirects */}
            <Route path="/chat" element={<Navigate to="/studio/chat" replace />} />
            <Route path="/omni" element={<Navigate to="/showcase/omni" replace />} />
            <Route path="/realtime" element={<Navigate to="/showcase/realtime" replace />} />
            <Route path="/models" element={<Navigate to="/studio/models" replace />} />
            <Route path="/system" element={<Navigate to="/studio/system" replace />} />
            <Route path="/settings" element={<Navigate to="/studio/settings" replace />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </InitGate>
    </BrowserRouter>
  );
}
