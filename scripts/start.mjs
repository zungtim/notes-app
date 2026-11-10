import { createTaskWorkspace, taskEnvironment } from './workspace.mjs';

try {
  const workspace = await createTaskWorkspace('notes-runtime');
  Object.assign(process.env, taskEnvironment(workspace));
  const { startServer } = await import('../src/server.mjs');
  await startServer();
} catch (error) {
  console.error(`启动失败：${error.message}`);
  process.exitCode = 1;
}
