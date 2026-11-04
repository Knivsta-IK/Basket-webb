import { mergeDiff3 } from 'node-diff3';
export const REPO = 'Knivsta-IK/Basket';
const ROOT = `https://api.github.com/repos/${REPO}`;
export const MAX_SIZE = 5 * 1024 * 1024;
export const utf8 = new TextEncoder();
export const text = bytes => new TextDecoder().decode(bytes);
export function encode(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export const decode = value => Uint8Array.from(atob(value.replace(/\s/g, '')), c => c.charCodeAt(0));
export const validPath = path => typeof path === 'string' && !!path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'));
export const isMarkdown = path => /\.(md|markdown)$/i.test(path);
export const isExercise = path => /^(ovningar|övningar)\//i.test(path) && isMarkdown(path);
export const titleOf = (path, content = '') => content.match(/^#\s+(.+)$/m)?.[1] || path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
export function mergeText(local, base, remote) {
  const result = mergeDiff3(local.split('\n'), base.split('\n'), remote.split('\n'), { label: { a: 'Din version', o: 'Ursprunglig version', b: 'Sparad version' } });
  return { conflict: result.conflict, text: result.result.join('\n') };
}
export class GitHub {
  constructor(token, name = '') { this.token = token; this.authorName = name.trim().replace(/\s+/g, ' '); }
  async request(path, options = {}) {
    const response = await fetch(`${ROOT}${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
    if (!response.ok) {
      const messages = { 401: 'Åtkomsten behöver förnyas. Kontakta ansvarig.', 403: 'Du saknar behörighet, eller har gjort för många förfrågningar. Försök igen senare eller kontakta ansvarig.', 404: 'Materialet är inte tillgängligt just nu. Kontakta ansvarig.', 409: 'Materialet har ändrats. Försök spara igen.', 422: 'Det gick inte att spara. Materialet kan ha ändrats under tiden.' };
      const error = new Error(messages[response.status] || 'Materialet kunde inte hämtas. Kontrollera anslutningen och försök igen.');
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  async snapshot() {
    const ref = await this.request(`/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const commit = await this.request(`/git/commits/${ref.object.sha}`);
    const tree = await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('Biblioteket är för stort. Be föreningens administratör om hjälp.');
    return { head: ref.object.sha, tree: commit.tree.sha, directories: tree.tree.filter(f => f.type === 'tree' && validPath(f.path)).map(f => f.path), files: tree.tree.filter(f => f.type === 'blob' && validPath(f.path)).map(f => ({ ...f, exercise: isExercise(f.path) })) };
  }
  async load() {
    const repository = await this.request('');
    this.branch = repository.default_branch;
    const snapshot = await this.snapshot();
    this.current = snapshot;
    return snapshot.files;
  }
  async read(file) {
    if (file.size > MAX_SIZE) throw new Error('Filen är större än 5 MB och kan inte öppnas här.');
    const blob = await this.request(`/git/blobs/${file.sha}`);
    return decode(blob.content);
  }
  async save(changes, message, resolveConflict) {
    if (!message.trim()) throw new Error('Beskriv vad du har ändrat.');
    if (!changes.length || changes.some(c => !validPath(c.path))) throw new Error('Ge filen ett giltigt namn.');
    if (changes.some(c => c.bytes.length > MAX_SIZE)) throw new Error('Varje fil får vara högst 5 MB.');
    changes = changes.map(c => ({ ...c }));
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await this.snapshot();
      for (const change of changes) {
        const remote = latest.files.find(f => f.path === change.path);
        if ((remote?.sha || null) === (change.baseSha || null)) continue;
        const baseBytes = change.baseSha ? await this.read({ sha: change.baseSha }) : new Uint8Array();
        const remoteBytes = remote ? await this.read(remote) : new Uint8Array();
        if (isMarkdown(change.path) && change.baseSha && remote) {
          const merged = mergeText(text(change.bytes), text(baseBytes), text(remoteBytes));
          if (!merged.conflict) change.bytes = utf8.encode(merged.text);
          else change.bytes = await resolveConflict({ path: change.path, local: change.bytes, base: baseBytes, remote: remoteBytes, markdown: true });
        } else {
          change.bytes = await resolveConflict({ path: change.path, local: change.bytes, base: baseBytes, remote: remoteBytes, markdown: isMarkdown(change.path), deleted: !remote });
        }
        if (!change.bytes) throw new Error('Sparningen avbröts. Dina ändringar finns kvar.');
        change.baseSha = remote?.sha || null;
      }
      const entries = [];
      for (const change of changes) {
        const blob = await this.request('/git/blobs', { method: 'POST', body: JSON.stringify({ content: encode(change.bytes), encoding: 'base64' }) });
        entries.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const tree = await this.request('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: latest.tree, tree: entries }) });
      const author = this.authorName ? { name: this.authorName, email: `${this.authorName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'anvandare'}@material.invalid` } : undefined;
      const commit = await this.request('/git/commits', { method: 'POST', body: JSON.stringify({ message: message.trim(), tree: tree.sha, parents: [latest.head], ...(author ? { author, committer: author } : {}) }) });
      try {
        await this.request(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
        return commit;
      } catch (error) {
        if (![409, 422].includes(error.status) || attempt === 2) throw error;
      }
    }
  }
}
