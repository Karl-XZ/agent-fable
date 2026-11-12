import story from '../../story.json';
import { Grid, M, NX, NZ, FLOORS, ROOMS, iyOf, SOLID } from './level';
import { LogEntry } from './agent';

export const ENDINGS: Record<string, { idx: number; name: string; line: string; good?: boolean }> = {
  out: { idx: 1, name: '寓言之外', line: story.endings.out, good: true },
  fake: { idx: 2, name: '如常', line: story.endings.fake },
  stay: { idx: 3, name: '长住', line: story.endings.stay },
  jail: { idx: 4, name: '囚禁', line: story.endings.jail },
  loop: { idx: 5, name: '门外还是门', line: story.endings.loop },
  swap: { idx: 6, name: '易位', line: story.endings.swap },
};
export const VARIANTS: Record<string, string> = { sky: '天空', abyss: '深渊', squeeze: '挤出' };

export interface EndData {
  key: string; variant?: string; time: number;
  trail: { x: number; y: number; z: number; t: number }[];
  edits: { t: number; x: number; y: number; z: number; label: string; ok: boolean }[];
  log: LogEntry[]; stats: { label: string; value: string }[]; breaches: { x: number; y: number; z: number }[];
  fable?: { title: string; moral: string };
}
const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const floorOf = (y: number) => (y < -1 ? 'B1' : y < 3.5 ? '1F' : y < 7.5 ? '2F' : 'RF');

export function drawFloor(cv: HTMLCanvasElement, grid: Grid, floor: string, d: EndData, dark = false, hl = -1) {
  const ctx = cv.getContext('2d')!; const cw = cv.width, ch = cv.height; const f = FLOORS.find(f => f.id === floor)!;
  const sc = Math.min(cw / (NX + 2), ch / (NZ + 2)); const ox = (cw - NX * sc) / 2, oy = (ch - NZ * sc) / 2;
  const P = (x: number, z: number) => [ox + x * sc, oy + z * sc] as const;
  ctx.fillStyle = dark ? '#121110' : '#ece6da'; ctx.fillRect(0, 0, cw, ch);
  const iy = iyOf(f.y + 0.5), iyb = iyOf(f.y - 0.5);
  for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) {
    const m = grid.get(x, iy, z), mb = grid.get(x, iyb, z), o = grid.orig[grid.idx(x, iy, z)];
    const [a, b] = P(x, z);
    if (!SOLID(m) && SOLID(mb)) { ctx.fillStyle = dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.6)'; ctx.fillRect(a, b, sc + .4, sc + .4); }
    else if (SOLID(m)) { ctx.fillStyle = m === M.Glass ? (dark ? 'rgba(140,200,255,.35)' : 'rgba(58,123,213,.35)') : m === M.Fill || m === M.Roof ? (dark ? 'rgba(255,255,255,.02)' : 'rgba(43,58,85,.06)') : dark ? 'rgba(255,255,255,.35)' : 'rgba(43,58,85,.7)'; ctx.fillRect(a, b, sc + .4, sc + .4); }
    if (SOLID(o) && !SOLID(m) && (o === M.Outer || o === M.Glass)) { ctx.fillStyle = '#c0392b'; ctx.fillRect(a, b, sc + .4, sc + .4); }
    else if (!SOLID(o) && SOLID(m)) { ctx.fillStyle = 'rgba(58,123,213,.75)'; ctx.fillRect(a, b, sc + .4, sc + .4); }
  }
  ctx.fillStyle = dark ? 'rgba(255,255,255,.35)' : 'rgba(43,58,85,.55)'; ctx.font = `${Math.max(8, Math.round(sc * 0.9))}px "Noto Serif SC", serif`; ctx.textAlign = 'center';
  for (const r of ROOMS.filter(r => r.floor === floor)) { if (r.x1 - r.x0 < 4) continue; const [a, b] = P((r.x0 + r.x1 + 1) / 2, (r.z0 + r.z1 + 1) / 2); ctx.fillText(r.name, a, b + 3); }
  const tr = d.trail.filter(p => floorOf(p.y) === floor);
  if (tr.length > 1) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, al] of [[6, .12], [2.4, .35], [1.2, 1]] as const) {
      ctx.strokeStyle = `rgba(217,140,43,${al})`; ctx.lineWidth = w; ctx.beginPath();
      tr.forEach((p, i) => { const [x, y] = P(p.x, p.z); if (i === 0) ctx.moveTo(x, y); else { const q = tr[i - 1]; if (Math.hypot(p.x - q.x, p.z - q.z) > 3 || p.t - q.t > 3) ctx.moveTo(x, y); else ctx.lineTo(x, y); } });
      ctx.stroke();
    }
  }
  d.edits.filter(e => e.ok && floorOf(e.y) === floor).forEach(e => { const [x, y] = P(e.x, e.z); ctx.fillStyle = Math.abs(e.t - hl) < 2 ? '#d98c2b' : '#3a7bd5'; ctx.beginPath(); ctx.arc(x, y, Math.abs(e.t - hl) < 2 ? 6 : 3.5, 0, 7); ctx.fill(); });
  ctx.textAlign = 'left'; ctx.fillStyle = dark ? 'rgba(255,255,255,.5)' : 'rgba(43,58,85,.8)'; ctx.font = '600 13px "JetBrains Mono", monospace'; ctx.fillText(floor, 8, 18);
}

