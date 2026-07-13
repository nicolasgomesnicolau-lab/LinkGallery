const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const CONFIG_FILE = path.join(__dirname, 'config.json');

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return a === b;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function getAuthPassword(req) {
  return req.headers['x-auth-password'] || req.query.password || '';
}

// Client-side login overlay is used; no server-rendered login page.

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces))
    for (const iface of interfaces[name])
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  return 'localhost';
}

let config = { sourcePath: path.join(__dirname, 'uploads'), slideInterval: 3, password: '', passwordEnabled: false };
if (fs.existsSync(CONFIG_FILE)) {
  try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) }; } catch {}
}
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); }

const DB_FILE = path.join(__dirname, 'db.json');
let db = { favorites: [] };
if (fs.existsSync(DB_FILE)) { try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch {} }
// Normalize legacy favorites (may contain /source/ virtual paths)
if (Array.isArray(db.favorites)) {
  db.favorites = db.favorites.map(normalizeFavoritePath).filter(Boolean);
}
function saveDb() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

function normalizeFavoritePath(fp) {
  if (fp.indexOf('/source/') === 0) {
    const rel = decodeURIComponent(fp.replace(/^\/source\//, ''));
    return path.resolve(config.sourcePath, rel);
  }
  return path.resolve(fp);
}

function getValidFavorites() {
  return db.favorites.map(normalizeFavoritePath).filter(function(fp) {
    try { return fs.existsSync(fp); } catch { return false; }
  });
}

function ensureSource() {
  if (!fs.existsSync(config.sourcePath)) fs.mkdirSync(config.sourcePath, { recursive: true });
}

let galleryCache = null;
let cacheDirty = true;
function invalidateCache() { cacheDirty = true; galleryCache = null; }

const IMG_RE = /\.(jpg|jpeg|png|gif|webp|bmp|avif|heic|heif|tiff|tif)$/i;
const VID_RE = /\.(mp4|webm|avi|mov|mkv|flv|wmv|m4v|3gp)$/i;
const AUD_RE = /\.(mp3|wav|ogg|flac|m4a|aac|wma)$/i;
const MEDIA_RE = /\.(jpg|jpeg|png|gif|webp|bmp|avif|heic|heif|tiff|tif|mp4|webm|avi|mov|mkv|flv|wmv|m4v|3gp|mp3|wav|ogg|flac|m4a|aac|wma)$/i;

function scanImages(dir, relativePath) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return results; }
  entries.forEach(entry => {
    const full = path.join(dir, entry);
    let stat;
    try { stat = fs.statSync(full); } catch { return; }
    if (stat.isDirectory()) {
      results.push(...scanImages(full, relativePath ? relativePath + '/' + entry : entry));
    } else if (stat.isFile() && MEDIA_RE.test(entry)) {
      const safePath = encodeURI((relativePath ? relativePath + '/' + entry : entry).replace(/\\/g, '/'));
      let type = 'image';
      if (VID_RE.test(entry)) type = 'video';
      else if (AUD_RE.test(entry)) type = 'audio';
      results.push({
        path: '/source/' + safePath,
        absolutePath: path.resolve(dir, entry),
        folder: relativePath || 'geral',
        type: type
      });
    }
  });
  return results;
}

function scanDirs(dir, relativePath) {
  const dirs = [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return dirs; }
  entries.forEach(entry => {
    const full = path.join(dir, entry);
    let stat;
    try { stat = fs.statSync(full); } catch { return; }
    if (stat.isDirectory()) {
      dirs.push(relativePath ? relativePath + '/' + entry : entry);
      dirs.push(...scanDirs(full, relativePath ? relativePath + '/' + entry : entry));
    }
  });
  return dirs;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureSource();
    const folder = req.body.folderName || 'geral';
    const dir = path.join(config.sourcePath, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});
const upload = multer({ storage });

// Password login (JSON API, always before password middleware)
app.post('/login', loginLimiter, express.json(), (req, res) => {
  const sentPwd = req.body.password || '';
  const storedPwd = config.password || '';
  if (storedPwd && timingSafeEqual(sentPwd, storedPwd)) {
    res.json({ success: true });
  } else {
    res.status(403).json({ success: false, error: 'Senha incorreta' });
  }
});

