import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createTaskWorkspace, taskEnvironment } from './workspace.mjs';
import { sourceInventory } from './prepare-release.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = await createTaskWorkspace('notes-tests');
const copyRoot = path.join(workspace, 'project');
await fs.mkdir(copyRoot);
Object.assign(process.env, taskEnvironment(workspace));
// The same reviewed public-source allowlist is used for tests and release candidates.
const sourceFiles = await sourceInventory();
for (const entry of sourceFiles) {
  const destination = path.join(copyRoot, ...entry.path.split('/'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.join(appRoot, ...entry.path.split('/')), destination);
}
const tests = (await fs.readdir(path.join(copyRoot, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort();
console.log(`Independent test workspace: ${workspace}`);
await fs.writeFile(path.join(workspace, 'manifest.json'), JSON.stringify({ appRoot, copyRoot, tests, copied: sourceFiles, excludes: ['data', 'runtime', '_workspace', '成果产出'] }, null, 2));
const child = spawn(process.execPath, ['--test', ...tests.map(name => path.join(copyRoot, 'tests', name))], {
  cwd: copyRoot, env: { ...taskEnvironment(workspace), NOTES_WORKSPACE_ROOT: path.join(copyRoot, '_workspace', 'tasks') }, stdio: ['ignore', 'pipe', 'pipe']
});
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
await fs.writeFile(path.join(workspace, 'logs', 'test-output.log'), stdout + stderr);
await fs.writeFile(path.join(workspace, 'result.json'), JSON.stringify({ exitCode, testCount: tests.length, workspace }, null, 2));
process.exitCode = exitCode;
