import * as THREE from 'https://esm.sh/three@0.160.0';
import { TEXTURE_FILES } from '../data/solarSystemData.js';

// Helper: clamp a value to 0–255
function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

// Helper: create a CanvasTexture tagged as sRGB so colors render correctly
// under ACESFilmic tone mapping + SRGBColorSpace output
export function makeTexture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    return t;
}

// Load a texture file; resolve with procedural fallback if missing
export async function loadPlanetTexture(name, textureLoader) {
    const path = TEXTURE_FILES[name];
    if (!path) return getPlanetTexture(name);
    return new Promise(resolve => {
        textureLoader.load(
            path,
            tex => {
                tex.colorSpace = THREE.SRGBColorSpace;
                resolve(tex);
            },
            undefined,
            () => resolve(getPlanetTexture(name))
        );
    });
}

export function createSaturnRingTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 512, 0);
    // C ring
    grad.addColorStop(0.00, 'rgba(180,160,120,0.10)');
    grad.addColorStop(0.10, 'rgba(190,170,130,0.30)');
    grad.addColorStop(0.16, 'rgba(210,190,150,0.50)');
    // B ring (bright)
    grad.addColorStop(0.18, 'rgba(230,210,170,0.92)');
    grad.addColorStop(0.35, 'rgba(245,225,185,0.95)');
    grad.addColorStop(0.50, 'rgba(235,215,175,0.92)');
    // Cassini division
    grad.addColorStop(0.54, 'rgba(10,5,0,0.05)');
    grad.addColorStop(0.58, 'rgba(10,5,0,0.05)');
    // A ring
    grad.addColorStop(0.60, 'rgba(210,190,150,0.75)');
    grad.addColorStop(0.78, 'rgba(200,180,140,0.65)');
    grad.addColorStop(0.88, 'rgba(180,160,120,0.40)');
    grad.addColorStop(1.00, 'rgba(150,130,100,0.05)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 1);
    return makeTexture(canvas);
}