// Public auth status (no password required)
app.get('/api/auth/status', (req, res) => {
  res.json({ passwordEnabled: config.passwordEnabled !== false });
});

// Logout (client-side clears sessionStorage; endpoint kept for API consistency)
app.post('/api/logout', (req, res) => {
  res.json({ success: true });
});

// No-cache for all HTML responses
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Password middleware: allow page through, block API without password
app.use((req, res, next) => {
  if (!config.passwordEnabled) return next();
  const storedPwd = config.password || '';
  if (storedPwd && timingSafeEqual(getAuthPassword(req), storedPwd)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Senha necessaria' });
  // Serve the app page; client-side login overlay handles auth
  next();
});

app.use(express.json());
app.use(express.static('public'));

app.use('/source', (req, res, next) => {
  ensureSource();
  const raw = req.url.replace(/^\//, '').split('?')[0];
  if (!raw) return next();
  const rel = decodeURIComponent(raw);
  const full = path.join(config.sourcePath, rel);
  const relCheck = path.relative(config.sourcePath, full);
  if (!relCheck.startsWith('..') && fs.existsSync(full) && fs.statSync(full).isFile()) {
    res.sendFile(full);
  } else {
    next();
  }
});

// Thumbnail route: serve resized images for the grid
app.use('/thumb', (req, res, next) => {
  ensureSource();
  const raw = req.url.replace(/^\//, '').split('?')[0];
  if (!raw) return next();
  const rel = decodeURIComponent(raw);
  const full = path.join(config.sourcePath, rel);
  const relCheck = path.relative(config.sourcePath, full);
  if (!relCheck.startsWith('..') && fs.existsSync(full) && fs.statSync(full).isFile()) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const ext = path.extname(full).toLowerCase();
    if (IMG_RE.test(ext)) {
      sharp(full).resize(400, 400, { fit: 'cover', withoutEnlargement: true }).toBuffer()
        .then(buf => { res.type(ext); res.send(buf); })
        .catch(() => res.sendFile(full));
    } else {
      res.sendFile(full);
    }
  } else {
    next();
  }
});

// Serve favorites by absolute path (cross-source)
app.get('/api/favfile', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  const normalized = normalizeFavoritePath(filePath);
  const validFavs = getValidFavorites();
  if (validFavs.indexOf(normalized) === -1) return res.status(403).json({ error: 'Not allowed' });
  if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
    res.sendFile(normalized);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ sourcePath: config.sourcePath, slideInterval: config.slideInterval, homeFolder: config.homeFolder || '', hasPassword: !!config.password, passwordEnabled: config.passwordEnabled !== false });
});
app.post('/api/config', (req, res) => {
  if (req.body.sourcePath) {
    const p = path.resolve(req.body.sourcePath);
    if (fs.existsSync(p)) { config.sourcePath = p; invalidateCache(); }
  }
  if (req.body.slideInterval != null) config.slideInterval = Math.max(0.1, Math.min(60, parseFloat(req.body.slideInterval) || 3));
  if (req.body.homeFolder !== undefined) config.homeFolder = req.body.homeFolder;
  if (req.body.password !== undefined) config.password = req.body.password;
  if (req.body.passwordEnabled !== undefined) config.passwordEnabled = !!req.body.passwordEnabled;
  saveConfig();
  const safeConfig = { success: true, sourcePath: config.sourcePath, slideInterval: config.slideInterval, homeFolder: config.homeFolder || '', hasPassword: !!config.password, passwordEnabled: config.passwordEnabled !== false };
  if (req.body.password !== undefined || req.body.passwordEnabled !== undefined) {
    safeConfig.relogin = true;
  }
  res.json(safeConfig);
});

