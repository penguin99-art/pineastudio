import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  MessageCircle, Brain, Mic, Radio, FlaskConical, Box, Cpu, Settings,
  ChevronDown, Sparkles, Film,
} from 'lucide-react';

const ASSISTANT = [
  { to: '/', label: '对话', icon: MessageCircle, end: true },
  { to: '/memory', label: '记忆', icon: Brain },
] as const;

const SHOWCASE = [
  { to: '/showcase/omni', label: 'Omni', icon: Mic },
  { to: '/showcase/realtime', label: 'Realtime', icon: Radio },
  { to: '/showcase/video', label: '视频生成', icon: Film },
] as const;

const STUDIO = [
  { to: '/studio/chat', label: 'Playground', icon: FlaskConical },
  { to: '/studio/models', label: '模型管理', icon: Box },
  { to: '/studio/system', label: '系统监控', icon: Cpu },
  { to: '/studio/settings', label: '设置', icon: Settings },
] as const;

type NavItem = { to: string; label: string; icon: React.ComponentType<{ size?: number }>; end?: boolean };

function DropdownGroup({
  label,
  items,
  icon: GroupIcon,
  defaultOpen,
}: {
  label: string;
  items: readonly NavItem[];
  icon: React.ComponentType<{ size?: number }>;
  defaultOpen?: boolean;
}) {
  const location = useLocation();
  const isGroupActive = items.some((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
  );
  const [open, setOpen] = useState(defaultOpen || isGroupActive);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors w-full ${
          isGroupActive
            ? 'bg-zinc-800 text-white'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
        }`}
      >
        <GroupIcon size={16} />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown
          size={14}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {items.map(({ to, label: itemLabel, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                }`
              }
            >
              <Icon size={14} />
              {itemLabel}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  return (
    <div className="flex h-screen">
      <aside className="w-48 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/50">
        <div className="px-4 py-4 text-lg font-semibold tracking-tight flex items-center gap-2">
          <Sparkles size={18} className="text-blue-400" />
          PineaStudio
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          <DropdownGroup label="助理" items={ASSISTANT} icon={MessageCircle} defaultOpen />
          <DropdownGroup label="展示台" items={SHOWCASE} icon={Radio} />
          <DropdownGroup label="工作台" items={STUDIO} icon={FlaskConical} />
        </nav>
        <div className="px-4 py-3 text-xs text-zinc-600">v0.1.0</div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
