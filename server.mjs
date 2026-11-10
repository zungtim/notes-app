// Compatibility entry for older commands; implementation lives in src/.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from './src/server.mjs';
export * from './src/server.mjs';
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  startServer().catch(error => { console.error(error.message); process.exitCode = 1; });
}