// Browse folders
app.get('/api/browse', (req, res) => {
  const rp = req.query.path;
  if (!rp) {
    // Return drives on Windows
    const drives = [];
    for (let l = 65; l <= 90; l++) {
      const d = String.fromCharCode(l) + ':\\';
      try { if (fs.statSync(d).isDirectory()) drives.push({ name: d, path: d }); } catch {}
    }
    return res.json(drives);
  }
  let dir;
  try { dir = path.resolve(rp); } catch { return res.json([]); }
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return res.json([]); }
  const folders = [];
  entries.forEach(e => {
    const full = path.join(dir, e);
    let stat;
    try { stat = fs.statSync(full); } catch { return; }
    if (stat.isDirectory()) {
      folders.push({ name: e, path: full });
    }
  });
  folders.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
  res.json(folders);
});

app.get('/api/gallery', (req, res) => {
  const hasPage = req.query.page != null;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const folderFilter = req.query.folder ? decodeURIComponent(req.query.folder) : '';

  function buildResponse(allPhotos, folders) {
    let filtered = allPhotos;
    if (folderFilter) {
      filtered = allPhotos.filter(p => p.folder === folderFilter || p.folder.startsWith(folderFilter + '/'));
    }
    const total = filtered.length;
    const paged = hasPage ? filtered.slice((page - 1) * limit, (page - 1) * limit + limit) : filtered;
    return { folders, allPhotos: paged, total, page, limit, favorites: getValidFavorites() };
  }

  if (!cacheDirty && galleryCache) {
    return res.json(buildResponse(galleryCache.allPhotos, galleryCache.folders));
  }

  ensureSource();
  const allPhotos = scanImages(config.sourcePath, '');

  // Build folder tree + counts + audio pair map in ONE pass
  const folderCounts = {};
  const audioMap = {};
  const extRe = /\.(jpg|jpeg|png|gif|webp|bmp|avif|heic|heif|tiff|tif|mp4|webm|avi|mov|mkv|flv|wmv|m4v|3gp|mp3|wav|ogg|flac|m4a|aac|wma)$/i;
  function baseKey(p) {
    const name = decodeURIComponent(p.path.replace('/source/', '')).split('/').pop().replace(extRe, '').toLowerCase();
    return p.folder + '/' + name;
  }
  allPhotos.forEach(p => {
    const f = p.folder;
    folderCounts[f] = (folderCounts[f] || 0) + 1;
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      folderCounts[parent] = (folderCounts[parent] || 0) + 1;
    }
    if (p.type === 'audio') {
      audioMap[baseKey(p)] = p.path;
    }
  });

  // Filter out standalone audio, attach audioPath to matching images
  const filteredPhotos = [];
  allPhotos.forEach(p => {
    if (p.type === 'audio') return;
    const key = baseKey(p);
    if (audioMap[key]) p.audioPath = audioMap[key];
    filteredPhotos.push(p);
  });

  const allDirs = scanDirs(config.sourcePath, '');
  const seen = {};
  allDirs.forEach(d => { seen[d] = true; });
  if (fs.existsSync(config.sourcePath)) {
    const rootFiles = fs.readdirSync(config.sourcePath).filter(f => fs.statSync(path.join(config.sourcePath, f)).isFile() && MEDIA_RE.test(f));
    if (rootFiles.length > 0 || !seen['geral']) seen['geral'] = true;
  }

  // Build photoMap for cover selection (only first file per folder)
  const photoMap = {};
  filteredPhotos.forEach(p => {
    if (!photoMap[p.folder]) photoMap[p.folder] = [];
    if (photoMap[p.folder].length < 10) photoMap[p.folder].push(p.path);
  });

  const folders = Object.keys(seen).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map(name => {
    const files = photoMap[name] || [];
    const cover = files.length > 0 ? files[Math.floor(Math.random() * files.length)] : '';
    return { name, cover, count: folderCounts[name] || 0 };
  });

  const visibleFolders = folders.filter(f => f.name !== 'geral');

  galleryCache = { folders: visibleFolders, allPhotos: filteredPhotos };
  cacheDirty = false;

  res.json(buildResponse(filteredPhotos, visibleFolders));
});

