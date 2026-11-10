import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createAppServer } from '../../src/server.mjs';
import { createTaskWorkspace, taskEnvironment } from '../../scripts/workspace.mjs';
import { createNotebookFixture } from '../fixtures/notebook.mjs';

// This server uses synthetic fixtures and never reads the personal data directory.
export async function startQaServer(label = 'notes-browser-qa') {
  const workspace = await createTaskWorkspace(label);
  Object.assign(process.env, taskEnvironment(workspace));
  process.chdir(workspace);
  const dataDir = path.join(workspace, 'data');
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, 'seed.json'), JSON.stringify(createNotebookFixture(), null, 2));
  const port = Number(process.env.NOTES_QA_PORT ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('NOTES_QA_PORT must be between 0 and 65535.');
  const { server, store } = createAppServer({ dataDir });
  await store.initialize();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
  return { server, url, workspace, dataDir, close };
}

export async function runQaServer(label) {
  const qa = await startQaServer(label);
  console.log(JSON.stringify({ url: qa.url, workspace: qa.workspace, dataDir: qa.dataDir }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => qa.close().then(() => process.exit(0)));
  return qa;
}
