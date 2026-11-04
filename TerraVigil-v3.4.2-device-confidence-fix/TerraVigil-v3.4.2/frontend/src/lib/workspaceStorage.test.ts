import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceStorage } from './workspaceStorage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workspace preferences with restricted browser storage', () => {
  it('keeps working when the storage getter throws', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('Storage access blocked');
      },
    });
    const name = 'blocked-storage';
    expect(workspaceStorage.getItem(name)).toBeNull();
    expect(() => workspaceStorage.setItem(name, 'new preference')).not.toThrow();
    expect(workspaceStorage.getItem(name)).toBe('new preference');
    workspaceStorage.removeItem(name);
    expect(workspaceStorage.getItem(name)).toBeNull();
  });

  it('retains updates and removals in memory when writes fail', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => 'old preference',
        setItem: () => {
          throw new Error('Storage quota exceeded');
        },
        removeItem: () => {
          throw new Error('Storage writes blocked');
        },
      },
    });
    const name = 'blocked-writes';
    expect(workspaceStorage.getItem(name)).toBe('old preference');
    workspaceStorage.setItem(name, 'updated preference');
    expect(workspaceStorage.getItem(name)).toBe('updated preference');
    workspaceStorage.removeItem(name);
    expect(workspaceStorage.getItem(name)).toBeNull();
  });
});
