// Exact-duplicate detection via content hash. Deterministic -- two files
// with the same SHA-256 are the same bytes, full stop. No model, no
// threshold, no precision/recall (this isn't a judgment call the way
// blur/screenshot/selfie are). Near-duplicate detection (pHash/embedding
// similarity) is a deliberately separate, deferred problem -- see
// docs/adr/007-cleanup-first-ai-direction.md and the cleanup v1 proposal.

export async function contentHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function groupExactDuplicates<T extends { id: string; content_hash: string }>(
  items: T[],
): Map<string, string[]> {
  const byHash = new Map<string, string[]>();
  for (const item of items) {
    const list = byHash.get(item.content_hash) ?? [];
    list.push(item.id);
    byHash.set(item.content_hash, list);
  }
  for (const [hash, ids] of byHash) if (ids.length < 2) byHash.delete(hash);
  return byHash;
}
