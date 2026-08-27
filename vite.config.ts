import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/** 開発時のみ: ページから検証用スクリーンショットを保存するエンドポイント */
function debugSave(): Plugin {
  return {
    name: 'debug-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const name = (url.searchParams.get('name') || 'shot').replace(/[^a-z0-9_-]/gi, '');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          const dir = path.resolve(process.cwd(), '.debug');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, name + '.jpg'), Buffer.from(b64, 'base64'));
          res.statusCode = 200;
          res.end('ok');
        });
      });
    },
  };
}

/** LUMINA_SINGLE=1 のときは単一ファイル化のため全コードを1チャンクにまとめる */
const single = process.env.LUMINA_SINGLE === '1';

export default defineConfig({
  base: './',
  plugins: [debugSave()],
  server: {
    port: 5175,
    host: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    outDir: single ? 'dist-single' : 'dist',
    rollupOptions: single ? { output: { inlineDynamicImports: true } } : undefined,
  },
});
