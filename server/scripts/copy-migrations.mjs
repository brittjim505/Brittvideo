import { cpSync } from 'node:fs';
// Non-TypeScript files the compiled server needs at runtime.
cpSync('src/migrations', 'dist/migrations', { recursive: true });
cpSync('src/modules/migration/prototype-defaults.json', 'dist/modules/migration/prototype-defaults.json');
