const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { marked } = require('marked');

const root = path.resolve(__dirname, '..');
const postDir = path.join(root, 'source', '_posts');
const draftDir = path.join(root, 'source', '_drafts');
const imageDir = path.join(root, 'source', 'images');
const port = 4173;
const host = '127.0.0.1';
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
let publish = { running: false, state: 'idle', log: '', finishedAt: null };

function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

async function jsonBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12_000_000) throw new Error('提交内容过大');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('请求格式不正确'); }
}

function locate(id) {
  const match = String(id).match(/^(draft|post):([^<>:"/\\|?*\x00-\x1f]+\.md)$/u);
  if (!match || match[2].includes('..')) throw new Error('文章编号无效');
  return { kind: match[1], name: match[2], file: path.join(match[1] === 'draft' ? draftDir : postDir, match[2]) };
}

function parsePost(raw) {
  const match = raw.replace(/^\uFEFF/, '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return { meta: {}, content: raw };
  return { meta: yaml.load(match[1]) || {}, content: raw.slice(match[0].length) };
}

function normalize(data) {
  const title = String(data.title || '').trim();
  const content = String(data.content || '').replace(/\r\n/g, '\n');
  const category = String(data.category || '').trim();
  const tags = Array.isArray(data.tags) ? data.tags.map(x => String(x).trim()).filter(Boolean).slice(0, 12) : [];
  if (!title || title.length > 120) throw new Error('标题应为 1–120 个字');
  if (content.length > 500_000) throw new Error('正文超过 50 万字');
  if (category.length > 60 || tags.some(x => x.length > 40)) throw new Error('分类或标签过长');
  return { title, content, category, tags };
}

function localDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
}

function serialize(meta, content) {
  return `---\n${yaml.dump(meta, { lineWidth: -1, noRefs: true })}---\n\n${content.trimEnd()}\n`;
}

async function readPost(id) {
  const location = locate(id);
  const { meta, content } = parsePost(await fs.readFile(location.file, 'utf8'));
  return {
    id, status: location.kind, title: String(meta.title || location.name.replace(/\.md$/i, '')),
    date: meta.date instanceof Date ? meta.date.toISOString() : String(meta.date || ''),
    category: Array.isArray(meta.categories) ? String(meta.categories[0] || '') : String(meta.categories || ''),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [], content,
  };
}

async function listPosts() {
  await fs.mkdir(draftDir, { recursive: true });
  const drafts = (await fs.readdir(draftDir)).filter(x => x.endsWith('.md'));
  const published = (await fs.readdir(postDir)).filter(x => x.endsWith('.md') && !drafts.includes(x));
  const ids = [...drafts.map(x => `draft:${x}`), ...published.map(x => `post:${x}`)];
  const posts = await Promise.all(ids.map(async id => {
    const post = await readPost(id);
    return { id: post.id, title: post.title, date: post.date, category: post.category, status: post.status };
  }));
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

async function savePost(id, body) {
  const data = normalize(body);
  let meta;
  if (id) {
    const previous = locate(id);
    meta = parsePost(await fs.readFile(previous.file, 'utf8')).meta;
    id = `draft:${previous.name}`;
  } else {
    const slug = data.title.replace(/[<>:"/\\|?*\x00-\x1f]/gu, '').replace(/\s+/gu, '-').slice(0, 45) || 'article';
    id = `draft:${localDate().slice(0, 10)}-${slug}-${crypto.randomBytes(3).toString('hex')}.md`;
    meta = { date: localDate() };
  }
  meta.title = data.title;
  meta.categories = data.category ? [data.category] : [];
  meta.tags = data.tags;
  await fs.mkdir(draftDir, { recursive: true });
  const destination = locate(id).file;
  const temporary = `${destination}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temporary, serialize(meta, data.content), 'utf8');
  try { await fs.rename(temporary, destination); } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
  return readPost(id);
}

async function preparePublication(id) {
  const location = locate(id);
  if (location.kind === 'post') return id;
  const target = path.join(postDir, location.name);
  await fs.copyFile(location.file, target);
  await fs.unlink(location.file);
  return `post:${location.name}`;
}

async function uploadImage(body) {
  const mime = String(body.mime || '');
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mime];
  if (!ext) throw new Error('只支持 PNG、JPG、WebP 或 GIF 图片');
  const data = String(body.data || '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('图片格式不正确');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > 8_000_000) throw new Error('图片大小必须小于 8 MB');
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await fs.mkdir(imageDir, { recursive: true });
  await fs.writeFile(path.join(imageDir, name), bytes, { flag: 'wx' });
  return `/images/${name}`;
}

function addLog(text) {
  publish.log = (publish.log + text).slice(-20_000);
}

function startPublish() {
  if (publish.running) return false;
  publish = { running: true, state: 'running', log: '', finishedAt: null };
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools', 'deploy.ps1')], { cwd: root, windowsHide: true });
  child.stdout.on('data', chunk => addLog(chunk.toString('utf8')));
  child.stderr.on('data', chunk => addLog(chunk.toString('utf8')));
  child.on('error', error => { addLog(error.message); publish.running = false; publish.state = 'error'; publish.finishedAt = Date.now(); });
  child.on('close', code => {
    publish.running = false;
    publish.state = code === 0 ? 'success' : 'error';
    publish.finishedAt = Date.now();
  });
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const authority = req.headers.host || '';
    if (authority !== `${host}:${port}` && authority !== `localhost:${port}`) return send(res, 403, { error: '仅允许本机访问' });
    const url = new URL(req.url, `http://${authority}`);
    if (staticFiles[url.pathname] && req.method === 'GET') {
      const [file, mime] = staticFiles[url.pathname];
      const content = await fs.readFile(path.join(__dirname, file));
      res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      return res.end(content);
    }
    const imageMatch = url.pathname.match(/^\/images\/([a-zA-Z0-9-]+\.(?:png|jpg|webp|gif))$/);
    if (imageMatch && req.method === 'GET') {
      const extension = path.extname(imageMatch[1]).slice(1);
      const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[extension];
      const content = await fs.readFile(path.join(imageDir, imageMatch[1]));
      res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' });
      return res.end(content);
    }
    if (url.pathname.startsWith('/api/') && !['GET', 'POST', 'PUT'].includes(req.method)) return send(res, 405, { error: '不支持的操作' });
    if (req.method !== 'GET' && url.pathname.startsWith('/api/')) {
      if (req.headers['x-maple-editor'] !== '1' || (req.headers.origin && ![`http://${host}:${port}`, `http://localhost:${port}`].includes(req.headers.origin))) {
        return send(res, 403, { error: '请求来源无效' });
      }
    }
    if (url.pathname === '/api/posts' && req.method === 'GET') return send(res, 200, { posts: await listPosts() });
    if (url.pathname === '/api/posts' && req.method === 'POST') return send(res, 201, { post: await savePost(null, await jsonBody(req)) });
    const postMatch = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (postMatch && req.method === 'GET') return send(res, 200, { post: await readPost(decodeURIComponent(postMatch[1])) });
    if (postMatch && req.method === 'PUT') return send(res, 200, { post: await savePost(decodeURIComponent(postMatch[1]), await jsonBody(req)) });
    if (url.pathname === '/api/preview' && req.method === 'POST') {
      const body = await jsonBody(req);
      return send(res, 200, { html: marked.parse(String(body.content || '').slice(0, 500_000), { gfm: true, breaks: true }) });
    }
    if (url.pathname === '/api/images' && req.method === 'POST') return send(res, 201, { url: await uploadImage(await jsonBody(req)) });
    if (url.pathname === '/api/publish' && req.method === 'POST') {
      if (publish.running) return send(res, 409, { error: '网站正在发布中' });
      const body = await jsonBody(req);
      const id = await preparePublication(body.id);
      startPublish();
      return send(res, 202, { publish, id });
    }
    if (url.pathname === '/api/publish' && req.method === 'GET') return send(res, 200, { publish });
    send(res, 404, { error: '页面不存在' });
  } catch (error) {
    send(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message || '操作失败' });
  }
});

server.listen(port, host, () => console.log(`Maple Leaves editor: http://${host}:${port}/`));
