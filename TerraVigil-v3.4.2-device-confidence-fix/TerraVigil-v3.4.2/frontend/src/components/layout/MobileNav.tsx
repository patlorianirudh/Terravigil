import React, { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, MoreHorizontal, Radio, Target, Map as MapIcon, X } from 'lucide-react';

import { MOBILE_OVERFLOW, type NavEntry } from './navItems';

const PRIMARY: NavEntry[] = [
  { to: '/', label: 'Ops', icon: Activity },
  { to: '/live', label: 'Live', icon: Radio },
  { to: '/detections', label: 'Detections', icon: Target },
  { to: '/risk-map', label: 'Risk map', icon: MapIcon },
];

/**
 * Phone navigation: four destinations plus an overflow sheet. Four is a
 * deliberate cap — a bottom bar with eleven targets is a menu, not navigation,
 * and every target here is ≥44px so it can actually be hit with a thumb.
 */
export const MobileNav: React.FC = () => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.activeElement;
    const targets = () => sheetRef.current?.querySelectorAll<HTMLElement>('button,a[href]');
    targets()?.[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetOpen(false);
      if (event.key !== 'Tab') return;
      const elements = targets();
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [sheetOpen]);

  return (
    <>
      <nav
        aria-label="Primary"
        className="mobile-bottom-inset flex shrink-0 items-stretch justify-around border-t border-border bg-surface px-1 pt-1 sm:hidden"
      >
        {PRIMARY.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] transition-colors duration-hover ease-out active:scale-95 ${
                  isActive ? 'bg-accent/10 text-accent-bright' : 'text-text-secondary'
                }`
              }
            >
              <Icon className="size-[18px]" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setSheetOpen(true);
          }}
          aria-expanded={sheetOpen}
          className="flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] text-text-secondary transition-colors duration-hover ease-out active:scale-95"
        >
          <MoreHorizontal className="size-[18px]" />
          <span>More</span>
        </button>
      </nav>

      {sheetOpen && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label="More destinations"
          className="fixed inset-0 z-50 flex animate-fade-in flex-col justify-end bg-background/70 p-2 sm:hidden"
          onClick={() => {
            setSheetOpen(false);
          }}
        >
          <div
            className="glass-strong animate-rise-in rounded-xl p-3"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="type-eyebrow">Go to</p>
              <button
                type="button"
                onClick={() => {
                  setSheetOpen(false);
                }}
                aria-label="Close"
                className="grid size-9 place-items-center rounded-lg text-text-muted transition-colors duration-hover ease-out hover:bg-surface-hover/70 hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>

            <ul className="grid grid-cols-2 gap-1.5">
              {MOBILE_OVERFLOW.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => {
                        setSheetOpen(false);
                      }}
                      className={({ isActive }) =>
                        `flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] transition-colors duration-hover ease-out ${
                          isActive
                            ? 'bg-accent/10 text-accent-bright'
                            : 'bg-surface-sunken/60 text-text-secondary active:bg-surface-hover'
                        }`
                      }
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
};
