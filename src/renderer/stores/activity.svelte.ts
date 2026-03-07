// SPDX-License-Identifier: Apache-2.0
/** Activity feed store — tracks file ops & mode changes. */

import { api } from '$lib/api';
import type { ActivityEvent, ActivityFilter } from '$shared/types';

let events = $state<ActivityEvent[]>([]);
let filter = $state<ActivityFilter>('all');
let loading = $state(false);

export function getEvents(): ActivityEvent[] {
  return events;
}

export function getFilter(): ActivityFilter {
  return filter;
}

export function isLoading(): boolean {
  return loading;
}

export function getFilteredEvents(): ActivityEvent[] {
  const f = filter;
  const all = events;
  if (f === 'all') return all;
  if (f === 'blocked') return all.filter((e) => !e.allowed);
  if (f === 'writes') return all.filter((e) => e.kind.startsWith('file_write'));
  return all;
}

export function getBlockedCount(): number {
  return events.filter(e => !e.allowed).length;
}

export function setFilter(f: ActivityFilter): void {
  filter = f;
}

export async function loadEvents(): Promise<void> {
  loading = true;
  try {
    const result = await api.activityList(200);
    events = result.events;
  } catch (err) {
    console.error('[activity] load failed:', err);
  } finally {
    loading = false;
  }
}

/** Called from App.svelte when a live event arrives via IPC. */
export function onEvent(event: ActivityEvent): void {
  // Upsert-by-id: ActivityManager sets id=correlationId for correlated events,
  // so matching on id catches both fresh inserts and upsert broadcasts.
  const idx = events.findIndex(e => e.id === event.id);
  if (idx !== -1) {
    events = [...events.slice(0, idx), event, ...events.slice(idx + 1)];
    return;
  }
  // Prepend (newest first) and cap at 500
  events = [event, ...events].slice(0, 500);
}
