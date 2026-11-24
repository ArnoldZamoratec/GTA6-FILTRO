import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = await realpath(fileURLToPath(new URL('./dist/', import.meta.url)));
const port = Number(process.env.PORT || 8080);
const types = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.webmanifest':'application/manifest+json', '.json':'application/json', '.wasm':'application/wasm',
  '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.txt':'text/plain; charset=utf-8'
};
const server = createServer(async (req, res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const entry = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
    const file = await realpath(path.resolve(root, '.' + entry));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, {
      'Content-Type':types[path.extname(file)] || 'application/octet-stream',
      'Content-Length':info.size,
      'X-Content-Type-Options':'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const source = createReadStream(file);
    source.on('error',() => res.destroy());
    res.on('close',() => source.destroy());
    source.pipe(res);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && port !== 0) { server.listen(0,'127.0.0.1'); return; }
  console.error('No se pudo iniciar ViceLens.', error.message);
  process.exitCode = 1;
});
server.on('listening', () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  console.log('Abre ' + url + ' en tu navegador. Presiona Ctrl+C para cerrar.');
  if (process.platform === 'win32' && process.argv.includes('--abrir')) {
    const opener = spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore'});
    opener.on('error', () => console.log('Abre el enlace de arriba en tu navegador.'));
    opener.unref();
  }
});
server.listen(port,'127.0.0.1');
