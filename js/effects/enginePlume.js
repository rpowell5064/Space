// enginePlume.js — Film-quality engine plume via InstancedBufferGeometry + custom shaders
// Four layers: core jet (elongated flame streak), plume halo, shimmer (idle), trail (plasma wake)
import * as THREE from 'https://esm.sh/three@0.160.0';

const MAX_PARTICLES = 3000;
const SHIP_SCALE    = 0.012;

// ── Vertex shader ─────────────────────────────────────────────────────────────
const VERT = /* glsl */`
precision highp float;

attribute vec3  aPos;
attribute float aLife;
attribute float aSeed;
attribute float aType;   // 0=core  1=plume  2=shimmer  3=trail

uniform float time;
uniform float thrustLevel;
uniform vec3  camRight;
uniform vec3  camUp;
// World-space direction particles flow away from the nozzle (= -shipForward).
// Used to elongate core/plume billboards into flame streaks.
uniform vec3  exhaustDir;

varying vec2  vUv;
varying float vLife;
varying float vType;
varying float vSeed;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), u);
}

void main() {
    // vUv.y=0 → position.y=-1 → nozzle end of billboard
    // vUv.y=1 → position.y=+1 → trail/tip end
    // (exhaustDir defines which world direction bUp points, so tip = exhaustDir side)
    vUv   = position.xy * 0.5 + 0.5;
    vLife = aLife;
    vType = aType;
    vSeed = aSeed;

    float t = max(aLife, 0.0);

    // ── Size over life ──────────────────────────────────────────────────────
    float size = 0.0;
    if (aType < 0.5) {
        float sBase = 0.0040 + thrustLevel * 0.0030;
        size = pow(t, 0.25) * (0.8 + 0.2 * t) * sBase;
    } else if (aType < 1.5) {
        float sBase = 0.010 + thrustLevel * 0.007;
        size = sqrt(t) * (1.0 - t * 0.20) * sBase;
    } else if (aType < 2.5) {
        // Shimmer: tiny pulsing mote
        float pulse = 0.5 + 0.5 * sin(time * 9.0 + aSeed * 6.2832);
        size = t * 0.003 * pulse;
    } else {
        // Trail: starts tiny, expands as plasma disperses (t high at birth, decays to 0)
        float sBase = 0.013 + thrustLevel * 0.006;
        size = (1.0 - t) * sBase * 1.4;
    }
    if (aLife <= 0.0) size = 0.0;

    // ── Turbulence ─────────────────────────────────────────────────────────
    float turbScale = (aType < 0.5) ? 0.0008 : (aType < 1.5) ? 0.006 : 0.001;
    float ageFrac   = 1.0 - t;
    float nx = vnoise(aSeed * 7.31  + time * 2.40) * 2.0 - 1.0;
    float ny = vnoise(aSeed * 13.71 + time * 1.87) * 2.0 - 1.0;
    float lx = vnoise(aSeed * 3.17  + time * 0.55) * 2.0 - 1.0;
    float ly = vnoise(aSeed * 5.83  + time * 0.47) * 2.0 - 1.0;
    float turbMix = (aType < 0.5) ? ageFrac * 0.35 : ageFrac * 0.80;
    vec3 turb = (camRight * (nx + lx * 0.4) + camUp * (ny + ly * 0.4)) * turbScale * turbMix;

    // ── Billboard ──────────────────────────────────────────────────────────
    // Core + plume: elongated along exhaustDir projected onto the screen plane.
    //   bUp    → exhaust direction (trail tip end = position.y +1)
    //   bRight → perpendicular in screen plane (lateral width)
    //   sx/sy  → asymmetric scale: narrow width, long streak
    // Shimmer + trail: standard camera-aligned square.
    vec3 camFwd = normalize(cross(camRight, camUp));
    vec3 bRight = camRight;
    vec3 bUp    = camUp;
    float sx = size, sy = size;

    if (aType < 1.5) {
        vec3 proj = exhaustDir - dot(exhaustDir, camFwd) * camFwd;
        if (dot(proj, proj) > 0.01) {
            bUp    = normalize(proj);
            bRight = normalize(cross(bUp, camFwd));
        }
        if (aType < 0.5) { sx = size * 0.26; sy = size * 2.60; }   // core: very narrow streak
        else             { sx = size * 0.52; sy = size * 1.65; }   // plume: wider soft streak
    }

    vec3 worldPos = aPos + turb;
    worldPos += bRight * position.x * sx;
    worldPos += bUp    * position.y * sy;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

// ── Fragment shader ───────────────────────────────────────────────────────────
const FRAG = /* glsl */`
precision highp float;

