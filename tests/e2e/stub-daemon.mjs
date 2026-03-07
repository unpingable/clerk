#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Stub governor daemon for E2E tests.
 *
 * Implements just enough JSON-RPC 2.0 over Content-Length framed stdio
 * to drive Clerk through smoke scenarios. Intentionally enforces the same
 * path invariants the real daemon would, so loosened client-side checks
 * don't silently pass.
 *
 * Profiles:
 *   strict     → blocks file.write.*
 *   production → allows all file ops
 *   research   → allows all, returns ask_gate_available for destructive
 *   permissive → allows all
 *
 * Special behaviors:
 *   - scope.check rejects absolute paths / ".." (mirrors real daemon)
 *   - intent.compile fails when E2E_COMPILE_FAIL env is set
 *   - Unknown RPC methods get a proper JSON-RPC -32601 error
 */

import path from 'node:path';
import fs from 'node:fs';

// Handle --version probe from daemon-resolver
if (process.argv.includes('--version')) {
  process.stdout.write('governor-stub 2.5.0\n');
  process.exit(0);
}

// Handle --help probe
if (process.argv.includes('--help')) {
  process.stdout.write('governor-stub: E2E test daemon\n');
  process.exit(0);
}

// --- JSON-RPC server over stdio ---

let activeProfile = 'production'; // default
let compileCount = 0;
let chatTurnCount = 0;
const scenario = process.env.E2E_CHAT_SCENARIO ?? '';

// Extract --root from argv for daemon.conf-aware model responses
const rootIdx = process.argv.indexOf('--root');
const governorDir = rootIdx !== -1 ? process.argv[rootIdx + 1] : null;

