import { useState, useEffect } from 'react';
import { RefreshCw, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { api, type SystemInfo, type BackendInfo } from '../api/client';

export default function System() {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [backends, setBackends] = useState<BackendInfo[]>([]);

  const refresh = () => {
    api.system().then(setSys);
    api.backends().then(setBackends);
  };

  useEffect(() => { refresh(); }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">System</h1>
        <button onClick={refresh} className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800">
          <RefreshCw size={15} />
        </button>
      </div>

      {sys && (
        <div className="px-6 space-y-4">
          {/* GPU */}
          {sys.gpus.length > 0 && (
            <Section title="GPU">
              {sys.gpus.map((g) => (
                <div key={g.index} className="flex items-center gap-4">
                  <Cpu size={15} className="text-zinc-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-300">{g.name}</div>
                    <Bar used={g.memory_used_mb} total={g.memory_total_mb} color="emerald" />
                  </div>
                  <span className="text-xs text-zinc-500 shrink-0">{g.utilization_pct}% util</span>
                </div>
              ))}
            </Section>
          )}

          {/* Memory */}
          <Section title="Memory">
            <div className="flex items-center gap-4">
              <MemoryStick size={15} className="text-zinc-500 shrink-0" />
              <div className="flex-1">
                <Bar used={sys.memory_used_mb} total={sys.memory_total_mb} color="blue" />
              </div>
            </div>
          </Section>

          {/* Disk */}
          <Section title="Disk">
            <div className="flex items-center gap-4">
              <HardDrive size={15} className="text-zinc-500 shrink-0" />
              <div className="flex-1">
                <Bar
                  used={Math.round((sys.disk_total_gb - sys.disk_free_gb) * 1024)}
                  total={Math.round(sys.disk_total_gb * 1024)}
                  color="amber"
                  displayGB
                />
              </div>
            </div>
          </Section>

          {/* CPU */}
          <Section title="CPU">
            <div className="text-sm text-zinc-400">{sys.cpu_count} cores</div>
          </Section>

          {/* Backends */}
          <Section title="Backends">
            {backends.length === 0 ? (
              <div className="text-sm text-zinc-500">No backends registered</div>
            ) : (
              <div className="space-y-2">
                {backends.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-3 py-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
                    <div className={`w-2 h-2 rounded-full ${b.healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-300">{b.id}</div>
                      <div className="text-xs text-zinc-600">{b.type} · {b.base_url}</div>
                    </div>
                    <span className="text-xs text-zinc-500">{b.model_count} models</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 space-y-3">
      <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  );
}

function Bar({
  used, total, color, displayGB,
}: {
  used: number; total: number; color: string; displayGB?: boolean;
}) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const fmt = (v: number) => displayGB ? `${(v / 1024).toFixed(1)} GB` : `${(v / 1024).toFixed(1)} GB`;
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-600',
    blue: 'bg-blue-600',
    amber: 'bg-amber-600',
  };

  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-500 mb-1">
        <span>{fmt(used)} / {fmt(total)}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colors[color] || 'bg-zinc-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
