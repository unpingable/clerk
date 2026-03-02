// SPDX-License-Identifier: Apache-2.0
/**
 * Template state store — constraint mode selection and application.
 * Svelte 5 runes mode. Must be .svelte.ts.
 */

import { api } from '$lib/api';
import type {
  ConstraintTemplate,
  TemplateState,
  TemplateApplyResult,
  CapabilityKey,
  CapabilityLevel,
} from '$shared/types';

// --- State ---

let templates = $state<ConstraintTemplate[]>([]);
let defaultTemplateId = $state('help_me_edit');
let selectedTemplateId = $state('help_me_edit');
let appliedTemplateId = $state('help_me_edit');
let applying = $state(false);
let lastError = $state<{ code: string; message: string } | undefined>(undefined);
let confirmingTemplateId = $state<string | null>(null);
let lastRequestId = $state<string | null>(null);

// --- Derived ---

const selectedTemplate = $derived(templates.find(t => t.id === selectedTemplateId));
const appliedTemplate = $derived(templates.find(t => t.id === appliedTemplateId));
const confirmingTemplate = $derived(
  confirmingTemplateId ? templates.find(t => t.id === confirmingTemplateId) : null,
);
const isConfirming = $derived(confirmingTemplateId !== null);

// --- Getters ---

export function getTemplates(): ConstraintTemplate[] { return templates; }
export function getDefaultTemplateId(): string { return defaultTemplateId; }
export function getSelectedTemplateId(): string { return selectedTemplateId; }
export function getAppliedTemplateId(): string { return appliedTemplateId; }
export function getSelectedTemplate(): ConstraintTemplate | undefined { return selectedTemplate; }
export function getAppliedTemplate(): ConstraintTemplate | undefined { return appliedTemplate; }
export function isApplying(): boolean { return applying; }
export function getLastError(): { code: string; message: string } | undefined { return lastError; }
export function getIsConfirming(): boolean { return isConfirming; }
export function getConfirmingTemplate(): ConstraintTemplate | null | undefined { return confirmingTemplate; }

// --- Capability labels ---

const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  read: 'Read files',
  write: 'Write files',
  execute: 'Run commands',
  network: 'Network access',
  destructive: 'Destructive actions',
};

const LEVEL_LABELS: Record<CapabilityLevel, string> = {
  allow: 'Allowed',
  ask: 'May ask first',
  deny: 'Blocked',
};

export function getCapabilityLabel(key: CapabilityKey): string {
  return CAPABILITY_LABELS[key];
}

export function getLevelLabel(level: CapabilityLevel): string {
  return LEVEL_LABELS[level];
}

// --- Actions ---

export async function initialize(): Promise<void> {
  try {
    const [listResult, stateResult] = await Promise.all([
      api.templatesList(),
      api.templatesCurrent(),
    ]);
    templates = listResult.templates;
    defaultTemplateId = listResult.defaultTemplateId;
    syncState(stateResult);
  } catch (err) {
    console.error('[template-store] initialize failed:', err);
  }
}

export function requestTemplate(id: string): void {
  const template = templates.find(t => t.id === id);
  if (!template) return;

  if (template.requiresConfirmation) {
    confirmingTemplateId = id;
  } else {
    applyTemplate(id);
  }
}

export function confirmTemplate(): void {
  if (!confirmingTemplateId) return;
  const id = confirmingTemplateId;
  confirmingTemplateId = null;
  applyTemplate(id, true);
}

export function cancelConfirmation(): void {
  confirmingTemplateId = null;
}

async function applyTemplate(id: string, confirmed?: boolean): Promise<void> {
  const requestId = crypto.randomUUID();
  lastRequestId = requestId;
  applying = true;
  selectedTemplateId = id;
  lastError = undefined;

  try {
    const result: TemplateApplyResult = await api.templatesApply({
      templateId: id,
      confirmed,
      requestId,
    });

    // Ignore stale responses
    if (lastRequestId !== requestId) return;

    syncState(result.state);
  } catch (err) {
    if (lastRequestId !== requestId) return;
    applying = false;
    lastError = { code: 'COMPILE_FAILED', message: String(err) };
  }
}

function syncState(state: TemplateState): void {
  selectedTemplateId = state.selectedTemplateId;
  appliedTemplateId = state.appliedTemplateId;
  applying = state.applying;
  lastError = state.lastError;
}
