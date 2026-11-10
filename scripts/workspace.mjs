import { promises as fs, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.join(APP_ROOT, '_workspace');

function inside(root, target, allowRoot = false) {
  const relative = path.relative(root, target);
  return (allowRoot && relative === '') || (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// Validate before creating anything, including existing parent junctions/symlinks.
export function assertWorkspacePath(target, { allowRoot = false } = {}) {
  const resolved = path.resolve(target);
  if (!inside(workspaceRoot, resolved, allowRoot)) throw new Error('Workspace path must stay inside this app _workspace directory.');
  const rootReal = realpathSync(APP_ROOT);
  const segments = path.relative(APP_ROOT, resolved).split(path.sep).filter(Boolean);
  let current = APP_ROOT;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try { stat = lstatSync(current); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Workspace symlinks and junctions are not allowed.');
    if (!stat.isDirectory()) throw new Error('Workspace path contains a non-directory.');
    if (!inside(rootReal, realpathSync(current))) throw new Error('Resolved workspace path escapes this app.');
  }
  return resolved;
}

export async function createTaskWorkspace(label = 'notes-test') {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(label)) throw new Error('Invalid task label.');
  const base = assertWorkspacePath(process.env.NOTES_WORKSPACE_ROOT || path.join(workspaceRoot, 'tasks'));
  await fs.mkdir(base, { recursive: true });
  assertWorkspacePath(base);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}-${randomUUID().slice(0, 8)}`;
  const workspace = assertWorkspacePath(path.join(base, name));
  await fs.mkdir(workspace);
  for (const part of ['tmp', 'cache', 'logs', 'artifacts']) await fs.mkdir(path.join(workspace, part));
  assertWorkspacePath(workspace);
  return workspace;
}
export function taskEnvironment(workspace) {
  workspace = assertWorkspacePath(workspace);
  const cache = path.join(workspace, 'cache');
  for (const relative of ['tmp', 'cache', 'cache/npm', 'cache/node', 'cache/playwright', 'cache/python', 'cache/pip', 'cache/matplotlib', 'cache/jupyter', 'artifacts']) {
    assertWorkspacePath(path.join(workspace, ...relative.split('/')));
  }
  return {
    ...process.env,
    TMP: path.join(workspace, 'tmp'), TEMP: path.join(workspace, 'tmp'), TMPDIR: path.join(workspace, 'tmp'),
    XDG_CACHE_HOME: cache, npm_config_cache: path.join(cache, 'npm'),
    NODE_COMPILE_CACHE: path.join(cache, 'node'), PLAYWRIGHT_BROWSERS_PATH: path.join(cache, 'playwright'),
    PYTHONPYCACHEPREFIX: path.join(cache, 'python'), PIP_CACHE_DIR: path.join(cache, 'pip'),
    MPLCONFIGDIR: path.join(cache, 'matplotlib'), JUPYTER_RUNTIME_DIR: path.join(cache, 'jupyter'),
    NOTES_TEST_ARTIFACTS: path.join(workspace, 'artifacts'), CODEX_TASK_WORKDIR: workspace
  };
}