export function createMoonTexture(baseColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const r = (baseColor >> 16) & 0xFF;
    const g = (baseColor >> 8)  & 0xFF;
    const b =  baseColor        & 0xFF;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 256, 128);

    // Terrain variation patches
    for (let i = 0; i < 32; i++) {
        const x = Math.random() * 256, y = Math.random() * 128;
        const rad = 6 + Math.random() * 22;
        const dr = Math.random() > 0.5 ? 40 : -40;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
        grad.addColorStop(0, `rgba(${clamp255(r+dr)},${clamp255(g+dr)},${clamp255(b+dr)},0.4)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI*2); ctx.fill();
    }

    // Impact craters — bright rim + dark floor
    for (let i = 0; i < 20; i++) {
        const x = Math.random() * 256, y = Math.random() * 128;
        const cr = 2 + Math.random() * 9;
        const rim = ctx.createRadialGradient(x, y, cr*0.5, x, y, cr*1.4);
        rim.addColorStop(0,   'rgba(0,0,0,0)');
        rim.addColorStop(0.6, `rgba(${clamp255(r+55)},${clamp255(g+55)},${clamp255(b+55)},0.55)`);
        rim.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(x, y, cr*1.4, 0, Math.PI*2); ctx.fill();
        const floor = ctx.createRadialGradient(x, y, 0, x, y, cr*0.55);
        floor.addColorStop(0, `rgba(${clamp255(r-65)},${clamp255(g-65)},${clamp255(b-65)},0.65)`);
        floor.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = floor; ctx.beginPath(); ctx.arc(x, y, cr*0.55, 0, Math.PI*2); ctx.fill();
    }
    return makeTexture(canvas);
}

export function createMercuryTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#888880';
    ctx.fillRect(0, 0, 1024, 512);

    // Lighter/darker terrain patches
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * 1024, y = Math.random() * 512;
        const r = 10 + Math.random() * 60;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, Math.random() > 0.5 ? 'rgba(180,175,165,0.6)' : 'rgba(60,55,50,0.5)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    // Craters
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * 1024, y = Math.random() * 512;
        const r = 4 + Math.random() * 20;
        const rim = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.2);
        rim.addColorStop(0,   'rgba(0,0,0,0)');
        rim.addColorStop(0.5, 'rgba(200,195,185,0.6)');
        rim.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(x, y, r * 1.2, 0, Math.PI * 2); ctx.fill();
        const floor = ctx.createRadialGradient(x, y, 0, x, y, r * 0.6);
        floor.addColorStop(0, 'rgba(40,35,30,0.7)'); floor.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = floor; ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.fill();
    }
    return makeTexture(canvas);
}

export function createVenusTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, 512);
    base.addColorStop(0,   '#E8D080');
    base.addColorStop(0.5, '#F0D890');
    base.addColorStop(1,   '#DCC878');
    ctx.fillStyle = base; ctx.fillRect(0, 0, 1024, 512);

    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 20; i++) {
        const y = Math.random() * 512;
        const h = 10 + Math.random() * 30;
        ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,245,200,0.5)' : 'rgba(180,150,80,0.4)';
        ctx.lineWidth = h;
        ctx.beginPath(); ctx.moveTo(0, y);
        for (let x = 0; x < 1024; x += 40) {
            ctx.quadraticCurveTo(x + 20, y + (Math.random() - 0.5) * 20, x + 40, y + (Math.random() - 0.5) * 15);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
    return makeTexture(canvas);
}

export function createEarthTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');

    const ocean = ctx.createLinearGradient(0, 0, 0, 512);
    ocean.addColorStop(0,   '#1a3a6a');
    ocean.addColorStop(0.5, '#2255AA');
    ocean.addColorStop(1,   '#1a3a6a');
    ctx.fillStyle = ocean; ctx.fillRect(0, 0, 1024, 512);

    ctx.fillStyle = '#4a8c3f';
    // North America
    ctx.beginPath();
    ctx.moveTo(155,80);  ctx.lineTo(210,75);  ctx.lineTo(240,90);  ctx.lineTo(255,130);
    ctx.lineTo(245,165); ctx.lineTo(225,200); ctx.lineTo(200,215); ctx.lineTo(185,230);
    ctx.lineTo(175,260); ctx.lineTo(155,270); ctx.lineTo(140,250); ctx.lineTo(130,200);
    ctx.lineTo(120,160); ctx.lineTo(130,120); ctx.closePath(); ctx.fill();
    // South America
    ctx.beginPath();
    ctx.moveTo(195,280); ctx.lineTo(230,275); ctx.lineTo(250,300); ctx.lineTo(255,340);
    ctx.lineTo(245,390); ctx.lineTo(220,420); ctx.lineTo(200,430); ctx.lineTo(185,410);
    ctx.lineTo(175,370); ctx.lineTo(178,330); ctx.lineTo(185,300); ctx.closePath(); ctx.fill();
    // Europe / Asia
    ctx.beginPath();
    ctx.moveTo(460,70);  ctx.lineTo(550,65);  ctx.lineTo(650,70);  ctx.lineTo(750,80);
    ctx.lineTo(820,90);  ctx.lineTo(880,100); ctx.lineTo(900,130); ctx.lineTo(870,160);
    ctx.lineTo(800,170); ctx.lineTo(720,175); ctx.lineTo(650,165); ctx.lineTo(580,170);
    ctx.lineTo(530,155); ctx.lineTo(490,130); ctx.lineTo(460,110); ctx.closePath(); ctx.fill();
    // Africa
    ctx.beginPath();
    ctx.moveTo(480,170); ctx.lineTo(530,165); ctx.lineTo(560,175); ctx.lineTo(570,210);
    ctx.lineTo(575,260); ctx.lineTo(565,320); ctx.lineTo(545,370); ctx.lineTo(520,400);
    ctx.lineTo(500,410); ctx.lineTo(480,395); ctx.lineTo(465,350); ctx.lineTo(460,290);
    ctx.lineTo(460,230); ctx.lineTo(465,200); ctx.closePath(); ctx.fill();
    // Australia
    ctx.beginPath();
    ctx.moveTo(760,290); ctx.lineTo(820,280); ctx.lineTo(870,295); ctx.lineTo(890,330);
    ctx.lineTo(880,370); ctx.lineTo(850,390); ctx.lineTo(800,390); ctx.lineTo(765,370);
    ctx.lineTo(750,340); ctx.lineTo(752,310); ctx.closePath(); ctx.fill();

    // Polar ice caps
    const northIce = ctx.createLinearGradient(0, 0, 0, 60);
    northIce.addColorStop(0, 'rgba(230,245,255,0.9)');
    northIce.addColorStop(1, 'rgba(230,245,255,0)');
    ctx.fillStyle = northIce; ctx.fillRect(0, 0, 1024, 60);
    const southIce = ctx.createLinearGradient(0, 452, 0, 512);
    southIce.addColorStop(0, 'rgba(230,245,255,0)');
    southIce.addColorStop(1, 'rgba(230,245,255,0.9)');
    ctx.fillStyle = southIce; ctx.fillRect(0, 452, 1024, 60);

    // Cloud wisps
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 15; i++) {
        const cx = Math.random() * 1024, cy = 80 + Math.random() * 350;
        const cw = 60 + Math.random() * 150;
        const wg = ctx.createLinearGradient(cx - cw / 2, cy, cx + cw / 2, cy);
        wg.addColorStop(0,   'rgba(255,255,255,0)');
        wg.addColorStop(0.5, 'rgba(255,255,255,0.8)');
        wg.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.fillStyle = wg;
        ctx.fillRect(cx - cw / 2, cy - 5, cw, 10 + Math.random() * 10);
    }
    ctx.globalAlpha = 1.0;
    return makeTexture(canvas);
}

export function createMarsTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, 512);
    base.addColorStop(0,   '#8B3A2A');
    base.addColorStop(0.4, '#C0522A');
    base.addColorStop(0.6, '#AA4422');
    base.addColorStop(1,   '#6E2E1E');
    ctx.fillStyle = base; ctx.fillRect(0, 0, 1024, 512);

    // Terrain variation
    for (let i = 0; i < 150; i++) {
        const x = Math.random() * 1024, y = Math.random() * 512;
        const r = 20 + Math.random() * 80;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, Math.random() > 0.5 ? 'rgba(180,80,40,0.4)' : 'rgba(60,20,10,0.3)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    // Valles Marineris canyon
    ctx.strokeStyle = 'rgba(50,15,8,0.7)'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(350, 240); ctx.quadraticCurveTo(512, 260, 680, 250); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,10,5,0.5)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(350, 248); ctx.quadraticCurveTo(512, 268, 680, 258); ctx.stroke();

    // Craters
    for (let i = 0; i < 25; i++) {
        const x = Math.random() * 1024, y = Math.random() * 512;
        const r = 5 + Math.random() * 25;
        const rim = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.3);
        rim.addColorStop(0,   'rgba(0,0,0,0)');
        rim.addColorStop(0.6, 'rgba(200,150,120,0.5)');
        rim.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(x, y, r * 1.3, 0, Math.PI * 2); ctx.fill();
        const floor = ctx.createRadialGradient(x, y, 0, x, y, r * 0.5);
        floor.addColorStop(0, 'rgba(40,15,8,0.7)'); floor.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = floor; ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
    }

    // Polar ice caps
    const northIce = ctx.createLinearGradient(0, 0, 0, 55);
    northIce.addColorStop(0, 'rgba(240,240,255,0.85)');
    northIce.addColorStop(1, 'rgba(240,240,255,0)');
    ctx.fillStyle = northIce; ctx.fillRect(0, 0, 1024, 55);
    const southIce = ctx.createLinearGradient(0, 458, 0, 512);
    southIce.addColorStop(0, 'rgba(240,240,255,0)');
    southIce.addColorStop(1, 'rgba(240,240,255,0.85)');
    ctx.fillStyle = southIce; ctx.fillRect(0, 458, 1024, 54);
    return makeTexture(canvas);
}

export function createJupiterTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#C8A060'; ctx.fillRect(0, 0, 1024, 512);

    const bands = [
        'rgba(200,140,80,0.7)',  'rgba(240,200,140,0.6)', 'rgba(180,100,50,0.7)',
        'rgba(220,170,100,0.5)', 'rgba(170,90,40,0.6)',   'rgba(240,210,150,0.5)',
        'rgba(160,80,30,0.7)',   'rgba(220,180,110,0.6)', 'rgba(190,120,60,0.7)'
    ];
    for (let i = 0; i < bands.length; i++) {
        const y = (i / bands.length) * 512;
        const bh = (512 / bands.length) + 10;
        ctx.fillStyle = bands[i];
        ctx.beginPath(); ctx.moveTo(0, y);
        for (let x = 0; x <= 1024; x += 30) {
            ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 8);
        }
        ctx.lineTo(1024, y + bh); ctx.lineTo(0, y + bh); ctx.closePath(); ctx.fill();
    }

    // Great Red Spot
    const grsX = 600, grsY = 290, grsRx = 80, grsRy = 45;
    const grs = ctx.createRadialGradient(grsX, grsY, 0, grsX, grsY, grsRx);
    grs.addColorStop(0,   'rgba(180,60,30,0.9)');
    grs.addColorStop(0.5, 'rgba(200,80,40,0.7)');
    grs.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = grs;
    ctx.save();
    ctx.translate(grsX, grsY); ctx.scale(1, grsRy / grsRx); ctx.translate(-grsX, -grsY);
    ctx.beginPath(); ctx.arc(grsX, grsY, grsRx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Turbulent swirls
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 30; i++) {
        const x = Math.random() * 1024, y = Math.random() * 512;
        const r = 15 + Math.random() * 40;
        const sg = ctx.createRadialGradient(x, y, 0, x, y, r);
        sg.addColorStop(0, 'rgba(255,220,150,0.6)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1.0;
    return makeTexture(canvas);
}

export function createSaturnTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, 512);
    base.addColorStop(0,   '#C8A858');
    base.addColorStop(0.5, '#E0C070');
    base.addColorStop(1,   '#C8A858');
    ctx.fillStyle = base; ctx.fillRect(0, 0, 1024, 512);

    for (let i = 0; i < 12; i++) {
        const y = (i / 12) * 512;
        const bh = 512 / 12;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(210,175,100,0.4)' : 'rgba(160,120,60,0.3)';
        ctx.beginPath(); ctx.moveTo(0, y);
        for (let x = 0; x <= 1024; x += 50) {
            ctx.lineTo(x, y + Math.sin(x * 0.015 + i * 0.8) * 5);
        }
        ctx.lineTo(1024, y + bh); ctx.lineTo(0, y + bh); ctx.closePath(); ctx.fill();
    }
    return makeTexture(canvas);
}

export function createUranusTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, 512);
    base.addColorStop(0,   '#5CC8C8');
    base.addColorStop(0.5, '#80E8E0');
    base.addColorStop(1,   '#5CC8C8');
    ctx.fillStyle = base; ctx.fillRect(0, 0, 1024, 512);

    for (let i = 0; i < 8; i++) {
        const y = (i / 8) * 512;
        const bh = 512 / 8;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(100,220,210,0.25)' : 'rgba(40,160,160,0.20)';
        ctx.fillRect(0, y, 1024, bh);
    }
    return makeTexture(canvas);
}

export function createNeptuneTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, 512);
    base.addColorStop(0,   '#182878');
    base.addColorStop(0.5, '#2040AA');
    base.addColorStop(1,   '#182878');
    ctx.fillStyle = base; ctx.fillRect(0, 0, 1024, 512);

    // Cloud bands
    for (let i = 0; i < 10; i++) {
        const y = (i / 10) * 512;
        const bh = 512 / 10 + 5;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(50,80,180,0.4)' : 'rgba(30,50,140,0.3)';
        ctx.beginPath(); ctx.moveTo(0, y);
        for (let x = 0; x <= 1024; x += 40) {
            ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 6);
        }
        ctx.lineTo(1024, y + bh); ctx.lineTo(0, y + bh); ctx.closePath(); ctx.fill();
    }

    // Light wisps
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < 8; i++) {
        const x = Math.random() * 1024, y = 80 + Math.random() * 350;
        const wl = 80 + Math.random() * 200;
        const wg = ctx.createLinearGradient(x, y, x + wl, y);
        wg.addColorStop(0,   'rgba(150,180,255,0)');
        wg.addColorStop(0.5, 'rgba(150,180,255,0.7)');
        wg.addColorStop(1,   'rgba(150,180,255,0)');
        ctx.fillStyle = wg; ctx.fillRect(x, y - 4, wl, 8);
    }
    ctx.globalAlpha = 1.0;

    // Great Dark Spot
    const gds = ctx.createRadialGradient(400, 200, 0, 400, 200, 50);
    gds.addColorStop(0, 'rgba(10,20,80,0.7)');
    gds.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gds;
    ctx.save();
    ctx.translate(400, 200); ctx.scale(1, 0.6); ctx.translate(-400, -200);
    ctx.beginPath(); ctx.arc(400, 200, 50, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return makeTexture(canvas);
}

// Internal dispatcher
function getPlanetTexture(name) {
    switch (name) {
        case 'Mercury': return createMercuryTexture();
        case 'Venus':   return createVenusTexture();
        case 'Earth':   return createEarthTexture();
        case 'Mars':    return createMarsTexture();
        case 'Jupiter': return createJupiterTexture();
        case 'Saturn':  return createSaturnTexture();
        case 'Uranus':  return createUranusTexture();
        case 'Neptune': return createNeptuneTexture();
        default:        return null;
    }
}
