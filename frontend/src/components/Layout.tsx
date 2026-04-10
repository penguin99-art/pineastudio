import { NavLink, Outlet } from 'react-router-dom';
import { MessageSquare, Box, Cpu, Settings } from 'lucide-react';

const NAV = [
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/models', label: 'Models', icon: Box },
  { to: '/system', label: 'System', icon: Cpu },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export default function Layout() {
  return (
    <div className="flex h-screen">
      <aside className="w-48 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/50">
        <div className="px-4 py-4 text-lg font-semibold tracking-tight">
          PineaStudio
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 text-xs text-zinc-600">v0.1.0</div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