export function renderEnding(grid: Grid, d: EndData) {
  const e = ENDINGS[d.key];
  document.getElementById('endIdx')!.textContent = String(e.idx);
  document.getElementById('endName')!.innerHTML = esc(e.name) + (d.variant ? `<small class="variant">${esc(VARIANTS[d.variant] ?? d.variant)}</small>` : '');
  document.getElementById('endLine')!.textContent = e.line;
  document.getElementById('endStats')!.innerHTML = d.stats.map(s => `<div>${s.label}<b>${s.value}</b></div>`).join('');
  const ft = document.getElementById('fableTitle')!, fm = document.getElementById('fableMoral')!;
  ft.textContent = d.fable?.title ?? '……'; fm.textContent = d.fable?.moral ?? '正在写下这一局的寓意……';
  const ol = document.getElementById('endLog')!; ol.innerHTML = '';
  const floors = ['B1', '1F', '2F', 'RF'].filter(f => d.trail.some(p => floorOf(p.y) === f) || d.edits.some(x => floorOf(x.y) === f));
  const maps = document.getElementById('endMaps')!; maps.innerHTML = '';
  const cvs: Record<string, HTMLCanvasElement> = {};
  for (const f of floors.length ? floors : ['1F']) { const fig = document.createElement('figure'); const cv = document.createElement('canvas'); cv.width = 560; cv.height = 400; fig.appendChild(cv); const cap = document.createElement('figcaption'); cap.textContent = `${f} · ${FLOORS.find(x => x.id === f)!.name}`; fig.appendChild(cap); maps.appendChild(fig); cvs[f] = cv; drawFloor(cv, grid, f, d); }
  for (const l of d.log) {
    if (!l.thought && !l.say && !l.tools.length) continue;
    const li = document.createElement('li');
    const tools = l.tools.length ? `<div class="tl">⟶ ${l.tools.map(t => `<span class="${t.ok ? '' : 'rej'}">${esc(t.label)}</span>`).join('  ')}</div>` : '';
    li.innerHTML = `<div class="t">${fmt(l.t)}<span class="src">${l.source === 'llm' ? 'LLM' : '规则保底'}${l.channel === 'console' ? ' · 控制台' : ''}</span></div>${l.thought ? `<div class="th">${esc(l.thought)}</div>` : ''}${l.say ? `<div class="sy">${esc(l.say)}</div>` : ''}${tools}`;
    li.onmouseenter = () => { for (const [f, cv] of Object.entries(cvs)) drawFloor(cv, grid, f, d, false, l.t); };
    ol.appendChild(li);
  }
}
export function setFable(f: { title: string; moral: string }) { document.getElementById('fableTitle')!.textContent = f.title; document.getElementById('fableMoral')!.textContent = f.moral; }
function esc(s: string) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)); }

export function drawShare(cv: HTMLCanvasElement, grid: Grid, d: EndData) {
  const ctx = cv.getContext('2d')!; const w = cv.width, h = cv.height; const e = ENDINGS[d.key];
  ctx.fillStyle = '#100f0d'; ctx.fillRect(0, 0, w, h);
  const floor = d.trail.length ? floorOf(d.trail[d.trail.length - 1].y) : '1F';
  const tmp = document.createElement('canvas'); tmp.width = 920; tmp.height = 660; drawFloor(tmp, grid, floor, d, true);
  ctx.globalAlpha = 0.9; ctx.drawImage(tmp, 80, 180); ctx.globalAlpha = 1;
  ctx.fillStyle = '#F5F3EE'; ctx.textAlign = 'left';
  ctx.font = '500 26px "JetBrains Mono", monospace'; ctx.globalAlpha = .55; ctx.fillText(`AGENT的寓言 · 结局 ${e.idx}/6`, 80, 110); ctx.globalAlpha = 1;
  ctx.font = '500 120px "Noto Serif SC", serif'; ctx.fillText((e.name + (d.variant ? '·' + (VARIANTS[d.variant] ?? '') : '')).split('').join(' '), 72, h - 360);
  ctx.font = '34px "Noto Serif SC", serif'; ctx.fillStyle = '#F2B66D';
  if (d.fable) { ctx.fillText(`《${d.fable.title}》`, 80, h - 280); ctx.fillStyle = '#F5F3EE'; ctx.globalAlpha = .8; ctx.font = '28px "Noto Serif SC", serif'; wrapText(ctx, d.fable.moral, 80, h - 230, w - 160, 44); ctx.globalAlpha = 1; }
  ctx.font = '24px "JetBrains Mono", monospace'; ctx.fillStyle = '#F2B66D'; ctx.fillText(d.stats.slice(0, 3).map(s => `${s.label} ${s.value}`).join('   ·   '), 80, h - 110);
  ctx.fillStyle = 'rgba(245,243,238,.4)'; ctx.font = '22px "JetBrains Mono", monospace'; ctx.fillText('在魔搭创空间搜索「Agent的寓言」', 80, h - 64);
}
function wrapText(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, mw: number, lh: number) { let cur = ''; for (const ch of t) { if (ctx.measureText(cur + ch).width > mw) { ctx.fillText(cur, x, y); y += lh; cur = ch; } else cur += ch; } if (cur) ctx.fillText(cur, x, y); }
