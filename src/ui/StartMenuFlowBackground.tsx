import { useEffect, useRef } from 'react';
import type p5 from 'p5';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  hue: number;
};

const PARTICLE_COUNT = 180;

export const StartMenuFlowBackground = () => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5, px: window.innerWidth * 0.5, py: window.innerHeight * 0.5 };
    const handlePointerMove = (event: PointerEvent) => {
      pointer.px = pointer.x;
      pointer.py = pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };

    window.addEventListener('pointermove', handlePointerMove);

    let instance: p5 | null = null;
    let isDisposed = false;

    const sketch = (p: p5) => {
      const particles: Particle[] = [];

      const resetParticle = (particle: Particle) => {
        particle.x = p.random(p.width);
        particle.y = p.random(p.height);
        particle.vx = p.random(-0.4, 0.4);
        particle.vy = p.random(-0.4, 0.4);
        particle.age = p.random(40, 220);
        particle.hue = p.random(95, 155);
      };

      p.setup = () => {
        const canvas = p.createCanvas(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
        canvas.parent(host);
        canvas.elt.style.width = '100%';
        canvas.elt.style.height = '100%';
        canvas.elt.style.display = 'block';
        p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        p.colorMode(p.HSB, 360, 100, 100, 1);
        p.noFill();
        for (let i = 0; i < PARTICLE_COUNT; i += 1) {
          const particle = { x: 0, y: 0, vx: 0, vy: 0, age: 0, hue: 120 };
          resetParticle(particle);
          particles.push(particle);
        }
        p.background(0, 0, 2, 1);
      };

      p.windowResized = () => {
        p.resizeCanvas(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
        p.background(0, 0, 2, 1);
      };

      p.draw = () => {
        p.blendMode(p.BLEND);
        p.background(132, 100, 2, 0.11);
        p.blendMode(p.ADD);

        const pointerSpeed = p.dist(pointer.x, pointer.y, pointer.px, pointer.py);
        const time = p.frameCount * 0.008;

        for (const particle of particles) {
          const dx = particle.x - pointer.x;
          const dy = particle.y - pointer.y;
          const distance = Math.max(24, Math.sqrt(dx * dx + dy * dy));
          const influence = Math.min(1.6, 180 / distance) * Math.min(1.5, pointerSpeed / 12 + 0.4);
          const swirlX = (-dy / distance) * influence;
          const swirlY = (dx / distance) * influence;
          const field = p.noise(particle.x * 0.0035, particle.y * 0.0035, time) * p.TWO_PI * 4;

          particle.vx += Math.cos(field) * 0.045 + swirlX * 0.08;
          particle.vy += Math.sin(field) * 0.045 + swirlY * 0.08;
          particle.vx *= 0.965;
          particle.vy *= 0.965;

          const previousX = particle.x;
          const previousY = particle.y;
          particle.x += particle.vx;
          particle.y += particle.vy;
          particle.age -= 1;

          const alpha = p.map(Math.min(260, particle.age), 0, 260, 0.05, 0.42, true);
          p.stroke((particle.hue + pointerSpeed * 0.5) % 360, 92, 92, alpha);
          p.strokeWeight(1.1 + Math.min(2.2, influence));
          p.line(previousX, previousY, particle.x, particle.y);

          if (particle.age <= 0 || particle.x < -80 || particle.x > p.width + 80 || particle.y < -80 || particle.y > p.height + 80) {
            resetParticle(particle);
          }
        }

        p.blendMode(p.BLEND);
        const glowRadius = 90 + Math.min(120, pointerSpeed * 5);
        const context = p.drawingContext as CanvasRenderingContext2D;
        const glow = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, glowRadius);
        glow.addColorStop(0, 'rgba(0,255,65,0.20)');
        glow.addColorStop(0.45, 'rgba(0,255,180,0.07)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = glow;
        context.fillRect(pointer.x - glowRadius, pointer.y - glowRadius, glowRadius * 2, glowRadius * 2);
      };
    };

    void import('p5').then((module) => {
      if (isDisposed) return;
      const P5 = module.default;
      instance = new P5(sketch);
    });

    return () => {
      isDisposed = true;
      window.removeEventListener('pointermove', handlePointerMove);
      instance?.remove();
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" />;
};
