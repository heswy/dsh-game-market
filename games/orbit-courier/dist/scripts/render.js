/**
 * Orbit Courier renderer: one 720×1280 canvas, pure drawing from run state.
 *
 * The visual language is "night ferry around a warm planet": deep indigo space,
 * amber planet core, thin orbital rails, a cyan station gate and warm gold
 * cargo. Sprites come from the package's own PNG assets; if one cannot load the
 * renderer falls back to a procedural shape so a missing asset never blanks the
 * game. `prefers-reduced-motion` removes particles, shake, pulsing and twinkle.
 */

const TAU = Math.PI * 2;
const COLORS = Object.freeze({
  spaceTop: '#070b1a',
  spaceBottom: '#04060f',
  planetCore: '#f6b64a',
  planetEdge: '#7a3f12',
  ring: 'rgba(150, 176, 255, 0.16)',
  ringActive: 'rgba(246, 182, 74, 0.42)',
  station: '#5fe3ff',
  stationSoft: 'rgba(95, 227, 255, 0.18)',
  parcel: '#ffcd6b',
  parcelCore: '#8a4a10',
  ship: '#ffd98a',
  shipGlow: 'rgba(255, 200, 90, 0.35)',
  danger: '#ff6b6b',
  text: '#f6f1e4',
});

export const SPRITE_FILES = Object.freeze({
  ship: 'assets/courier-ship.png',
  parcel: 'assets/cargo-pod.png',
  asteroid: 'assets/asteroid.png',
});

/** Load the PNG sprites; resolves to a map of optional HTMLImageElements. */
export function loadSprites(documentRef) {
  const entries = Object.entries(SPRITE_FILES);
  return Promise.all(entries.map(([name, src]) => new Promise((resolve) => {
    const image = new documentRef.defaultView.Image();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve([name, value]);
    };
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = src;
    if (image.decode) image.decode().catch(() => {});
    setTimeout(() => finish(null), 8000);
  }))).then((pairs) => Object.fromEntries(pairs));
}

