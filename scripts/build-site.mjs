import { cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const assetsSource = path.join(root, 'assets');
const assetsOutput = path.join(root, 'dist', 'assets');

await build({ configFile: path.join(root, 'vite.config.js'), root });
await cp(assetsSource, assetsOutput, { recursive: true, force: true });