/** Read daemon.conf and determine if models should be returned. */
function shouldReturnModels() {
  if (!governorDir) return true; // backwards compat: no --root → return models
  const confPath = path.join(governorDir, 'daemon.conf');
  try {
    if (!fs.existsSync(confPath)) {
      // No daemon.conf: only return empty models if E2E_BACKEND_CHECK is set.
      // This preserves backward compat for all existing tests.
      return process.env.E2E_BACKEND_CHECK !== '1';
    }
    const raw = fs.readFileSync(confPath, 'utf-8');
    // Parse type
    const typeMatch = raw.match(/^type\s*=\s*(\S+)/m);
    if (!typeMatch) return false;
    const backendType = typeMatch[1];

    if (backendType === 'anthropic') {
      const keyMatch = raw.match(/^anthropic\.api_key\s*=\s*(\S+)/m);
      if (!keyMatch) return false;
      // bad-key → no models; anything starting with sk-ant → models
      if (keyMatch[1] === 'bad-key') return false;
      return true;
    }
    if (backendType === 'ollama') {
      const urlMatch = raw.match(/^ollama\.url\s*=\s*(\S+)/m);
      if (urlMatch && urlMatch[1].includes('badhost')) return false;
      return true;
    }
    // claude-code, codex
    if (process.env.E2E_CLI_ABSENT === '1') return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract contentHash from tool_results in a chat message.
 * Finds the last <tool_results>...</tool_results>, parses the JSON array,
 * and returns the contentHash from the first successful file_read result.
 */
function extractHashFromToolResults(content) {
  const lastOpen = content.lastIndexOf('<tool_results>');
  if (lastOpen === -1) throw new Error('No <tool_results> found in content');
  const close = content.indexOf('</tool_results>', lastOpen);
  if (close === -1) throw new Error('No </tool_results> found in content');
  const inner = content.slice(lastOpen + '<tool_results>'.length, close).trim();
  const results = JSON.parse(inner);
  const readResult = results.find(r => r.name === 'file_read' && r.ok === true);
  if (!readResult) throw new Error('No successful file_read result in tool_results');
  const hash = readResult.result?.contentHash;
  if (!hash) throw new Error('file_read result has no contentHash');
  return hash;
}

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf-8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf-8');
  process.stdout.write(Buffer.concat([header, body]));
}

function rpcError(id, code, message) {
  return send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  // Notifications (no id) — ignore
  if (id === undefined) return;

  switch (method) {
    case 'governor.hello':
      return send({ jsonrpc: '2.0', id, result: {
        governor: { context_id: 'e2e-ctx', mode: 'general', initialized: true },
      }});

    case 'governor.now':
      return send({ jsonrpc: '2.0', id, result: {
        pill: 'green', sentence: 'All clear', regime: 'normal',
      }});

    case 'governor.status':
      return send({ jsonrpc: '2.0', id, result: {
        mode: 'general', envelope: 'default', context_id: 'e2e-ctx',
        facts_count: 0, decisions_count: 0,
      }});

    case 'chat.models':
      if (shouldReturnModels()) {
        return send({ jsonrpc: '2.0', id, result: {
          models: [{ id: 'stub-model', name: 'Stub Model', backend: 'stub' }],
        }});
      }
      return send({ jsonrpc: '2.0', id, result: { models: [] } });

    case 'chat.stream': {
      chatTurnCount++;
      const messages = params?.messages ?? [];
      const lastUser = [...messages].reverse().find(m => m.role === 'user' || m.role === 'system');
      const content = lastUser?.content ?? '';

      // --- Scenario: ask_overwrite ---
      if (scenario === 'ask_overwrite') {
        if (content.includes('<tool_results>')) {
          // Turn 2+: after reading file, overwrite it with extracted hash
          try {
            const hash = extractHashFromToolResults(content);
            const resp = `Now I'll overwrite the file.\n<tool_calls>\n[{"id":"tc2","name":"file_write_overwrite","arguments":{"path":"target.txt","content":"updated by e2e","expected_hash":"${hash}"}}]\n</tool_calls>`;
            send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
            return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
          } catch {
            // Tool result wasn't a file_read — acknowledge and finish
            const resp = 'File operation complete.';
            send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
            return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
          }
        }
        // Turn 1: read the target file
        const resp = `Let me read the file first.\n<tool_calls>\n[{"id":"tc1","name":"file_read","arguments":{"path":"target.txt"}}]\n</tool_calls>`;
        send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
        return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
      }

      // --- Scenario: stop_loop ---
      if (scenario === 'stop_loop') {
        if (chatTurnCount === 1) {
          // Turn 1: list directory
          const resp = `Let me check what files are here.\n<tool_calls>\n[{"id":"tc1","name":"file_list","arguments":{"path":"."}}]\n</tool_calls>`;
          send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
          return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
        }
        if (chatTurnCount === 2) {
          // Turn 2: slow response — gives user time to click Stop
          await new Promise(resolve => setTimeout(resolve, 3000));
          const resp = `Now I'll organize the files.\n<tool_calls>\n[{"id":"tc2","name":"file_write_overwrite","arguments":{"path":"target.txt","content":"organized","expected_hash":"deadbeef"}}]\n</tool_calls>`;
          send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
          return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
        }
        // Turn 3+: should not reach
        const resp = 'Done organizing.';
        send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
        return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
      }

      // --- Scenario: hash_mismatch ---
      if (scenario === 'hash_mismatch') {
        if (content.includes('<tool_results>')) {
          const resp = 'The file operation failed due to a hash mismatch.';
          send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
          return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
        }
        // Turn 1: overwrite with wrong hash
        const resp = `I'll update the file.\n<tool_calls>\n[{"id":"tc1","name":"file_write_overwrite","arguments":{"path":"target.txt","content":"wrong content","expected_hash":"deadbeef0000000000000000000000000000000000000000000000000000dead"}}]\n</tool_calls>`;
        send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
        return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
      }

      // --- Scenario: grep_search ---
      if (scenario === 'grep_search') {
        if (content.includes('<tool_results>')) {
          const resp = 'I found the search results.';
          send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
          return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
        }
        // Turn 1: grep for a known string
        const resp = `Let me search for that.\n<tool_calls>\n[{"id":"tc1","name":"file_grep","arguments":{"query":"CANARY_STRING","path":"."}}]\n</tool_calls>`;
        send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
        return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
      }

      // --- Scenario: grep_invisible ---
      if (scenario === 'grep_invisible') {
        if (content.includes('<tool_results>')) {
          const resp = 'Search complete.';
          send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
          return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
        }
        // Turn 1: grep for a string that only exists in .clerk/ and node_modules/
        const resp = `Let me search for that.\n<tool_calls>\n[{"id":"tc1","name":"file_grep","arguments":{"query":"HIDDEN_CANARY","path":"."}}]\n</tool_calls>`;
        send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
        return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
      }

      // --- Scenario: patch_apply ---
      if (scenario === 'patch_apply') {
        if (content.includes('<tool_results>')) {
          try {
            const hash = extractHashFromToolResults(content);
            const patch = '@@ -1,1 +1,1 @@\\n-original content\\n+patched by e2e';
            const resp = `Now I'll patch the file.\n<tool_calls>\n[{"id":"tc2","name":"file_patch","arguments":{"path":"target.txt","expected_hash":"${hash}","patch":"${patch}"}}]\n</tool_calls>`;
            send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
            return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
          } catch {
            const resp = 'Patch complete.';
            send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
            return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
          }
        }
        // Turn 1: read the target file
        const resp = `Let me read the file first.\n<tool_calls>\n[{"id":"tc1","name":"file_read","arguments":{"path":"target.txt"}}]\n</tool_calls>`;
        send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
        return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
      }

      // --- Scenario: patch_fail ---
      if (scenario === 'patch_fail') {
        if (content.includes('<tool_results>')) {
          try {
            const hash = extractHashFromToolResults(content);
            // Patch with WRONG context — "wrong context here" doesn't match "original content"
            const patch = '@@ -1,1 +1,1 @@\\n-wrong context here\\n+patched';
            const resp = `I'll patch with wrong context.\n<tool_calls>\n[{"id":"tc2","name":"file_patch","arguments":{"path":"target.txt","expected_hash":"${hash}","patch":"${patch}"}}]\n</tool_calls>`;
            send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
            return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
          } catch {
            const resp = 'Patch failed.';
            send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
            return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
          }
        }
        // Turn 1: read the file first
        const resp = `Let me read the file.\n<tool_calls>\n[{"id":"tc1","name":"file_read","arguments":{"path":"target.txt"}}]\n</tool_calls>`;
        send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: resp } });
        return send({ jsonrpc: '2.0', id, result: { response: resp, receipt: null, violations: [] }});
      }

      // --- Default scenario (existing behavior) ---
      if (content.includes('<tool_results>')) {
        if (content.includes('"blocked":true') || content.includes('"ok":false')) {
          return send({ jsonrpc: '2.0', id, result: {
            response: 'That file operation was blocked by the current policy.',
            receipt: null, violations: [],
          }});
        }
        return send({ jsonrpc: '2.0', id, result: {
          response: 'File created successfully.',
          receipt: null, violations: [],
        }});
      }

      // Respond with a tool call to create a file
      const toolCallResponse = `I'll create a test file for you.\n<tool_calls>\n[{"id":"tc1","name":"file_write_create","arguments":{"path":"e2e-test-output.txt","content":"hello from e2e"}}]\n</tool_calls>`;

      send({ jsonrpc: '2.0', method: 'chat.delta', params: { content: toolCallResponse } });
      return send({ jsonrpc: '2.0', id, result: {
        response: toolCallResponse,
        receipt: null, violations: [],
      }});
    }

    case 'intent.schema':
      return send({ jsonrpc: '2.0', id, result: {
        schema_id: 'e2e-schema-1',
        template_name: params?.template_name ?? 'session_start',
        mode: 'general',
        policy: 'default',
        fields: [{ field_id: 'profile', widget: 'select', label: 'Profile', required: true,
          options: [
            { value: 'strict', label: 'Strict' },
            { value: 'production', label: 'Production' },
            { value: 'research', label: 'Research' },
            { value: 'permissive', label: 'Permissive' },
          ],
        }],
        escape_enabled: false,
      }});

    case 'intent.compile': {
      compileCount++;

      // Simulate compile failure when env flag is set
      // Fails on the Nth compile where N = E2E_COMPILE_FAIL_ON (1-indexed)
      const failOn = parseInt(process.env.E2E_COMPILE_FAIL_ON ?? '0', 10);
      if (failOn > 0 && compileCount === failOn) {
        return rpcError(id, -32000, 'Compile failed: backend timeout (simulated)');
      }

      const profile = params?.values?.profile ?? 'production';
      activeProfile = profile;
      return send({ jsonrpc: '2.0', id, result: {
        intent_profile: profile,
        intent_scope: null,
        intent_deny: null,
        intent_timebox_minutes: null,
        constraint_block: {
          constraints: [],
          content_hash: 'e2e-hash',
          compiled_at: new Date().toISOString(),
          intent: 'session_start',
          scope: [],
          mode: 'general',
          envelope: 'default',
          profile,
          exploratory_warning: false,
        },
        selected_branch: null,
        warnings: [],
        receipt_hash: 'e2e-receipt-' + Date.now(),
      }});
    }

    case 'scope.check': {
      const toolId = params?.tool_id ?? '';
      const resource = params?.scope?.resource ?? '';

      // Path policy — reject absolute paths and traversal even at daemon level
      if (resource) {
        const rel = path.relative(params?.scope?.project_root ?? '/', resource);
        if (path.isAbsolute(resource) && !resource.startsWith(params?.scope?.project_root ?? '')) {
          return send({ jsonrpc: '2.0', id, result: {
            allowed: false,
            reason: 'Path escapes project root.',
          }});
        }
        if (rel.startsWith('..')) {
          return send({ jsonrpc: '2.0', id, result: {
            allowed: false,
            reason: 'Path traversal is not allowed.',
          }});
        }
      }

      // Profile-based decisions
      if (activeProfile === 'strict' && toolId.startsWith('file.write')) {
        return send({ jsonrpc: '2.0', id, result: {
          allowed: false,
          reason: 'Write operations are blocked in strict mode.',
        }});
      }

      // Research profile: ask-gate for destructive/overwrite ops
      if (activeProfile === 'research' && (toolId === 'file.delete' || toolId === 'file.move' || toolId === 'file.write.overwrite' || toolId === 'file.patch')) {
        return send({ jsonrpc: '2.0', id, result: {
          allowed: false,
          reason: 'ASK_REQUIRED',
          ask_gate_available: true,
        }});
      }

      return send({ jsonrpc: '2.0', id, result: {
        allowed: true,
        reason: 'Allowed by policy.',
      }});
    }

    case 'receipts.list':
      return send({ jsonrpc: '2.0', id, result: [] });

    case 'receipts.detail':
      return rpcError(id, -32601, 'Not found');

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// --- Buffered Content-Length reader ---

let buffer = Buffer.alloc(0);

function tryParse() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const headerStr = buffer.subarray(0, headerEnd).toString('utf-8');
    const match = headerStr.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const messageEnd = bodyStart + contentLength;

    if (buffer.length < messageEnd) return;

    const body = buffer.subarray(bodyStart, messageEnd).toString('utf-8');
    buffer = buffer.subarray(messageEnd);

    try {
      handleRequest(JSON.parse(body));
    } catch (err) {
      process.stderr.write(`[stub-daemon] parse error: ${err}\n`);
    }
  }
}

process.stdin.on('data', (data) => {
  buffer = Buffer.concat([buffer, data]);
  tryParse();
});

process.stdin.on('end', () => process.exit(0));
process.stderr.write('[stub-daemon] started\n');