function makeStars(count, seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const stars = [];
  for (let index = 0; index < count; index += 1) {
    stars.push({
      x: next(),
      y: next(),
      radius: 0.6 + next() * 1.7,
      alpha: 0.25 + next() * 0.6,
      phase: next() * TAU,
    });
  }
  return stars;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function createRenderer(canvas, options) {
  const level = options.level;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const geometry = level.geometry;
  const rings = geometry.rings;
  const center = geometry.center;
  const stationAngle = geometry.stationAngle;
  const stars = makeStars(140, 0x0b17c0de);
  const sprites = options.sprites || {};
  let reducedMotion = Boolean(options.reducedMotion);
  let shake = 0;
  let particles = [];

  function setReducedMotion(value) {
    reducedMotion = Boolean(value);
    if (reducedMotion) {
      particles = [];
      shake = 0;
    }
  }

  function sprite(name) {
    const image = sprites[name];
    return image && image.width > 0 ? image : null;
  }

  function drawBackground(timeMs) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, COLORS.spaceTop);
    gradient.addColorStop(1, COLORS.spaceBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Distant nebula wash for depth.
    const nebula = ctx.createRadialGradient(width * 0.72, height * 0.22, 10, width * 0.72, height * 0.22, width * 0.9);
    nebula.addColorStop(0, 'rgba(80, 96, 210, 0.16)');
    nebula.addColorStop(1, 'rgba(80, 96, 210, 0)');
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, width, height);

    const twinkle = reducedMotion ? 0 : Math.sin(timeMs / 900);
    for (const star of stars) {
      ctx.globalAlpha = star.alpha * (reducedMotion ? 0.9 : 0.72 + 0.28 * Math.sin(star.phase + timeMs / 1400));
      ctx.fillStyle = twinkle < -0.6 ? '#ffe9c2' : '#dbe4ff';
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * height, star.radius, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlanet(timeMs) {
    const pulse = reducedMotion ? 0 : Math.sin(timeMs / 1600) * 3;
    const coreRadius = 76 + pulse;
    const halo = ctx.createRadialGradient(center.x, center.y, coreRadius * 0.25, center.x, center.y, coreRadius * 3.4);
    halo.addColorStop(0, 'rgba(246, 182, 74, 0.30)');
    halo.addColorStop(0.35, 'rgba(190, 96, 30, 0.12)');
    halo.addColorStop(1, 'rgba(120, 50, 10, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(center.x, center.y, coreRadius * 3.4, 0, TAU);
    ctx.fill();

    const body = ctx.createRadialGradient(center.x - 22, center.y - 26, 8, center.x, center.y, coreRadius);
    body.addColorStop(0, '#ffe1a3');
    body.addColorStop(0.55, COLORS.planetCore);
    body.addColorStop(1, COLORS.planetEdge);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(center.x, center.y, coreRadius, 0, TAU);
    ctx.fill();

    // Latitude bands, clipped to the planet.
    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, coreRadius, 0, TAU);
    ctx.clip();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#5b2a09';
    for (let index = -2; index <= 2; index += 1) {
      ctx.fillRect(center.x - coreRadius, center.y + index * 22 - 4, coreRadius * 2, 8);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawRings(shipRing, timeMs) {
    for (let index = 0; index < rings.length; index += 1) {
      const radius = rings[index];
      const active = index === shipRing;
      ctx.save();
      ctx.strokeStyle = active ? COLORS.ringActive : COLORS.ring;
      ctx.lineWidth = active ? 2.4 : 1.4;
      if (reducedMotion) {
        ctx.setLineDash([]);
      } else {
        ctx.setLineDash(active ? [] : [6, 10]);
        ctx.lineDashOffset = timeMs / 90;
      }
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawStation(timeMs) {
    const outer = rings[rings.length - 1];
    const inner = rings[0];
    const pulse = reducedMotion ? 0.5 : 0.5 + Math.sin(timeMs / 520) * 0.25;

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(stationAngle);
    // Gate beams across every ring.
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = COLORS.station;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(inner - 26, 0);
    ctx.lineTo(outer + 26, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Docking ring at the outermost lane.
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 7;
    ctx.strokeStyle = COLORS.station;
    ctx.beginPath();
    ctx.arc(0, 0, outer, -0.085, 0.085);
    ctx.stroke();

    ctx.globalAlpha = 0.3 + pulse * 0.4;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(0, 0, outer, -0.05, 0.05);
    ctx.stroke();

    // Gate head marker.
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.station;
    ctx.beginPath();
    ctx.arc(outer + 26, 0, 7, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(outer + 26, 0, 14 + pulse * 6, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function pointOnRing(ringIndex, angle) {
    const radius = rings[Math.max(0, Math.min(rings.length - 1, ringIndex))];
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      angle,
      radius,
    };
  }

  function drawParcel(parcel, timeMs) {
    const point = pointOnRing(parcel.ring, parcel.angle);
    const bob = reducedMotion ? 0 : Math.sin(timeMs / 320 + parcel.id) * 2;
    ctx.save();
    ctx.translate(point.x, point.y + bob);
    ctx.rotate(parcel.angle + Math.PI / 2);
    const image = sprite('parcel');
    if (image) {
      const size = 44;
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = COLORS.parcel;
      roundRect(ctx, -13, -13, 26, 26, 6);
      ctx.fill();
      ctx.fillStyle = COLORS.parcelCore;
      ctx.fillRect(-13, -3, 26, 6);
    }
    ctx.restore();

    if (!reducedMotion) {
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.12 * Math.sin(timeMs / 380 + parcel.id);
      ctx.fillStyle = COLORS.parcel;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 30, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawAsteroid(rock, timeMs) {
    const point = pointOnRing(rock.ring, rock.angle);
    const image = sprite('asteroid');
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(rock.angle * (rock.dir > 0 ? 1 : -1) + (reducedMotion ? 0 : timeMs / 2200));
    if (image) {
      const size = rock.ttlMs ? 40 : 48;
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = '#6b6f7d';
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#4a4e5a';
      ctx.beginPath();
      ctx.arc(-6, -4, 7, 0, TAU);
      ctx.fill();
    }
    if (rock.ttlMs) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = COLORS.danger;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawShip(state, timeMs) {
    const ship = state.ship;
    const point = pointOnRing(ship.ring, ship.angle);
    const heading = ship.angle + Math.PI / 2;
    const invulnerable = state.invulnerableMs > 0;
    const blink = invulnerable && !reducedMotion ? 0.45 + 0.55 * Math.abs(Math.sin(timeMs / 90)) : 1;

    ctx.save();
    ctx.globalAlpha = blink;

    // Engine glow trail behind the ship.
    if (!reducedMotion) {
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(heading);
      const flame = ctx.createLinearGradient(0, 16, 0, 54 + Math.sin(timeMs / 70) * 6);
      flame.addColorStop(0, 'rgba(255, 214, 130, 0.75)');
      flame.addColorStop(1, 'rgba(255, 120, 40, 0)');
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(-7, 16);
      ctx.lineTo(7, 16);
      ctx.lineTo(0, 56 + Math.sin(timeMs / 70) * 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(heading);
    const image = sprite('ship');
    if (image) {
      const size = 60;
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = COLORS.ship;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(16, 18);
      ctx.lineTo(0, 10);
      ctx.lineTo(-16, 18);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2a3f6b';
      ctx.beginPath();
      ctx.arc(0, -2, 6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Cargo bay: show what the ship is carrying.
    if (ship.carry) {
      const image = sprite('parcel');
      ctx.save();
      ctx.translate(point.x, point.y + 26);
      if (image) ctx.drawImage(image, -15, -15, 30, 30);
      else {
        ctx.fillStyle = COLORS.parcel;
        roundRect(ctx, -12, -12, 24, 24, 5);
        ctx.fill();
      }
      ctx.restore();
    }

    if (invulnerable) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = COLORS.danger;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 36, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function spawnParticles(events, state) {
    if (reducedMotion) return;
    const point = pointOnRing(state.ship.ring, state.ship.angle);
    const stationPoint = pointOnRing(1, stationAngle);
    const push = (x, y, count, color, speed) => {
      for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * TAU;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed * (0.4 + Math.random()),
          vy: Math.sin(angle) * speed * (0.4 + Math.random()),
          life: 1,
          color,
          size: 2 + Math.random() * 3,
        });
      }
    };
    for (const event of events) {
      if (event === 'collect') push(point.x, point.y, 8, COLORS.parcel, 60);
      else if (event === 'deliver' || event === 'deliver-fast') push(stationPoint.x, stationPoint.y, 16, COLORS.station, 90);
      else if (event === 'hit') {
        push(point.x, point.y, 18, COLORS.danger, 120);
        shake = 10;
      }
    }
  }

  function stepParticles(dtMs) {
    if (reducedMotion || particles.length === 0) return;
    const dt = dtMs / 1000;
    for (const particle of particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.94;
      particle.vy *= 0.94;
      particle.life -= dt * 1.6;
    }
    particles = particles.filter((particle) => particle.life > 0);
    if (shake > 0) shake = Math.max(0, shake - dtMs / 16);
  }

  function drawParticles() {
    for (const particle of particles) {
      ctx.globalAlpha = Math.max(0, particle.life) * 0.9;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const vignette = ctx.createRadialGradient(center.x, center.y, height * 0.28, center.x, center.y, height * 0.78);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function draw(state, timeMs, frame) {
    ctx.save();
    if (shake > 0 && !reducedMotion) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawBackground(timeMs);
    drawPlanet(timeMs);
    drawRings(state.ship.ring, timeMs);
    drawStation(timeMs);
    for (const parcel of state.parcels) drawParcel(parcel, timeMs);
    for (const rock of state.asteroids) drawAsteroid(rock, timeMs);
    drawShip(state, timeMs);
    drawParticles();
    drawVignette();
    ctx.restore();
    if (frame && frame.dtMs) stepParticles(frame.dtMs);
  }

  return {
    draw,
    spawnParticles,
    setReducedMotion,
    get reducedMotion() {
      return reducedMotion;
    },
    geometry: { center, rings, stationAngle, width, height },
  };
}
