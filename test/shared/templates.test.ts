// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  getTemplateById,
  getDefaultTemplate,
} from '../../src/shared/templates';
import type { CapabilityKey } from '../../src/shared/types';

const CAPABILITY_KEYS: CapabilityKey[] = ['read', 'write', 'execute', 'network', 'destructive'];

describe('BUILTIN_TEMPLATES', () => {
  it('has 4 templates', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(4);
  });

  it('all have unique IDs', () => {
    const ids = BUILTIN_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all have required fields', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.version).toBe('1.0.0');
      expect(t.origin).toBe('builtin');
      expect(t.description).toBeTruthy();
      expect(typeof t.requiresConfirmation).toBe('boolean');
      expect(t.governorProfile).toBeTruthy();
    }
  });

  it('all have valid capability maps', () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const key of CAPABILITY_KEYS) {
        expect(['allow', 'ask', 'deny']).toContain(t.capabilities[key]);
      }
    }
  });

  it('only unrestricted requires confirmation', () => {
    for (const t of BUILTIN_TEMPLATES) {
      if (t.id === 'unrestricted') {
        expect(t.requiresConfirmation).toBe(true);
      } else {
        expect(t.requiresConfirmation).toBe(false);
      }
    }
  });

  it('look_around is read-only', () => {
    const t = getTemplateById('look_around')!;
    expect(t.capabilities.read).toBe('allow');
    expect(t.capabilities.write).toBe('deny');
    expect(t.capabilities.execute).toBe('deny');
    expect(t.capabilities.network).toBe('deny');
    expect(t.capabilities.destructive).toBe('deny');
  });

  it('help_me_edit allows read, asks for write, maps to production profile', () => {
    const t = getTemplateById('help_me_edit')!;
    expect(t.capabilities.read).toBe('allow');
    expect(t.capabilities.write).toBe('ask');
    expect(t.capabilities.execute).toBe('deny');
    expect(t.governorProfile).toBe('production');
  });

  it('take_the_wheel allows read/write/execute, asks for network/destructive, maps to research profile', () => {
    const t = getTemplateById('take_the_wheel')!;
    expect(t.capabilities.read).toBe('allow');
    expect(t.capabilities.write).toBe('allow');
    expect(t.capabilities.execute).toBe('allow');
    expect(t.capabilities.network).toBe('ask');
    expect(t.capabilities.destructive).toBe('ask');
    expect(t.governorProfile).toBe('research');
  });

  it('all profiles are valid daemon profiles', () => {
    const DAEMON_PROFILES = ['strict', 'permissive', 'research', 'production', 'audit'];
    for (const t of BUILTIN_TEMPLATES) {
      expect(DAEMON_PROFILES).toContain(t.governorProfile);
    }
  });

  it('unrestricted allows everything', () => {
    const t = getTemplateById('unrestricted')!;
    for (const key of CAPABILITY_KEYS) {
      expect(t.capabilities[key]).toBe('allow');
    }
  });
});

describe('getTemplateById', () => {
  it('returns template for valid ID', () => {
    expect(getTemplateById('help_me_edit')?.id).toBe('help_me_edit');
  });

  it('returns undefined for unknown ID', () => {
    expect(getTemplateById('nonexistent')).toBeUndefined();
  });
});

describe('getDefaultTemplate', () => {
  it('returns help_me_edit', () => {
    expect(getDefaultTemplate().id).toBe('help_me_edit');
  });

  it('DEFAULT_TEMPLATE_ID matches', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe('help_me_edit');
    expect(getDefaultTemplate().id).toBe(DEFAULT_TEMPLATE_ID);
  });
});
