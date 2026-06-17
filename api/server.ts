/**
 * local server entry file, for local development
 */
import app from './app.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// NODE_ENV 默认值兜底，兼容未设置 cross-env 的场景（直接 tsx api/server.ts 也能跑）
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

/**
 * start server with port
 */
const PORT = Number(process.env.PORT) || (process.env.NODE_ENV === 'production' ? 3000 : 3001);

const server = app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server ready on port ${PORT} (NODE_ENV=${process.env.NODE_ENV})`);
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, '..', 'dist');
    const hasDist = fs.existsSync(distPath);
    if (hasDist) {
      console.log(`[${new Date().toISOString()}] Production mode: static serve OK (${distPath}) → http://localhost:${PORT}`);
    } else {
      console.log(`[${new Date().toISOString()}] ⚠️  Production mode: dist/ not found at ${distPath}`);
      console.log(`[${new Date().toISOString()}]    Run "npm run build" first, then "npm start"`);
    }
  } else {
    console.log(`[${new Date().toISOString()}] Dev mode: API on http://localhost:${PORT} , UI via Vite (separate process)`);
  }
});

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;