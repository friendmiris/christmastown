// 크리스마스 마을 - 실시간 서버 (Railway 등 Node 호스팅용)
// 환경변수: PORT(자동), ADMIN_KEY(관리자 비밀번호), DATA_DIR(소원 저장 폴더, 볼륨 경로)
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000, ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'data.json'), MAX_WISHES = 500, WARM_N = 10;
let db = { wishes: [], scores: {}, seen: {}, total: 0 };
try { fs.mkdirSync(DATA_DIR, { recursive: true }); db = Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {}
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(FILE + '.tmp', JSON.stringify(db), err => { if (!err) fs.rename(FILE + '.tmp', FILE, () => {}); }), 400); };
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const num = (v, a, b) => { v = +v; return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : 0; };
const HTML = path.join(__dirname, 'index.html');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url === '/' || url === '/index.html') return fs.readFile(HTML, (e, buf) => { if (e) { res.writeHead(500); return res.end('index.html missing'); } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(buf); });
  res.writeHead(404); res.end('not found');
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const clients = new Map();
const sendTo = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cast = (o, except) => { const s = JSON.stringify(o); for (const c of clients.values()) if (c.ws !== except && c.ws.readyState === 1) c.ws.send(s); };
const count = () => cast({ t: 'count', n: clients.size, total: db.total });
const cool = (c, key, ms) => { const now = Date.now(); if (now - (c.cd[key] || 0) < ms) return false; c.cd[key] = now; return true; };
function look(l) { const o = {}; if (l && typeof l === 'object') for (const k of ['body', 'hat', 'hatColor', 'scarf', 'face', 'acc', 'fx']) if (typeof l[k] === 'string') o[k] = l[k].slice(0, 12); return o; }
wss.on('connection', ws => {
  let c = null; ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; } if (!m || typeof m.t !== 'string') return;
    if (m.t === 'hello') {
      if (c) return; const id = str(m.id, 40) || Math.random().toString(36).slice(2);
      const old = clients.get(id); if (old) { try { old.ws.close(); } catch (e) {} }
      c = { id, ws, name: str(m.name, 10) || '펭귄', admin: false, cd: {}, pos: null }; clients.set(id, c);
      const vid = str(m.vid, 40) || id; if (!db.seen[vid]) { if (Object.keys(db.seen).length > 20000) db.seen = {}; db.seen[vid] = 1; db.total++; save(); }
      sendTo(ws, { t: 'init', wishes: db.wishes.slice(-300) });
      for (const o of clients.values()) if (o !== c && o.pos) sendTo(ws, o.pos);
      return count();
    }
    if (!c) return;
    switch (m.t) {
      case 'pos': c.name = str(m.name, 10) || c.name; c.pos = { t: 'pos', id: c.id, name: c.name, look: look(m.look), x: num(m.x, -110, 110), y: num(m.y, 0, 25), z: num(m.z, -110, 110), ry: num(m.ry, -10, 10), hop: !!m.hop }; cast(c.pos, ws); c.pos.hop = false; break;
      case 'wish': { const text = str(m.text, 80), color = str(m.color, 24); if (!text || !/^#[0-9a-fA-F]{6}\|[a-z]{2,8}$/.test(color)) return; if (!cool(c, 'wish', 8000)) return sendTo(ws, { t: 'err', msg: '소원은 잠시 후에 다시 걸 수 있어요' });
        const wish = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: str(m.name, 10) || c.name, text, color, created_at: new Date().toISOString() };
        db.wishes.push(wish); if (db.wishes.length > MAX_WISHES) db.wishes = db.wishes.slice(-MAX_WISHES); save(); cast({ t: 'wish', wish, by: c.id }); break; }
      case 'admin': c.admin = !!ADMIN_KEY && cool(c, 'admin', 1500) && str(m.key, 80) === ADMIN_KEY; sendTo(ws, { t: 'admin', ok: c.admin }); break;
      case 'del': { if (!c.admin) return; const id = str(m.id, 40), n = db.wishes.length; db.wishes = db.wishes.filter(w => w.id !== id); if (db.wishes.length !== n) { save(); cast({ t: 'del', id }); } break; }
      case 'ball': if (cool(c, 'ball', 300)) cast({ t: 'ball', id: c.id, tx: num(m.tx, -110, 110), tz: num(m.tz, -110, 110) }, ws); break;
      case 'gift': if (cool(c, 'gift', 1000)) cast({ t: 'gift', id: c.id, to: str(m.to, 40), from: c.name }, ws); break;
      case 'show': if (cool(c, 'show', 5000)) cast({ t: 'show' }, ws); break;
      case 'chat': { const i = m.i | 0; if (i >= 0 && i < WARM_N && cool(c, 'chat', 1200)) cast({ t: 'chat', id: c.id, i }, ws); break; }
      case 'score': { const day = today(), score = Math.round(num(m.score, 0, 100000)), name = str(m.name, 10) || c.name; let list = db.scores[day] || [];
        if (score > 0 && cool(c, 'score', 3000)) { const mine = list.find(s => s.name === name); if (!mine) list.push({ name, score }); else if (score > mine.score) mine.score = score; list.sort((a, b) => b.score - a.score); list = list.slice(0, 50); db.scores = { [day]: list }; save(); }
        sendTo(ws, { t: 'rank', list: list.slice(0, 10) }); break; }
    }
  });
  ws.on('close', () => { if (c && clients.get(c.id) === c) { clients.delete(c.id); cast({ t: 'leave', id: c.id }); count(); } });
  ws.on('error', () => {});
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) {} } }, 30000);
// 무료(서버리스) 플랜은 서버가 밖으로 보내는 통신이 10분쯤 없으면 재워버립니다.
// 접속자가 있는 동안에는 4분마다 자기 주소로 가벼운 요청을 보내 깨어 있게 하고, 아무도 없으면 그대로 잠들게 둡니다.
const SELF = process.env.RAILWAY_PUBLIC_DOMAIN;
if (SELF) setInterval(() => { if (!clients.size) return; try { require('https').get({ host: SELF, path: '/healthz', timeout: 8000 }, r => r.resume()).on('error', () => {}).on('timeout', function () { this.destroy(); }); } catch (e) {} }, 240000);
server.listen(PORT, () => console.log('크리스마스 마을 서버 실행 중 :' + PORT + (ADMIN_KEY ? '' : ' (ADMIN_KEY 미설정: 관리자 삭제 꺼짐)')));
