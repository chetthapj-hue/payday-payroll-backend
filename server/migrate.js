import { readFile, readdir } from 'node:fs/promises';
import { pool } from './db.js';
try {
  const directory = new URL('./migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await pool.query(await readFile(new URL(name,directory),'utf8'));
    console.log(`Applied ${name}`);
  }
} finally { await pool.end(); }
