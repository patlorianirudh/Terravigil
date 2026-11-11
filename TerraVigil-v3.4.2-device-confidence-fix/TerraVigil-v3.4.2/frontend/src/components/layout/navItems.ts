import type React from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  Cpu,
  FileText,
  FolderArchive,
  Gauge,
  Map as MapIcon,
  Radio,
  Route,
  Settings,
  Target,
  Presentation,
  Cloud,
} from 'lucide-react';

export interface NavEntry {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * The navigation model, in one place, so the desktop rail and the phone bar
 * cannot drift apart. Labels name what the operator does, not how the system is
 * built — and none of them uses the word "safe" (P-20.14): the route planner is
 * a planning aid over an incomplete survey, and saying otherwise is the single
 * highest-severity wording failure this product has.
 */
export const NAV_GROUPS: { heading: string; items: NavEntry[] }[] = [
  {
    heading: 'Workspace',
    items: [
      { to: '/', label: 'Operations', icon: Activity },
      { to: '/connections', label: 'Firebase & telemetry', icon: Cloud },
      { to: '/live', label: 'Live console', icon: Radio },
      { to: '/live-preview', label: 'Live preview', icon: Gauge },
      { to: '/sessions', label: 'Scan sessions', icon: FolderArchive },
    ],
  },
  {
    heading: 'Intelligence',
    items: [
      { to: '/detections', label: 'Detections', icon: Target },
      { to: '/risk-map', label: 'Risk map', icon: MapIcon },
      { to: '/route', label: 'Route planner', icon: Route },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/reports', label: 'Reports', icon: FileText },
      { to: '/assistant', label: 'Field copilot', icon: Bot },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { to: '/briefing', label: 'Project briefing', icon: Presentation },
      { to: '/system', label: 'System health', icon: Cpu },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

/** Everything the phone bar's four primary tabs do not already cover. */
const PRIMARY_PATHS = new Set(['/', '/live', '/detections', '/risk-map']);

export const MOBILE_OVERFLOW: NavEntry[] = NAV_GROUPS.flatMap((g) => g.items).filter(
  (item) => !PRIMARY_PATHS.has(item.to),
);
