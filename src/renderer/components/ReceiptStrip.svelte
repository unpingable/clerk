<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Inline receipt hash + verdict badge shown under chat messages. -->
<script lang="ts">
  import type { ReceiptRef } from '$shared/types';
  import { truncateHash } from '$lib/format';

  let { receipt }: { receipt: ReceiptRef } = $props();

  const verdictClass = $derived(
    receipt.verdict === 'pass' || receipt.verdict === 'allow' ? 'pass' :
    receipt.verdict === 'warn' ? 'warn' :
    receipt.verdict === 'block' ? 'block' : ''
  );
</script>

<div class="strip">
  <span class="hash" title={receipt.hash}>
    receipt: {truncateHash(receipt.hash, 12)}
  </span>
  <span class="verdict {verdictClass}">
    {receipt.verdict === 'pass' || receipt.verdict === 'allow' ? '\u2713' : receipt.verdict === 'block' ? '\u2717' : '\u26A0'}
    {receipt.verdict}
  </span>
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
  }
  .hash {
    opacity: 0.7;
  }
  .verdict {
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .pass { color: var(--clerk-pass); }
  .warn { color: var(--clerk-warn); }
  .block { color: var(--clerk-block); }
</style>