uniform float time;
uniform float thrustLevel;

varying vec2  vUv;
varying float vLife;
varying float vType;
varying float vSeed;

// Core: white-hot at nozzle → electric blue mid → deep violet at trail tip
vec3 coreColor(float t, float thrust) {
    vec3 hot  = mix(vec3(0.90, 0.96, 1.00), vec3(0.84, 0.80, 1.00), thrust);
    vec3 mid  = mix(vec3(0.10, 0.60, 1.00), vec3(0.50, 0.30, 1.00), thrust * thrust);
    vec3 cool = mix(vec3(0.04, 0.12, 0.85), vec3(0.20, 0.04, 0.72), thrust);
    if (t > 0.65) return mix(mid,  hot,  (t - 0.65) / 0.35);
    if (t > 0.25) return mix(cool, mid,  (t - 0.25) / 0.40);
    return cool * (t / 0.25 * 0.5 + 0.5);
}

// Plume halo: soft blue-cyan wrapping the core, deepens to indigo
vec3 plumeColor(float t, float thrust) {
    vec3 bright = mix(vec3(0.04, 0.52, 1.00), vec3(0.40, 0.20, 1.00), thrust * thrust);
    vec3 dim    = mix(vec3(0.00, 0.04, 0.48), vec3(0.10, 0.02, 0.44), thrust);
    return mix(dim, bright, t * t);
}

