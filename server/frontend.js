import express from 'express';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const frontendDirectory = fileURLToPath(new URL('../frontend/dist/', import.meta.url));
export function registerFrontend(app, directory = frontendDirectory) {
    const indexFile = join(directory, 'index.html');
    if (!existsSync(indexFile)) {
        if (process.env.NODE_ENV === 'production') throw new Error('React build missing: run npm run build from the repository root');
        return; // Local Vite development can run without a production build.
    }
    app.use(express.static(directory, { index: false, redirect: false, dotfiles: 'deny' }));
    app.get('/{*path}', (req, res, next) => {
        // Missing assets/files are real 404s; nested SPA URLs can be refreshed.
        if (req.path.split('/').some(segment => segment.startsWith('.')) || extname(req.path) || req.path.startsWith('/assets/') || !req.accepts('html')) return next();
        res.sendFile(indexFile, { headers: { 'Cache-Control': 'no-store' } });
    });
    app.use((req, res) => res.status(404).type('text').send('Not found'));
}