app.post('/api/folder', (req, res) => {
  ensureSource();
  const name = req.body.name.replace(/[^a-zA-Z0-9_\- \/]/g, '').trim().replace(/\s+/g, '_').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  if (!name) return res.status(400).json({ error: 'Invalid folder name' });
  const dir = path.resolve(config.sourcePath, name);
  const relCheck = path.relative(config.sourcePath, dir);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return res.status(403).json({ error: 'Invalid folder name' });
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  invalidateCache();
  res.json({ success: true });
});

app.post('/api/folder/delete', (req, res) => {
  ensureSource();
  const name = req.body.name;
  if (!name || name === 'geral') return res.status(400).json({ error: 'Cannot delete root' });
  const dir = path.resolve(config.sourcePath, name);
  const relCheck = path.relative(config.sourcePath, dir);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return res.status(403).json({ error: 'Invalid path' });
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Folder not found' });
  const prefix = path.resolve(dir);
  db.favorites = db.favorites.map(normalizeFavoritePath).filter(f => !f.startsWith(prefix));
  saveDb();
  fs.rmSync(dir, { recursive: true, force: true });
  invalidateCache();
  res.json({ success: true });
});

app.post('/api/upload', upload.array('photos', 100), (req, res) => {
  invalidateCache();
  res.json({ success: true, files: req.files });
});

function resolveDeletePath(filePath) {
  if (filePath.indexOf('/source/') === 0) {
    const full = path.resolve(config.sourcePath, decodeURIComponent(filePath.replace(/^\/source\//, '')));
    const rel = path.relative(config.sourcePath, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return full;
  }
  return path.resolve(filePath);
}

app.post('/api/delete', (req, res) => {
  const filePath = req.body.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  const absolute = resolveDeletePath(filePath);
  if (!absolute) return res.status(403).json({ error: 'Invalid path' });
  if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
  const idx = db.favorites.indexOf(absolute);
  if (idx > -1) { db.favorites.splice(idx, 1); saveDb(); }
  invalidateCache();
  res.json({ success: true });
});

app.post('/api/delete/batch', (req, res) => {
  const paths = req.body.paths;
  if (!Array.isArray(paths)) return res.status(400).json({ error: 'Missing paths array' });
  let changed = false;
  paths.forEach(filePath => {
    const absolute = resolveDeletePath(filePath);
    if (!absolute) return;
    if (fs.existsSync(absolute)) { fs.unlinkSync(absolute); changed = true; }
    const idx = db.favorites.indexOf(absolute);
    if (idx > -1) { db.favorites.splice(idx, 1); changed = true; }
  });
  if (changed) saveDb();
  invalidateCache();
  res.json({ success: true, deleted: paths.length });
});

app.get('/api/network', (req, res) => {
  const ip = getLocalIP();
  res.json({ ip, port: PORT, url: `http://${ip}:${PORT}` });
});

app.post('/api/favorite', (req, res) => {
  const { photoPath } = req.body;
  if (!photoPath) return res.status(400).json({ error: 'Missing photoPath' });
  const absolute = normalizeFavoritePath(photoPath);
  const safeCheck = path.resolve(config.sourcePath);
  if (path.relative(safeCheck, absolute).startsWith('..') && absolute.indexOf(path.resolve(config.sourcePath)) !== 0) {
    const validFavs = getValidFavorites();
    if (validFavs.indexOf(absolute) === -1) return res.status(403).json({ error: 'Not allowed' });
  }
  const idx = db.favorites.indexOf(absolute);
  if (idx > -1) db.favorites.splice(idx, 1);
  else db.favorites.push(absolute);
  saveDb();
  res.json({ success: true, favorites: getValidFavorites() });
});

app.listen(PORT, () => {
  const ip = getLocalIP();
  console.log(`
╔══════════════════════════════════════════╗
║          ✦ LinkGallery ✦                ║
║                                          ║
║  PC:  http://localhost:${PORT}             ║
║  Cel: http://${ip}:${PORT}              ║
║                                          ║
║  Pasta: ${config.sourcePath}              ║
║                                          ║
╚══════════════════════════════════════════╝
  `);
});