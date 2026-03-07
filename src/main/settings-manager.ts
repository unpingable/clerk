// SPDX-License-Identifier: Apache-2.0
/**
 * SettingsManager — persists user preferences (e.g. friendly mode toggle).
 *
 * Works without the daemon — settings are per-user, not per-project.
 * Same DI pattern as TemplateManager for testability.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ClerkSettings {
  friendlyMode: boolean;
  theme: 'dark' | 'light';
}

interface SettingsFile {
  schemaVersion: number;
  settings: ClerkSettings;
}

const DEFAULTS: ClerkSettings = { friendlyMode: true, theme: 'dark' };

export interface SettingsManagerIO {
  readFileSync(path: string, encoding: 'utf-8'): string;
  writeFileSync(path: string, data: string): void;
  renameSync(src: string, dst: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string, opts: { recursive: boolean }): void;
  unlinkSync(path: string): void;
}

const defaultIO: SettingsManagerIO = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, d) => fs.writeFileSync(p, d),
  renameSync: (s, d) => fs.renameSync(s, d),
  existsSync: (p) => fs.existsSync(p),
  mkdirSync: (p, o) => fs.mkdirSync(p, o),
  unlinkSync: (p) => fs.unlinkSync(p),
};

export class SettingsManager {
  private settingsDir: string;
  private io: SettingsManagerIO;
  private current: ClerkSettings;

  constructor(settingsDir: string, io: SettingsManagerIO = defaultIO) {
    this.settingsDir = settingsDir;
    this.io = io;
    this.current = this.load();
  }

  private get persistPath(): string {
    return path.join(this.settingsDir, 'clerk-settings.json');
  }

  getAll(): ClerkSettings {
    return { ...this.current };
  }

  set(partial: Partial<ClerkSettings>): ClerkSettings {
    // Only merge known keys
    if (typeof partial.friendlyMode === 'boolean') {
      this.current.friendlyMode = partial.friendlyMode;
    }
    if (partial.theme === 'dark' || partial.theme === 'light') {
      this.current.theme = partial.theme;
    }
    this.persist();
    return { ...this.current };
  }

  private load(): ClerkSettings {
    try {
      if (!this.io.existsSync(this.persistPath)) return { ...DEFAULTS };

      const raw = this.io.readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(raw) as Partial<SettingsFile>;

      if (data.schemaVersion !== 1 || !data.settings || typeof data.settings !== 'object') {
        this.quarantineCorrupt();
        return { ...DEFAULTS };
      }

      return {
        friendlyMode: typeof data.settings.friendlyMode === 'boolean'
          ? data.settings.friendlyMode
          : DEFAULTS.friendlyMode,
        theme: data.settings.theme === 'dark' || data.settings.theme === 'light'
          ? data.settings.theme
          : DEFAULTS.theme,
      };
    } catch {
      // Corrupt JSON or read error
      this.quarantineCorrupt();
      return { ...DEFAULTS };
    }
  }

  private quarantineCorrupt(): void {
    try {
      if (!this.io.existsSync(this.persistPath)) return;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const corruptPath = `${this.persistPath}.corrupt-${ts}`;
      this.io.renameSync(this.persistPath, corruptPath);
    } catch {
      // Best effort
    }
  }

  private persist(): void {
    const dir = path.dirname(this.persistPath);
    if (!this.io.existsSync(dir)) {
      this.io.mkdirSync(dir, { recursive: true });
    }

    const data: SettingsFile = {
      schemaVersion: 1,
      settings: this.current,
    };

    const tmpPath = this.persistPath + '.tmp';
    this.io.writeFileSync(tmpPath, JSON.stringify(data, null, 2));

    // Windows-safe: unlink existing before rename
    try {
      if (this.io.existsSync(this.persistPath)) {
        this.io.unlinkSync(this.persistPath);
      }
    } catch {
      // Best effort
    }

    this.io.renameSync(tmpPath, this.persistPath);
  }
}
