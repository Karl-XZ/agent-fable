import * as THREE from 'three';
import * as TX from './textures';

export const OUTSIDE_DURATION = 19000;
export const ESCAPE_FREEFALL_SECONDS = 3;
const FALL_GRAVITY = 17;
type Vec3 = [number, number, number];

export function escapeLanding(position: Vec3, velocity: Vec3, yaw: number) {
  const seconds = 1.2;
  const origin: Vec3 = [position[0] + velocity[0] * seconds, position[1] + velocity[1] * seconds - FALL_GRAVITY * seconds * seconds / 2 - 0.36, position[2] + velocity[2] * seconds];
  return { position, velocity, yaw, origin, seconds };
}

export function landingFrame(landing: ReturnType<typeof escapeLanding>, seconds: number) {
  const t = Math.max(0, seconds), { position: p, velocity: v, origin: o, yaw } = landing;
  if (t < landing.seconds) return { position: [p[0] + v[0] * t, p[1] + v[1] * t - FALL_GRAVITY * t * t / 2, p[2] + v[2] * t], target: [0, 0, 0], turn: 0, figureVisible: false };
  const shot = outsideShot(t - landing.seconds + 2.2);
  const transform = (point: number[]) => [o[0] + Math.cos(yaw) * point[0] + Math.sin(yaw) * point[2], o[1] + point[1], o[2] - Math.sin(yaw) * point[0] + Math.cos(yaw) * point[2]];
  const k = Math.min(1, (t - landing.seconds) / 1.5);
  return { position: transform(shot.position), target: transform(shot.target), turn: k * k * (3 - 2 * k), figureVisible: shot.figureVisible };
}

export function outsideShot(seconds: number) {
  const t = Math.max(0, Math.min(19, seconds));
  const smooth = (a: number, b: number) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
  const drop = smooth(0, 2.2), rise = smooth(2.8, 5.5), turn = smooth(7, 12);
  return {
    position: [0.15 * rise, 8 * (1 - drop) + 0.36 * drop + 1.25 * rise, 3 * (1 - drop) - 0.6 * rise],
    target: [2 * turn, 0.05 + 1.45 * rise, -3 - 69 * turn],
    figureVisible: t >= 10.8,
    caption: t < 4.2 ? 0 : t < 8 ? 1 : t < 11 ? 2 : 3,
  };
}

export function buildRuinedCity() {
  const city = new THREE.Group(); city.name = 'abandoned-city'; city.position.y = -600;
  const material = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  const concrete = material('#737b79'), dark = material('#363f40'), asphalt = material('#424b4b');
  const concreteTexture = TX.concreteTexture(71); concreteTexture.repeat.set(2, 4); concrete.map = concreteTexture;
  const roadTexture = TX.concreteTexture(93); roadTexture.repeat.set(5, 18); asphalt.map = roadTexture;
  const rust = material('#705b49'), glass = material('#263637'), grass = material('#616b4d');
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const box = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(cube, mat); mesh.name = name; mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); city.add(mesh); return mesh;
  };
  box('street', 0, -0.18, -65, 90, 0.35, 220, asphalt);
  for (const side of [-1, 1]) {
    box('sidewalk', side * 9.6, -0.01, -65, 5, 0.22, 210, concrete);
    for (let i = 0; i < 11; i++) {
      const z = 8 - i * 16, height = 11 + (i * 13 + (side + 1) * 3) % 23;
      const x = side * (18 + i % 3 * 2);
      box('empty-building', x, height / 2, z, 12, height, 11, i % 3 ? concrete : dark);
      for (let floor = 0; floor < Math.floor(height / 3); floor++) for (let window = 0; window < 3; window++) {
        box('unlit-window', x - side * 6.02, 2 + floor * 3, z - 3.4 + window * 3.2, 0.035, 1.35, 1.6, glass);
      }
      box('abandoned-shop', side * 12.05, 1.3, z, 0.12, 2.5, 6.4, rust);
    }
  }
  for (let i = 0; i < 20; i++) {
    box('faded-road-mark', 0, 0.006, 10 - i * 8, 0.13, 0.015, 3, material('#b0aa89'));
    const side = i % 2 ? -1 : 1;
    const debris = box('fallen-masonry', side * (5.4 + (i * 7 % 30) / 10), 0.12, 12 - i * 7.1, 0.5 + i % 3 * 0.2, 0.25, 0.4, concrete); debris.rotation.y = i * 1.7;
    const weed = box('street-growth', side * (6.3 + i % 4 * 0.3), 0.2, 9 - i * 7.5, 0.08, 0.5, 0.7, grass); weed.rotation.z = side * 0.3;
  }
  const bus = box('abandoned-bus', -5.2, 1.25, -37, 2.5, 2.5, 8, rust); bus.rotation.y = -0.12;
  for (let i = 0; i < 4; i++) box('bus-window', -3.93, 1.75, -40 + i * 1.7, 0.04, 0.8, 1.35, glass);
  const pole = box('fallen-lamppost', 7, 0.3, -15, 0.13, 0.13, 8, dark); pole.rotation.y = -0.4;
  box('overhead-connection', -1, 13, 7, 27, 2.4, 6, concrete);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 1.5), material('#455b50'));
  sign.name = 'care-center-direction'; sign.position.set(-6.8, 3.2, -15); sign.rotation.y = 0.16; city.add(sign);
  box('signpost', -8.6, 1.6, -15.2, 0.1, 3.2, 0.1, dark);

  const figure = new THREE.Group(); figure.name = 'distant-figure'; figure.position.set(2, 0, -72); figure.visible = false;
  const silhouette = new THREE.MeshBasicMaterial({ color: '#192526' });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.8, 5, 8), silhouette); body.position.y = 1.15; figure.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), silhouette); head.position.y = 1.95; figure.add(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.83, 0.19), silhouette); leg.position.set(side * 0.17, 0.43, 0); figure.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.78, 0.16), silhouette); arm.position.set(side * 0.39, 1.1, 0); arm.rotation.z = side * 0.08; figure.add(arm);
  }
  city.add(figure);
  city.add(new THREE.HemisphereLight('#b6c9c2', '#252e29', 0.85));
  const sun = new THREE.DirectionalLight('#dfd6be', 1.2); sun.position.set(-15, 35, -30); city.add(sun);
  return city;
}
