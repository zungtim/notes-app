import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { APP_ROOT, createTaskWorkspace, assertWorkspacePath, taskEnvironment } from './workspace.mjs';

export const SOURCE_DIRECTORIES = ['src', 'scripts', 'tests', 'config', 'docs'];
export const SOURCE_FILES = ['.gitattributes', '.gitignore', 'AGENTS.md', 'README.md', 'package.json', 'server.mjs', 'launch.ps1', 'stop.ps1', '启动笔记.cmd', '停止笔记.cmd'];
export const ALLOWLIST_PATH = 'config/release-files.json';
const privateNames = new Set(['data', 'runtime', '_workspace', '成果产出', '.dev-workspace', 'test-artifacts', 'node_modules', '.git', '.aws', '.codex', '.agents', 'coverage']);
const allowedExtensions = new Set(['.mjs', '.js', '.css', '.html', '.svg', '.json', '.md', '.ps1', '.cmd']);

function checkSourceName(relative) {
  for (const part of relative.split('/')) {
    if (privateNames.has(part.toLowerCase()) || /^\.env(?:\.|$)/i.test(part) || /(?:\.pem|\.key|\.pfx|\.p12|\.log|\.tmp|\.bak)$/i.test(part)) {
      throw new Error(`Private or generated file is not releasable: ${relative}`);
    }
  }
}

export async function sourceInventory(root = APP_ROOT) {
  const entries = [];
  for (const directory of SOURCE_DIRECTORIES) {
    const stat = await fs.lstat(path.join(root, directory));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Invalid source directory: ${directory}`);
  }
  const allowlistFile = path.join(root, ...ALLOWLIST_PATH.split('/'));
  const allowlistStat = await fs.lstat(allowlistFile);
  if (!allowlistStat.isFile() || allowlistStat.isSymbolicLink()) throw new Error('Release allowlist must be a regular file.');
  const allowlist = JSON.parse(await fs.readFile(allowlistFile, 'utf8'));
  if (allowlist?.format !== 'notes-source-allowlist-v1' || !Array.isArray(allowlist.files) || allowlist.files.length === 0) throw new Error('Invalid release allowlist format.');
  const allowed = new Set();
  const caseInsensitive = new Set();
  for (const relative of allowlist.files) {
    if (typeof relative !== 'string' || !relative || /[\\:\x00-\x1f]/.test(relative) || path.posix.isAbsolute(relative) || path.posix.normalize(relative) !== relative || relative.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid path in release allowlist.');
    if (!SOURCE_FILES.includes(relative) && !SOURCE_DIRECTORIES.some(directory => relative.startsWith(`${directory}/`))) throw new Error(`Release allowlist path is outside public sources: ${relative}`);
    checkSourceName(relative);
    if (caseInsensitive.has(relative.toLowerCase())) throw new Error(`Duplicate path in release allowlist: ${relative}`);
    allowed.add(relative);
    caseInsensitive.add(relative.toLowerCase());
  }
  for (const required of [...SOURCE_FILES, ALLOWLIST_PATH]) if (!allowed.has(required)) throw new Error(`Required public file is missing from release allowlist: ${required}`);
  async function visit(relative) {
    checkSourceName(relative);
    const absolute = path.join(root, ...relative.split('/'));
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Source symlinks and junctions are not releasable: ${relative}`);
    if (stat.isDirectory()) {
      if (![...allowed].some(filename => filename.startsWith(`${relative}/`))) throw new Error(`Unlisted source directory: ${relative}`);
      for (const name of (await fs.readdir(absolute)).sort()) await visit(`${relative}/${name}`);
    } else if (stat.isFile()) {
      if (!allowed.has(relative)) throw new Error(`Unlisted source file: ${relative}`);
      if (!SOURCE_FILES.includes(relative) && !allowedExtensions.has(path.extname(relative).toLowerCase())) throw new Error(`Unreviewed source file type: ${relative}`);
      const content = await fs.readFile(absolute);
      entries.push({ path: relative, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
    } else throw new Error(`Unsupported source entry: ${relative}`);
  }
  // Validate every entry before any candidate file is copied.
  for (const directory of SOURCE_DIRECTORIES) {
    for (const name of (await fs.readdir(path.join(root, directory))).sort()) await visit(`${directory}/${name}`);
  }
  for (const name of SOURCE_FILES) await visit(name);
  for (const filename of allowed) if (!entries.some(entry => entry.path === filename)) throw new Error(`Allowlisted source file is missing: ${filename}`);
  return entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export async function prepareRelease() {
  const entries = await sourceInventory();
  const workspace = await createTaskWorkspace('notes-release');
  Object.assign(process.env, taskEnvironment(workspace));
  const output = assertWorkspacePath(path.join(workspace, 'source'));
  await fs.mkdir(output);
  for (const entry of entries) {
    const source = path.join(APP_ROOT, ...entry.path.split('/'));
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Source changed while preparing release: ${entry.path}`);
    const bytes = await fs.readFile(source);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Source changed while preparing release: ${entry.path}`);
    const target = path.join(output, ...entry.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' });
    const copied = await fs.readFile(target);
    if (createHash('sha256').update(copied).digest('hex') !== entry.sha256) throw new Error(`Release hash mismatch: ${entry.path}`);
  }
  const manifest = { format: 'notes-source-release-v1', createdAt: new Date().toISOString(), allowlist: ALLOWLIST_PATH, includes: entries.map(entry => entry.path), excludes: [...privateNames, '.env*', 'personal recording rules'], fileCount: entries.length, files: entries };
  await fs.writeFile(path.join(workspace, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { workspace, output, fileCount: entries.length, manifest: path.join(workspace, 'manifest.json') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error('prepare-release takes no path arguments; output is always inside this app _workspace.');
  console.log(JSON.stringify(await prepareRelease(), null, 2));
}
