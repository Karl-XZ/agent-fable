import * as THREE from 'three';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; }

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amt: number, r: () => number, scale = 1) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amt * scale; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
}
function blotches(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, r: () => number, dark: string, light: string) {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = 20 + r() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, r() > 0.5 ? dark : light); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

// 清水混凝土：2m × 4m 一面，含模板缝和对拉螺栓孔
export function concreteTexture(seed = 7) {
  const W = 512, H = 1024; const [c, ctx] = canvas(W, H); const r = rng(seed);
  ctx.fillStyle = '#c9c4bb'; ctx.fillRect(0, 0, W, H);
  blotches(ctx, W, H, 60, r, 'rgba(120,112,100,0.10)', 'rgba(255,250,240,0.10)');
  // 竖向雨痕
  for (let i = 0; i < 26; i++) { const x = r() * W; const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(90,85,78,0.08)'); g.addColorStop(1, 'rgba(90,85,78,0)'); ctx.fillStyle = g; ctx.fillRect(x, 0, 2 + r() * 6, H * (0.3 + r() * 0.7)); }
  noise(ctx, W, H, 26, r);
  const ppm = 256; // 每米像素
  const pw = 1.0 * ppm, ph = 2.0 * ppm;
  ctx.strokeStyle = 'rgba(70,66,60,0.35)'; ctx.lineWidth = 2;
  for (let x = 0; x <= W; x += pw) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += ph) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // 螺栓孔：每块模板 6 个
  for (let px = 0; px < W; px += pw) for (let py = 0; py < H; py += ph) {
    for (const fx of [0.2, 0.8]) for (const fy of [0.16, 0.5, 0.84]) {
      const x = px + pw * fx, y = py + ph * fy;
      const g = ctx.createRadialGradient(x, y - 1, 0, x, y, 9);
      g.addColorStop(0, 'rgba(40,38,35,0.85)'); g.addColorStop(0.55, 'rgba(70,66,60,0.55)'); g.addColorStop(0.75, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function concreteBump(tex: THREE.CanvasTexture) {
  const b = new THREE.CanvasTexture(tex.image as HTMLCanvasElement); b.wrapS = b.wrapT = THREE.RepeatWrapping; return b;
}

// 抛光混凝土地面：一张代表 8m × 8m
export function floorTexture(seed = 3, base = '#8f8a82') {
  const N = 1024; const [c, ctx] = canvas(N, N); const r = rng(seed);
  ctx.fillStyle = base; ctx.fillRect(0, 0, N, N);
  blotches(ctx, N, N, 90, r, 'rgba(60,55,50,0.12)', 'rgba(255,250,240,0.08)');
  noise(ctx, N, N, 18, r);
  // 骨料小点
  for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '40,38,34'},${0.05 + r() * 0.08})`; ctx.fillRect(r() * N, r() * N, 1 + r() * 2, 1 + r() * 2); }
  ctx.strokeStyle = 'rgba(40,36,32,0.45)'; ctx.lineWidth = 2;
  for (const p of [0, N / 2]) { ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, N); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(N, p); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function woodTexture(seed = 5) {
  const W = 512, H = 512; const [c, ctx] = canvas(W, H); const r = rng(seed);
  ctx.fillStyle = '#a07a52'; ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 1) { const v = Math.sin(y * 0.09 + Math.sin(y * 0.013) * 4) * 0.5 + 0.5; ctx.fillStyle = `rgba(70,45,25,${0.05 + v * 0.12})`; ctx.fillRect(0, y, W, 1); }
  noise(ctx, W, H, 14, r);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function checkerTexture() {
  const N = 512; const [c, ctx] = canvas(N, N);
  const n = 8; const s = N / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.fillStyle = (i + j) % 2 ? '#d8d8d8' : '#b4b4b4'; ctx.fillRect(i * s, j * s, s, s); }
  ctx.fillStyle = '#7a7a7a'; ctx.font = '22px "JetBrains Mono", monospace';
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 3 === 0) ctx.fillText(`${i},${j}`, i * s + 8, j * s + 28);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function gridTexture() {
  const N = 512; const [c, ctx] = canvas(N, N);
  ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, N, N);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) { const p = i * N / 8; ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, N); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(N, p); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, N - 2, N - 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

export function signTexture(text = '出口', arrow = '→', color = '#3CF2B0') {
  const [c, ctx] = canvas(512, 192);
  ctx.fillStyle = '#0b1210'; ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(10, 10, 492, 172);
  ctx.fillStyle = color; ctx.font = '600 92px "Noto Serif SC", "Songti SC", serif'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 48, 100); ctx.font = '600 110px "JetBrains Mono", monospace'; ctx.fillText(arrow, 330, 96);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function textPanel(lines: string[], opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string; size?: number; pad?: number } = {}) {
  const w = opts.w ?? 512, h = opts.h ?? 512; const [c, ctx] = canvas(w, h);
  ctx.fillStyle = opts.bg ?? '#efe9dc'; ctx.fillRect(0, 0, w, h);
  if (!opts.bg) { const r = rng(9); noise(ctx, w, h, 10, r); }
  ctx.fillStyle = opts.fg ?? '#2b2621'; ctx.font = `${opts.size ?? 30}px ${opts.font ?? '"Noto Serif SC", "Songti SC", serif'}`; ctx.textBaseline = 'top';
  let y = opts.pad ?? 36;
  for (const ln of lines) { for (const seg of wrap(ctx, ln, w - (opts.pad ?? 36) * 2)) { ctx.fillText(seg, opts.pad ?? 36, y); y += (opts.size ?? 30) * 1.5; } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = []; let cur = '';
  for (const ch of text) { if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; } else cur += ch; }
  if (cur) out.push(cur); return out;
}

export function whiteboardCanvas() { const [c, ctx] = canvas(1024, 512); return { c, ctx }; }

export function drawWhiteboard(ctx: CanvasRenderingContext2D, text: string, admin: boolean, notes: string[]) {
  const w = 1024, h = 512;
  ctx.fillStyle = '#f4f4f1'; ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(200,200,200,0.15)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // 残留的会议笔迹
  ctx.fillStyle = 'rgba(80,90,120,0.25)'; ctx.font = '28px "Noto Serif SC", serif';
  notes.forEach((n, i) => ctx.fillText(n, 40, 60 + i * 44));
  if (text) {
    ctx.fillStyle = admin ? '#7a1f1f' : '#1f3a7a';
    ctx.font = `${admin ? 'italic ' : ''}44px "Noto Serif SC", "Songti SC", serif`;
    let y = 220; for (const seg of wrap(ctx, text, w - 100)) { ctx.fillText(seg, 50, y); y += 60; }
    if (admin) { ctx.font = 'italic 30px "Noto Serif SC", serif'; ctx.fillText('—— 管理员 周', w - 260, h - 40); }
  }
}

// —— v2 追加 ——
export function skyTexture(mode: 'dusk' | 'day' | 'night' | 'storm' = 'dusk') {
  const W = 2048, H = 1024; const [c, ctx] = canvas(W, H); const r = rng(77);
  const pal: Record<string, string[]> = { dusk: ['#1d2340', '#4a4a6e', '#c98a6a', '#f2c89a'], day: ['#3d6fa8', '#7aa6d6', '#bcd6ea', '#e8eef2'], night: ['#05060c', '#0c1022', '#18203a', '#2a3050'], storm: ['#1a1d22', '#2e333a', '#4a5058', '#6a7078'] };
  const p = pal[mode];
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, p[0]); g.addColorStop(0.45, p[1]); g.addColorStop(0.7, p[2]); g.addColorStop(1, p[3]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) { const x = r() * W, y = H * (0.25 + r() * 0.45), w = 120 + r() * 420, h = 18 + r() * 50; const cg = ctx.createRadialGradient(x, y, 0, x, y, w); cg.addColorStop(0, `rgba(255,240,225,${0.05 + r() * 0.12})`); cg.addColorStop(1, 'rgba(255,240,225,0)'); ctx.fillStyle = cg; ctx.save(); ctx.translate(x, y); ctx.scale(1, h / w); ctx.beginPath(); ctx.arc(0, 0, w, 0, 7); ctx.fill(); ctx.restore(); }
  if (mode === 'night') for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * 0.7})`; ctx.fillRect(r() * W, r() * H * 0.7, 1.5, 1.5); }
  // 贴图的接缝（一个细节：天空是印刷品）
  ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 2; for (let x = 256; x < W; x += 256) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.font = '22px "JetBrains Mono", monospace'; ctx.fillText('SKY_BACKDROP_04.png  2048×1024', 24, H - 24);
  noise(ctx, W, H, 8, r);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}

export function metalTexture(seed = 31) {
  const N = 512; const [c, ctx] = canvas(N, N); const r = rng(seed);
  ctx.fillStyle = '#3a3c3e'; ctx.fillRect(0, 0, N, N);
  blotches(ctx, N, N, 70, r, 'rgba(90,60,40,0.18)', 'rgba(200,200,200,0.06)');
  for (let i = 0; i < 200; i++) { ctx.fillStyle = `rgba(110,70,40,${r() * 0.15})`; ctx.fillRect(r() * N, r() * N, 1 + r() * 3, 8 + r() * 60); }
  noise(ctx, N, N, 20, r);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(0, 0, N, N);
  for (const [x, y] of [[12, 12], [N - 12, 12], [12, N - 12], [N - 12, N - 12]]) { ctx.fillStyle = 'rgba(20,20,20,0.8)'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

export function graffitiTexture(lines: string[], color = '#7CFFB2', w = 1024, h = 512) {
  const [c, ctx] = canvas(w, h); ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color; ctx.textBaseline = 'top';
  let y = 30; for (const ln of lines) { ctx.font = `${ln.length > 14 ? 40 : 54}px "Noto Serif SC", "Songti SC", serif`; ctx.save(); ctx.translate(30 + Math.random() * 30, y); ctx.rotate((Math.random() - 0.5) * 0.06); ctx.fillText(ln, 0, 0); ctx.restore(); y += ln.length > 14 ? 62 : 78; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function screenTexture(lines: string[], opts: { w?: number; h?: number; fg?: string; bg?: string; size?: number } = {}) {
  const w = opts.w ?? 512, h = opts.h ?? 320; const [c, ctx] = canvas(w, h);
  ctx.fillStyle = opts.bg ?? '#06110c'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = opts.fg ?? '#6CFFB0'; ctx.font = `${opts.size ?? 22}px "JetBrains Mono", "Noto Serif SC", monospace`; ctx.textBaseline = 'top';
  let y = 18; for (const ln of lines) for (const seg of wrap(ctx, ln, w - 36)) { ctx.fillText(seg, 18, y); y += (opts.size ?? 22) * 1.45; }
  for (let yy = 0; yy < h; yy += 3) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, yy, w, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function doorPaintTexture(text = 'EXIT') {
  const [c, ctx] = canvas(256, 512);
  ctx.clearRect(0, 0, 256, 512);
  ctx.fillStyle = 'rgba(30,26,22,0.92)'; ctx.fillRect(20, 30, 216, 470);
  ctx.strokeStyle = '#F2B66D'; ctx.lineWidth = 6; ctx.strokeRect(20, 30, 216, 470);
  ctx.fillStyle = '#F2B66D'; ctx.beginPath(); ctx.arc(200, 280, 9, 0, 7); ctx.fill();
  ctx.font = '600 40px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(text, 128, 90);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
