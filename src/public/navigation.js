import { frameworkScopeOptions, frameworkScopeForNote, frameworkView } from './framework.js';

const pages = new Set(['home', 'all', 'questions', 'review']);
const home = () => ({ view: 'home', topicId: null, scope: null, noteId: null });

export function parseRoute(hash) {
  const [pathname, query = ''] = String(hash || '').replace(/^#\/?/, '').split('?');
  let parts;
  try { parts = pathname.split('/').map(decodeURIComponent); } catch { return home(); }
  const view = parts[0] || 'home';
  if (pages.has(view)) return { ...home(), view };
  if (view !== 'topic' || !parts[1]) return home();
  return { view, topicId: parts[1], noteId: parts[2] === 'note' ? parts[3] || null : null,
    scope: new URLSearchParams(query).get('scope') || null };
}

export function routeHash(route) {
  if (route.view !== 'topic') return `#/${pages.has(route.view) ? route.view : 'home'}`;
  const path = `#/topic/${encodeURIComponent(route.topicId)}${route.noteId ? `/note/${encodeURIComponent(route.noteId)}` : ''}`;
  return path + (route.scope && route.scope !== 'overview' ? `?scope=${encodeURIComponent(route.scope)}` : '');
}

// Old topic links open the overview. Old note links infer their containing
// module; explicit valid scopes are kept when the note is visible there.
export function resolveRoute(route, notebook) {
  if (route.view !== 'topic') return { ...home(), view: pages.has(route.view) ? route.view : 'home' };
  if (!notebook.topics.some(topic => topic.id === route.topicId)) return home();
  const notes = notebook.notes.filter(note => note.topicId === route.topicId);
  const links = notebook.links.filter(link => link.topicId === route.topicId);
  const scopes = frameworkScopeOptions(notes, links);
  const noteId = notes.some(note => note.id === route.noteId) ? route.noteId : null;
  let scope = route.scope && Object.hasOwn(scopes, route.scope) ? route.scope : 'overview';
  if (noteId && !frameworkView(notes, links, scope).notes.some(note => note.id === noteId)) {
    const inferred = frameworkScopeForNote(noteId, notes, links);
    scope = Object.hasOwn(scopes, inferred) ? inferred : 'overview';
  }
  return { view: 'topic', topicId: route.topicId, scope, noteId };
}

// location.hash creates native history entries and emits hashchange. Replaying
// an entry only reads it. No popstate listener is needed for hash-only writes.
export function createHashNavigation({ readHash, setHash, replaceHash, getNotebook, applyRoute,
  isBlocked = () => false, onBlocked = () => {}, beforeNavigate = () => {} }) {
  let appliedHash = null;
  let pending = false;
  function restore({ force = false } = {}) {
    if (isBlocked()) { pending = true; onBlocked(); return false; }
    const route = resolveRoute(parseRoute(readHash()), getNotebook());
    const hash = routeHash(route);
    // Only canonicalize missing/invalid route state, never a blocked traversal.
    if (readHash() !== hash) replaceHash(hash);
    pending = false;
    if (!force && appliedHash === hash) return false;
    appliedHash = hash;
    applyRoute(route);
    return true;
  }
  return {
    restore,
    navigate(target) {
      if (isBlocked()) { onBlocked(); return false; }
      const hash = routeHash(resolveRoute(target, getNotebook()));
      beforeNavigate();
      if (readHash() === hash) return restore();
      setHash(hash);
      return true;
    },
    // Keep the old editor alive until uploaded Markdown has reached its note.
    // Read the latest browser target, including back/forward during the upload.
    resume() { return pending && !isBlocked() ? restore() : false; }
  };
}