void main() {
    vec2  uv = vUv * 2.0 - 1.0;  // −1..1;  uv.y=-1 = nozzle base, uv.y=+1 = trail tip
    float r  = length(uv);
    float t  = max(vLife, 0.0);

    vec3  col;
    float alpha;

    if (vType < 0.5) {
        // ── Core flame streak ─────────────────────────────────────────────
        // Narrow in X, asymmetric in Y:
        //   uv.y < 0 (nozzle side): slow Gaussian falloff → wide bright base
        //   uv.y > 0 (tip side):    fast Gaussian falloff → pinches to a point
        // Together they produce a teardrop / candle-flame silhouette.
        float xGlow  = exp(-uv.x * uv.x * 10.0);
        float yBase  = max(0.0, -uv.y);                              // 1 at nozzle, 0 at tip
        float yTip   = max(0.0,  uv.y);                              // 0 at nozzle, 1 at tip
        float yGlow  = exp(-yBase * yBase * 1.0 - yTip * yTip * 3.8);
        float glow   = xGlow * yGlow;

        float lifeFade = smoothstep(0.0, 0.06, t) * (t * 0.35 + 0.65);
        alpha = glow * lifeFade * 0.82;

        col = coreColor(t, thrustLevel);

        // Chromatic aberration — heat shimmer strongest at nozzle base
        float cs  = t * 0.11;
        float rr  = length(vec2(uv.x + cs, uv.y));
        float bb  = length(vec2(uv.x - cs, uv.y));
        col.r += (1.0 - smoothstep(0.4, 1.0, rr)) * cs * 1.4;
        col.b += (1.0 - smoothstep(0.4, 1.0, bb)) * cs * 1.0;

        col *= (0.46 + thrustLevel * 0.28);

    } else if (vType < 1.5) {
        // ── Plume halo ─────────────────────────────────────────────────────
        // Softer, wider version of the core flame shape.
        float xGlow  = exp(-uv.x * uv.x * 3.2);
        float yBase  = max(0.0, -uv.y);
        float yTip   = max(0.0,  uv.y);
        float yGlow  = exp(-yBase * yBase * 0.5 - yTip * yTip * 2.0);
        float glow   = xGlow * yGlow;

        float lifeFade = smoothstep(0.0, 0.10, t) * sqrt(t);
        alpha = glow * lifeFade * (0.28 + thrustLevel * 0.08);

        col = plumeColor(t, thrustLevel);
        col *= (0.18 + thrustLevel * 0.10);

    } else if (vType < 2.5) {
        // ── Shimmer (idle only) ─────────────────────────────────────────────
        if (r > 1.0) discard;
        float glow = exp(-r * r * 11.0);
        alpha = glow * t * 0.60;
        col   = vec3(0.28, 0.55, 1.00);

    } else {
        // ── Trail — plasma wake ─────────────────────────────────────────────
        // Round soft blob. Fades in as it expands, then out as it dies.
        // peak at mid-life (sin fade). Deep indigo → near-transparent.
        if (r > 1.0) discard;
        float glow    = exp(-r * r * 2.8);
        float midFade = sin(t * 3.14159);           // 0 at birth and death, 1 at mid
        alpha = glow * midFade * 0.20;
        col   = mix(vec3(0.02, 0.05, 0.45), vec3(0.08, 0.22, 0.88), t);
        col  *= (0.28 + thrustLevel * 0.08);
    }

    gl_FragColor = vec4(col * alpha, alpha);
}
`;

// ── EnginePlume class ─────────────────────────────────────────────────────────
export class EnginePlume {
    constructor(scene, exits) {
        this._scene = scene;
        this._exits = exits;

        this._count = MAX_PARTICLES;
        this._head  = 0;

        this._pos  = new Float32Array(this._count * 3).fill(1e6);
        this._vel  = new Float32Array(this._count * 3);
        this._life = new Float32Array(this._count);
        this._type = new Float32Array(this._count);
        this._seed = new Float32Array(this._count);
        for (let i = 0; i < this._count; i++) this._seed[i] = Math.random();

        // Updated each spawn call; passed to shader so billboards orient correctly
        this._exhaustDir = new THREE.Vector3(0, 0, 1);

        this._buildMesh();
    }

    _buildMesh() {
        const geo = new THREE.InstancedBufferGeometry();

        const qp = new Float32Array([
            -1,-1, 0,   1,-1, 0,   1, 1, 0,
            -1,-1, 0,   1, 1, 0,  -1, 1, 0,
        ]);
        geo.setAttribute('position', new THREE.BufferAttribute(qp, 3));
        geo.instanceCount = this._count;

        this._aPosAttr  = new THREE.InstancedBufferAttribute(this._pos,  3, false, 1);
        this._aLifeAttr = new THREE.InstancedBufferAttribute(this._life, 1, false, 1);
        this._aSeedAttr = new THREE.InstancedBufferAttribute(this._seed, 1, false, 1);
        this._aTypeAttr = new THREE.InstancedBufferAttribute(this._type, 1, false, 1);

        geo.setAttribute('aPos',  this._aPosAttr);
        geo.setAttribute('aLife', this._aLifeAttr);
        geo.setAttribute('aSeed', this._aSeedAttr);
        geo.setAttribute('aType', this._aTypeAttr);

        this._mat = new THREE.ShaderMaterial({
            vertexShader:   VERT,
            fragmentShader: FRAG,
            uniforms: {
                time:        { value: 0 },
                thrustLevel: { value: 0 },
                camRight:    { value: new THREE.Vector3(1, 0, 0) },
                camUp:       { value: new THREE.Vector3(0, 1, 0) },
                exhaustDir:  { value: new THREE.Vector3(0, 0, 1) },
            },
            transparent:  true,
            blending:     THREE.AdditiveBlending,
            depthWrite:   false,
            depthTest:    true,
            side:         THREE.DoubleSide,
        });

        this._mesh = new THREE.Mesh(geo, this._mat);
        this._mesh.frustumCulled = false;
        this._scene.add(this._mesh);
    }

    spawn(countPerEngine, shipPos, shipQuat, shipVel, angVel, forward, thrust, boost, dt) {
        const t  = Math.max(0, Math.min(1, thrust));
        const q  = shipQuat;
        const vx = shipVel.x * dt;
        const vy = shipVel.y * dt;
        const vz = shipVel.z * dt;

        // Exhaust flows away from the nozzle (opposite to ship forward)
        this._exhaustDir.copy(forward).negate();

        // Perpendicular basis for cone spread
        const rt = new THREE.Vector3(forward.y, -forward.x, 0);
        if (rt.lengthSq() < 0.01) rt.set(0, forward.z, -forward.y);
        rt.normalize();
        const up = new THREE.Vector3().crossVectors(forward, rt);

        // ── Idle shimmer ─────────────────────────────────────────────────────
        if (t < 0.12) {
            for (let eng = 0; eng < this._exits.length; eng++) {
                const nOff  = this._exits[eng].clone().multiplyScalar(SHIP_SCALE).applyQuaternion(q);
                const we    = nOff.clone().add(shipPos);
                const stang = angVel.clone().cross(nOff).multiplyScalar(dt);
                for (let n = 0; n < 3; n++) {
                    const idx = this._head % this._count; this._head++;
                    const sp  = 0.0005 + Math.random() * 0.0004;
                    const th  = Math.random() * Math.PI * 2;
                    this._pos[idx*3]   = we.x;
                    this._pos[idx*3+1] = we.y;
                    this._pos[idx*3+2] = we.z;
                    this._vel[idx*3]   = vx + stang.x - forward.x*0.002 + (rt.x*Math.cos(th)+up.x*Math.sin(th))*sp;
                    this._vel[idx*3+1] = vy + stang.y - forward.y*0.002 + (rt.y*Math.cos(th)+up.y*Math.sin(th))*sp;
                    this._vel[idx*3+2] = vz + stang.z - forward.z*0.002 + (rt.z*Math.cos(th)+up.z*Math.sin(th))*sp;
                    this._life[idx]    = 0.22 + Math.random() * 0.12;
                    this._type[idx]    = 2;
                    this._seed[idx]    = Math.random();
                }
            }
            return;
        }

        // Ensure particles move backward past the camera at any flight speed.
        // Camera sits 0.38 wu behind ship centre; nozzles are only 0.035 wu behind.
        const shipFwdDisp = Math.max(0, vx*forward.x + vy*forward.y + vz*forward.z);

        // Particle budget: 55% core, 25% plume, 20% trail
        const coreN  = Math.max(2, Math.floor(countPerEngine * 0.55));
        const plumeN = Math.max(1, Math.floor(countPerEngine * 0.25));
        const trailN = Math.max(1, Math.floor(countPerEngine * 0.20));

        for (let eng = 0; eng < this._exits.length; eng++) {
            const nozzleOff = this._exits[eng].clone().multiplyScalar(SHIP_SCALE).applyQuaternion(q);
            const we = nozzleOff.clone().add(shipPos);

            // Tangential velocity from ship rotation — keeps trail locked to nozzle
            const tang = angVel.clone().cross(nozzleOff).multiplyScalar(dt);
            const tx = tang.x, ty = tang.y, tz = tang.z;

            // ── Core: tight jet flame ─────────────────────────────────────────
            // Spawns right at the nozzle mouth, tight cone, short-lived.
            // The elongated billboard + asymmetric gaussian makes these look like
            // individual bright streaks of the jet flame.
            for (let n = 0; n < coreN; n++) {
                const idx     = this._head % this._count; this._head++;
                const baseSpd = (0.055 + Math.random()*0.035) * (0.30 + t*0.70) * (1.0 + boost*0.20);
                const spd     = Math.min(Math.max(baseSpd, shipFwdDisp * 1.12), shipFwdDisp + 0.35);
                const cone    = (0.010 + boost*0.014) * Math.random(); // tight cone → coherent jet
                const th      = Math.random() * Math.PI * 2;
                const sr      = cone * spd;
                const back    = 0.004 + Math.random() * 0.012; // right at nozzle
                this._pos[idx*3]   = we.x - forward.x * back;
                this._pos[idx*3+1] = we.y - forward.y * back;
                this._pos[idx*3+2] = we.z - forward.z * back;
                this._vel[idx*3]   = vx + tx - forward.x*spd + (rt.x*Math.cos(th)+up.x*Math.sin(th))*sr;
                this._vel[idx*3+1] = vy + ty - forward.y*spd + (rt.y*Math.cos(th)+up.y*Math.sin(th))*sr;
                this._vel[idx*3+2] = vz + tz - forward.z*spd + (rt.z*Math.cos(th)+up.z*Math.sin(th))*sr;
                this._life[idx]    = 0.28 + t*0.22 + boost*0.06;
                this._type[idx]    = 0;
                this._seed[idx]    = Math.random();
            }

            // ── Plume: soft glow wrapping the core ────────────────────────────
            // Slightly wider cone, same elongation in shader but softer gaussian.
            for (let n = 0; n < plumeN; n++) {
                const idx     = this._head % this._count; this._head++;
                const baseSpd = (0.020 + Math.random()*0.020) * (0.20 + t*0.80);
                const spd     = Math.min(Math.max(baseSpd, shipFwdDisp * 1.08), shipFwdDisp + 0.26);
                const cone    = (0.055 + boost*0.055) * Math.random();
                const th      = Math.random() * Math.PI * 2;
                const sr      = cone * spd;
                const back    = 0.006 + Math.random() * 0.020;
                this._pos[idx*3]   = we.x - forward.x * back;
                this._pos[idx*3+1] = we.y - forward.y * back;
                this._pos[idx*3+2] = we.z - forward.z * back;
                this._vel[idx*3]   = vx + tx - forward.x*spd + (rt.x*Math.cos(th)+up.x*Math.sin(th))*sr;
                this._vel[idx*3+1] = vy + ty - forward.y*spd + (rt.y*Math.cos(th)+up.y*Math.sin(th))*sr;
                this._vel[idx*3+2] = vz + tz - forward.z*spd + (rt.z*Math.cos(th)+up.z*Math.sin(th))*sr;
                this._life[idx]    = 0.26 + t*0.18 + boost*0.05;
                this._type[idx]    = 1;
                this._seed[idx]    = Math.random();
            }

            // ── Trail: slow-drifting plasma wake ──────────────────────────────
            // Much slower ejection, wide cone, long life. These are the "trail"
            // particles — round soft blobs that expand and fade behind the ship.
            for (let n = 0; n < trailN; n++) {
                const idx     = this._head % this._count; this._head++;
                const baseSpd = (0.006 + Math.random()*0.008) * (0.08 + t*0.45);
                const spd     = Math.min(Math.max(baseSpd, shipFwdDisp * 0.92), shipFwdDisp + 0.10);
                const cone    = (0.14 + boost*0.08) * Math.random();
                const th      = Math.random() * Math.PI * 2;
                const sr      = cone * spd;
                const back    = 0.010 + Math.random() * 0.040;
                this._pos[idx*3]   = we.x - forward.x * back;
                this._pos[idx*3+1] = we.y - forward.y * back;
                this._pos[idx*3+2] = we.z - forward.z * back;
                this._vel[idx*3]   = vx + tx - forward.x*spd + (rt.x*Math.cos(th)+up.x*Math.sin(th))*sr;
                this._vel[idx*3+1] = vy + ty - forward.y*spd + (rt.y*Math.cos(th)+up.y*Math.sin(th))*sr;
                this._vel[idx*3+2] = vz + tz - forward.z*spd + (rt.z*Math.cos(th)+up.z*Math.sin(th))*sr;
                // Life capped at 0.90 so trail size formula (1-t) stays non-negative at birth
                this._life[idx]    = 0.55 + Math.random() * 0.35;
                this._type[idx]    = 3;
                this._seed[idx]    = Math.random();
            }
        }
    }

    tick(dt, camera, thrustLevel, time) {
        const speedScale = 1.0 + thrustLevel * 3.5;
        const cDecay = dt * 1.50 * speedScale;  // core  — brief, sharp streak
        const pDecay = dt * 0.90 * speedScale;  // plume — slightly longer
        const sDecay = dt * 2.20;               // shimmer — always fast
        const tDecay = dt * 0.25 * speedScale;  // trail — lingers for wake effect

        for (let i = 0; i < this._count; i++) {
            if (this._life[i] <= 0) continue;

            const tp    = this._type[i];
            const decay = tp < 0.5 ? cDecay
                        : tp < 1.5 ? pDecay
                        : tp < 2.5 ? sDecay
                        : tDecay;

            this._life[i] -= decay;
            if (this._life[i] <= 0) {
                this._life[i] = 0;
                this._pos[i*3] = this._pos[i*3+1] = this._pos[i*3+2] = 1e6;
                continue;
            }

            this._pos[i*3]   += this._vel[i*3];
            this._pos[i*3+1] += this._vel[i*3+1];
            this._pos[i*3+2] += this._vel[i*3+2];
        }

        this._aPosAttr.needsUpdate  = true;
        this._aLifeAttr.needsUpdate = true;
        this._aSeedAttr.needsUpdate = true;
        this._aTypeAttr.needsUpdate = true;

        const u = this._mat.uniforms;
        u.time.value        = time;
        u.thrustLevel.value = Math.max(0, Math.min(1, thrustLevel));
        u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
        u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
        u.exhaustDir.value.copy(this._exhaustDir);
    }

    dispose() {
        this._mesh.geometry.dispose();
        this._mat.dispose();
        this._scene.remove(this._mesh);
    }
}
