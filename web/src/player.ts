import * as THREE from 'three';
import { World, AABB, overlap } from './world';

const R = 0.3; export const STAND = 1.7, CROUCH = 0.9, LIE = 0.45; const STEP = 0.36;

export function safeTransitSupport(support: AABB | null) {
  return support?.tag === 'cab' || support?.tag === 'struct' && support.ref?.kind === 'stairs' && support.ref.rise >= 1;
}

export function isTextInput(target: EventTarget | null) {
  return target instanceof HTMLElement && (!!target.closest('input, textarea, select') || target.isContentEditable);
}

export class Player {
  pos = new THREE.Vector3(); vel = new THREE.Vector3();
  yaw = 0; pitch = 0; height = STAND; onGround = false;
  keys = new Set<string>(); sens = 0.0022; enabled = false;
  walked = 0; bob = 0; posture: 'stand' | 'crouch' | 'sit' | 'lie' = 'stand';
  standingOn: AABB | null = null; fallTop = 0; airborne = false;
  gravityMul = 1; frictionMul = 1; slowT = 0; injuredT = 0;
  inWater = false; underwaterT = 0; swimming = false;
  backward = false; movedDist = 0; crouchCount: number[] = [];
  lastCrouch = false; frozen = false; noPhysics = false; jumpBuf = 0;
  onStep: () => void = () => {};
  onLand: (h: number) => void = () => {};
  onSqueeze: (cause: string) => void = () => {};
  onJump: () => void = () => {};
  private cols: AABB[] = [];
  constructor(public world: World, public camera: THREE.PerspectiveCamera) {
    addEventListener('keydown', e => { if (!this.enabled || isTextInput(e.target) || e.isComposing) return; this.keys.add(e.code); if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.jumpBuf = 0.18; } });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('mousemove', e => { if (!this.enabled || document.pointerLockElement == null) return; this.look(-e.movementX * this.sens, -e.movementY * this.sens); });
    addEventListener('blur', () => this.clearInput());
    addEventListener('focusin', e => { if (isTextInput(e.target)) this.clearInput(); });
  }
  clearInput() { this.keys.clear(); this.jumpBuf = 0; this.vel.x = 0; this.vel.z = 0; }
  look(dy: number, dp: number) { this.yaw += dy; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dp)); }
  teleport(x: number, y: number, z: number, yaw?: number) { this.pos.set(x, y, z); this.vel.set(0, 0, 0); if (yaw !== undefined) { this.yaw = yaw; this.pitch = 0; } this.fallTop = y; this.airborne = false; }
  aabb(h = this.height, p = this.pos): AABB { return { min: [p.x - R, p.y, p.z - R], max: [p.x + R, p.y + h, p.z + R] }; }
  near(out: AABB[], pad = 1.2) { const p = this.pos; return this.world.colliders({ min: [p.x - pad, p.y - pad, p.z - pad], max: [p.x + pad, p.y + this.height + pad, p.z + pad] }, out); }
  blocked(a: AABB) { this.near(this.cols, 1.6); for (const c of this.cols) if (overlap(a, c, 0.001)) return c; return null; }

  // 被移动/新生成的实体压住时的处理：抬升、推开、或挤出世界
  depenetrate() {
    this.near(this.cols, 1.0);
    const me = this.aabb(this.height - 0.02, this.pos.clone().setY(this.pos.y + 0.01));
    for (const c of this.cols) {
      if (!overlap(me, c, 0.002)) continue;
      // 0) 正在平移的墙：沿运动方向推；被顶在别的东西上就挤出世界
      if (c.tag === 'pending' && c.ref?.mode === 'slide') {
        const d = c.ref.dir as number[]; const np = this.pos.clone();
        if (d[0] > 0) np.x = c.max[0] + R + 0.01; else if (d[0] < 0) np.x = c.min[0] - R - 0.01;
        if (d[2] > 0) np.z = c.max[2] + R + 0.01; else if (d[2] < 0) np.z = c.min[2] - R - 0.01;
        if (!this.blocked(this.aabb(this.height, np))) { this.pos.copy(np); continue; }
        this.onSqueeze('wall'); return;
      }
      // 1) 脚下升起：抬起来
      const lift = c.max[1] - this.pos.y;
      if (lift > 0 && lift < 0.75) {
        const up = this.pos.clone().setY(c.max[1] + 0.001);
        if (!this.blocked(this.aabb(this.posture === 'crouch' ? CROUCH : this.height, up))) { this.pos.y = up.y; this.vel.y = Math.max(0, this.vel.y); continue; }
        if (!this.blocked(this.aabb(CROUCH, up))) { this.pos.y = up.y; this.height = CROUCH; this.posture = 'crouch'; continue; }
      }
      // 2) 头顶压下来：蹲下
      if (c.min[1] > this.pos.y + 0.6 && c.min[1] < this.pos.y + this.height) { const h = c.min[1] - this.pos.y - 0.01; if (h >= CROUCH && !this.blocked(this.aabb(h))) { this.height = h; this.posture = 'crouch'; continue; } if (h >= LIE + 0.1) { this.height = Math.max(LIE, h); this.posture = 'lie'; continue; } }
      // 3) 水平推开
      const cands: THREE.Vector3[] = [
        new THREE.Vector3(c.min[0] - R - 0.01, this.pos.y, this.pos.z), new THREE.Vector3(c.max[0] + R + 0.01, this.pos.y, this.pos.z),
        new THREE.Vector3(this.pos.x, this.pos.y, c.min[2] - R - 0.01), new THREE.Vector3(this.pos.x, this.pos.y, c.max[2] + R + 0.01),
      ].sort((a, b) => a.distanceToSquared(this.pos) - b.distanceToSquared(this.pos));
      let moved = false;
      const inside = (p: THREE.Vector3) => p.x > 0.3 && p.x < 39.7 && p.z > 0.3 && p.z < 27.7;
      for (const p of cands) { if (p.distanceTo(this.pos) > 1.6 || (!inside(p) && inside(this.pos))) continue; if (!this.blocked(this.aabb(this.height, p))) { this.pos.copy(p); moved = true; break; } }
      if (!moved) { this.onSqueeze(c.tag === 'door' ? 'door' : c.tag === 'pending' ? 'wall' : c.tag ?? 'solid'); return; }
    }
  }

  update(dt: number) {
    if (this.noPhysics) { this.updateCamera(0); return; }
    this.depenetrate();
    // 姿态
    const wantCrouch = this.keys.has('KeyC') || this.keys.has('ControlLeft');
    if (wantCrouch && !this.lastCrouch) { this.crouchCount.push(performance.now() / 1000); this.crouchCount = this.crouchCount.filter(t => performance.now() / 1000 - t < 10); }
    this.lastCrouch = wantCrouch;
    if (this.posture === 'sit' || this.posture === 'lie') {
      if (this.posture === 'lie') this.height = LIE; else this.height = 1.15;
    } else {
      const targetH = wantCrouch ? CROUCH : STAND;
      if (targetH > this.height) { const nh = Math.min(targetH, this.height + dt * 3); if (!this.blocked(this.aabb(nh))) this.height = nh; }
      else this.height = Math.max(targetH, this.height - dt * 4);
      this.posture = this.height < 1.3 ? 'crouch' : 'stand';
    }
    const locked = this.posture === 'sit' || this.posture === 'lie' || this.frozen;
    // 移动输入
    const f = locked ? 0 : (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const s = locked ? 0 : (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    this.backward = f < 0 && s === 0;
    const run = this.keys.has('ShiftLeft') && this.height > 1.5 && !this.swimming;
    let speed = this.height < 1.2 ? 1.7 : run ? 5.2 : 3.1;
    if (this.swimming) speed = 2.0; if (this.slowT > 0) speed *= 0.4; if (this.injuredT > 0) speed *= 0.55; if (this.backward) speed *= 0.7;
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s, 0, -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s);
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(speed);
    const grip = this.onGround ? 12 * this.frictionMul + 0.3 : this.swimming ? 4 : 2.5;
    const k = Math.min(1, dt * grip);
    this.vel.x += (dir.x - this.vel.x) * k; this.vel.z += (dir.z - this.vel.z) * k;
    // 水
    const wl = this.world.water.level; this.inWater = this.world.inWater(this.pos.x, this.pos.z) && this.pos.y < wl && this.pos.y > -4.6;
    this.swimming = this.inWater && wl - this.pos.y > 1.0;
    const eye = this.pos.y + this.height - 0.12;
    if (this.inWater && eye < wl) this.underwaterT += dt; else this.underwaterT = 0;
    if ((this.keys.has('Space') || this.jumpBuf > 0) && !locked) {
      if (this.swimming) this.vel.y = Math.min(2.4, this.vel.y + dt * 12);
      else if (this.onGround) { this.vel.y = 6.0; this.onGround = false; this.jumpBuf = 0; this.onJump(); }
    }
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    const g = 17 * this.gravityMul * (this.swimming ? 0.12 : 1);
    if (this.swimming) this.vel.y *= 1 - Math.min(1, dt * 1.5);
    const sub = 3; const h = dt / sub; const wasGround = this.onGround;
    const px = this.pos.x, pz = this.pos.z;
    for (let i = 0; i < sub; i++) {
      this.moveAxis(0, this.vel.x * h); this.moveAxis(2, this.vel.z * h);
      this.vel.y -= g * h; this.onGround = false; this.standingOn = null; this.moveAxis(1, this.vel.y * h);
    }
    this.movedDist += Math.hypot(this.pos.x - px, this.pos.z - pz);
    // 坠落记录
    if (!this.onGround) { if (!this.airborne) { this.airborne = true; this.fallTop = this.pos.y; } this.fallTop = Math.max(this.fallTop, this.pos.y); }
    else if (this.airborne) { this.airborne = false; const fall = this.fallTop - this.pos.y; if (fall > 0.2) this.onLand(this.inWater ? fall * 0.3 : fall); }
    if (!wasGround && this.onGround) this.vel.y = 0;
    this.slowT = Math.max(0, this.slowT - dt); this.injuredT = Math.max(0, this.injuredT - dt);
    // 脚步
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) { this.walked += hs * dt; this.bob += hs * dt * 2.2; if (this.walked > (run ? 2.0 : 1.5)) { this.walked = 0; this.onStep(); } }
    this.updateCamera(hs);
  }
  updateCamera(hs: number) {
    const eye = this.pos.y + this.height - 0.12 + Math.sin(this.bob * 2) * 0.025 * Math.min(1, hs / 3);
    this.camera.position.set(this.pos.x, eye, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * 0.004 + (this.injuredT > 0 ? Math.sin(performance.now() / 300) * 0.02 : 0), 'YXZ');
  }

  updateFreeFall(dt: number) {
    const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const s = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const direction = new THREE.Vector3(-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s, 0, -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s);
    if (direction.lengthSq()) direction.normalize().multiplyScalar(this.keys.has('ShiftLeft') ? 5.2 : 3.1);
    const grip = 1 - Math.exp(-2.5 * dt);
    this.vel.x += (direction.x - this.vel.x) * grip; this.vel.z += (direction.z - this.vel.z) * grip;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt - 8.5 * dt * dt; this.vel.y -= 17 * dt;
    this.onGround = false;
    this.updateCamera(Math.hypot(this.vel.x, this.vel.z));
  }

  moveAxis(axis: 0 | 1 | 2, d: number) {
    if (d === 0) return;
    const p = this.pos; if (axis === 0) p.x += d; else if (axis === 1) p.y += d; else p.z += d;
    this.near(this.cols, 0.8);
    const a = this.aabb();
    for (const c of this.cols) {
      if (!overlap(a, c)) continue;
      if (axis === 1) {
        if (d < 0) { p.y = c.max[1]; this.vel.y = 0; this.onGround = true; this.standingOn = c; }
        else { p.y = c.min[1] - this.height - 0.001; this.vel.y = Math.min(0, this.vel.y); }
      } else {
        const step = c.max[1] - p.y;
        if (step > 0 && step < STEP && this.vel.y <= 0.5) { const old = p.y; p.y = c.max[1] + 0.001; if (!this.blocked(this.aabb())) { a.min = this.aabb().min; a.max = this.aabb().max; continue; } p.y = old; }
        if (axis === 0) { p.x = d > 0 ? c.min[0] - R - 0.001 : c.max[0] + R + 0.001; this.vel.x = 0; }
        else { p.z = d > 0 ? c.min[2] - R - 0.001 : c.max[2] + R + 0.001; this.vel.z = 0; }
      }
      a.min = this.aabb().min; a.max = this.aabb().max;
    }
  }
  forward() { return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
}
