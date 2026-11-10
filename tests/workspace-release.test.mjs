import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { APP_ROOT, assertWorkspacePath, createTaskWorkspace, taskEnvironment } from '../scripts/workspace.mjs';
import { SOURCE_DIRECTORIES, SOURCE_FILES, ALLOWLIST_PATH, sourceInventory } from '../scripts/prepare-release.mjs';

async function syntheticSource(root, extraFiles = []) {
  await fs.mkdir(root);
  for (const directory of SOURCE_DIRECTORIES) await fs.mkdir(path.join(root, directory));
  for (const filename of [...SOURCE_FILES, ...extraFiles]) {
    await fs.mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await fs.writeFile(path.join(root, filename), `synthetic public file ${filename}\n`);
  }
  await fs.writeFile(path.join(root, ALLOWLIST_PATH), JSON.stringify({ format: 'notes-source-allowlist-v1', files: [...SOURCE_FILES, ALLOWLIST_PATH, ...extraFiles] }));
}

test('workspace rejects outside paths, invalid labels and linked directories before writing', async t => {
  const workspace = await createTaskWorkspace('workspace-boundary');
  assert.ok(path.relative(path.join(APP_ROOT, '_workspace'), workspace).length > 0);
  assert.throws(() => assertWorkspacePath(path.dirname(APP_ROOT)), /inside/);
  assert.throws(() => assertWorkspacePath(path.join(APP_ROOT, '_workspace-other', 'task')), /inside/);
  await assert.rejects(createTaskWorkspace('../bad'), /label/);
  const previous = process.env.NOTES_WORKSPACE_ROOT;
  try {
    process.env.NOTES_WORKSPACE_ROOT = path.join(APP_ROOT, '..', '_workspace');
    await assert.rejects(createTaskWorkspace('outside'), /inside/);
  } finally {
    if (previous === undefined) delete process.env.NOTES_WORKSPACE_ROOT; else process.env.NOTES_WORKSPACE_ROOT = previous;
  }
  const linked = path.join(workspace, 'linked');
  try { await fs.symlink(path.join(workspace, 'tmp'), linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.diagnostic('OS did not allow link creation; lexical boundary checks passed.'); return; } throw error; }
  assert.throws(() => assertWorkspacePath(path.join(linked, 'child')), /symlinks|junctions/);
});

test('task cache and temporary environment stay inside the validated workspace', async () => {
  const workspace = await createTaskWorkspace('workspace-environment');
  const environment = taskEnvironment(workspace);
  for (const key of ['TMP', 'TEMP', 'TMPDIR', 'XDG_CACHE_HOME', 'npm_config_cache', 'NODE_COMPILE_CACHE', 'PLAYWRIGHT_BROWSERS_PATH', 'NOTES_TEST_ARTIFACTS']) {
    const relative = path.relative(workspace, environment[key]);
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), key);
  }
});

test('release allowlist excludes private roots and rejects nested environment files', async () => {
  const workspace = await createTaskWorkspace('release-fixture');
  const root = path.join(workspace, 'fixture');
  await syntheticSource(root, ['src/public.js']);
  for (const directory of ['data', 'runtime', '_workspace', '成果产出']) {
    await fs.mkdir(path.join(root, directory));
    await fs.writeFile(path.join(root, directory, 'private.json'), '{"syntheticPrivate":true}');
  }
  await fs.writeFile(path.join(root, '.env'), 'SYNTHETIC_SECRET=never-copy');
  const entries = await sourceInventory(root);
  assert.equal(entries.length, SOURCE_FILES.length + 2);
  assert.ok(entries.every(entry => !entry.path.startsWith('data/') && !entry.path.startsWith('runtime/') && !entry.path.startsWith('_workspace/') && !entry.path.startsWith('成果产出/') && entry.path !== '.env'));
  assert.match(entries.find(entry => entry.path === 'src/public.js').sha256, /^[a-f0-9]{64}$/);
  await fs.writeFile(path.join(root, 'src', '.env.local'), 'SYNTHETIC_SECRET=reject');
  await assert.rejects(sourceInventory(root), /Private or generated/);
});

test('release refuses an unlisted JSON file even inside a public source directory', async () => {
  const workspace = await createTaskWorkspace('release-unlisted');
  const root = path.join(workspace, 'fixture');
  await syntheticSource(root, ['src/public.js']);
  await fs.writeFile(path.join(root, 'src', 'notebook.json'), '{"syntheticPrivate":"must not be published"}');
  await assert.rejects(sourceInventory(root), /Unlisted source file: src\/notebook\.json/);
});

test('release rejects symlinked source entries', async t => {
  const workspace = await createTaskWorkspace('release-symlink');
  const root = path.join(workspace, 'fixture');
  await syntheticSource(root);
  const target = path.join(workspace, 'private');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'note.md'), 'Synthetic private fixture; never real notes.\n');
  try { await fs.symlink(target, path.join(root, 'src', 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('OS did not allow test symlink creation.'); return; } throw error; }
  await assert.rejects(sourceInventory(root), /symlinks|junctions/);
});
