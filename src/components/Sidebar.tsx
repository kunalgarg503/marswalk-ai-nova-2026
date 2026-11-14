import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  Compass,
  Database,
  Globe2,
  HeartPulse,
  Microscope,
  Mountain,
  Route,
} from 'lucide-react';
import type { NavSection } from '../types/mars';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeLocationName: string;
  activeRouteSafety: number;
  highHazardCount: number;
  onRouteHighCritCount?: number;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof Activity }> = [
  { id: 'mission-control', label: 'Mission Control', icon: Activity },
  { id: 'mars-explorer', label: 'Mars Explorer', icon: Globe2 },
  { id: 'terrain-intelligence', label: 'Terrain Intelligence', icon: Mountain },
  { id: 'hazard-detection', label: 'Hazard Detection', icon: AlertTriangle },
  { id: 'route-planner', label: 'Smart Route Planner', icon: Route },
  { id: 'science-explorer', label: 'Science Explorer', icon: Microscope },
  { id: 'survival-calculator', label: 'Survival Calculator', icon: HeartPulse },
  { id: 'nasa-data-centre', label: 'NASA Data Centre', icon: Database },
  { id: 'mission-assistant', label: 'Mission Assistant', icon: Bot },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  collapsed,
  onToggleCollapse,
  activeLocationName,
  activeRouteSafety,
  highHazardCount,
  onRouteHighCritCount = 0,
}: SidebarProps) {
  return (
    <aside
      className={`flex flex-col border-r border-white/10 bg-[#0A0C11] transition-all duration-200 shrink-0 ${
        collapsed ? 'w-[68px]' : 'w-[256px]'
      }`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-white/10">
        {!collapsed ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded bg-[#E85D2A]/15 border border-[#E85D2A]/40 flex items-center justify-center shrink-0">
              <Compass className="w-4 h-4 text-[#E85D2A]" />
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold text-sm tracking-wider text-white truncate">
                MARSWALK AI
              </div>
              <div className="text-[10px] font-mono text-slate-400 truncate">
                Space Apps 2026
              </div>
            </div>
          </div>
        ) : (
          <div className="w-7 h-7 mx-auto rounded bg-[#E85D2A]/15 border border-[#E85D2A]/40 flex items-center justify-center">
            <Compass className="w-4 h-4 text-[#E85D2A]" />
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`p-1.5 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E85D2A] ${
            collapsed ? 'hidden md:hidden' : ''
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          className="mx-auto mt-2 p-1.5 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Navigation Links */}
      <nav aria-label="Mission sections" className="flex-1 overflow-y-auto py-3 px-2.5 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-left text-[13px] font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E85D2A] ${
                active
                  ? 'bg-[#E85D2A]/15 text-white border border-[#E85D2A]/40'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <Icon
                className={`w-4 h-4 shrink-0 ${active ? 'text-[#E85D2A]' : 'text-slate-500'}`}
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Active Sector Telemetry Summary */}
      {!collapsed && (
        <div className="p-3.5 border-t border-white/10 bg-[#080A0F] space-y-2 text-xs">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Active Traverse Context
          </div>
          <div className="text-slate-200 font-medium truncate">{activeLocationName}</div>
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Safety Score</span>
            <span className="text-white font-semibold tabular-nums">{activeRouteSafety}/100</span>
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>On Active Route</span>
            <span className={onRouteHighCritCount > 0 ? 'text-red-400 font-semibold tabular-nums' : 'text-emerald-400 tabular-nums'}>
              {onRouteHighCritCount} Crit/High
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>25km Region Map</span>
            <span className={highHazardCount > 0 ? 'text-amber-300 font-semibold tabular-nums' : 'text-emerald-400 tabular-nums'}>
              {highHazardCount} Crit/High
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
