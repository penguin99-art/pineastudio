import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Chat from './pages/Chat';
import Models from './pages/Models';
import System from './pages/System';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/chat" element={<Chat />} />
          <Route path="/models" element={<Models />} />
          <Route path="/system" element={<System />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
