// spaceship.js — Flyable spacecraft with engine particle trails + orbital insertion
// Controls: W/S throttle · A/D yaw · Q/E roll · Mouse pitch+yaw
//           Arrow keys strafe · Space boost · Shift brake · G warp to target · F exit
import * as THREE from 'https://esm.sh/three@0.160.0';

// ── Constants ──────────────────────────────────────────────────────────────
const SHIP_SCALE = 0.012;

// Flight physics — scaled for real AU distances (1 AU = 100 scene units)
const THRUST        = 25.0;   // units/s² smooth engine acceleration
const MIN_SPEED     = 0.5;    // units/s — idle drift so ship never fully stalls
const CRUISE_MAX       = 13.0;  // units/s — W/S ceiling; Space boost breaks through this
const MAX_SPEED        = 25.0;  // units/s — boost ceiling (HUD normalises to 0–100%)
const BOOST_DURATION   = 3.5;   // seconds of continuous boost before charge depletes
const BOOST_RECHARGE   = 0.28;  // charge/second when not boosting (full in ~3.6 s)
const LAT_DRAG      = 2.5;    // lateral grip — tracks nose without jerking at speed
const BRAKE_FORCE   = 35.0;   // hard braking — full stop from max in ~3 s
const STRAFE_FORCE  = 1.8;

// Steering — angular velocity model for X-Wing-style inertial feel
const TURN_RATE_MAX    = 1.6;  // rad/s max angular velocity
const ANGULAR_RESPONSE = 2.0;  // lower = heavier/more inertial steering feel
const ANGULAR_DAMP     = 6.0;  // how quickly spin bleeds off when aim is centered
const AD_YAW_RATE      = 0.9;  // extra yaw from A/D keys (rad/s)
const ROLL_RATE        = 0.025;
const ARROW_RATE       = 0.016;

// Inversion — always inverted (cursor/joystick up → nose down, right → nose left)
const PITCH_SIGN = -1;
const YAW_SIGN   = -1;

// Camera
const CAM_OFFSET     = new THREE.Vector3(0, 0.22, 0.38);
const CAM_SMOOTH     = 28;   // exponential smoothing rate for camera position
const LOOK_SMOOTH    = 20;   // exponential smoothing rate for look-at target
const CAM_MAX_LAG    = 0.16; // hard clamp: camera never drifts further than this from target

// Orbit
const ORBIT_TRIGGER_MULT = 4.0;   // × planet radius → triggers orbit insertion
const ORBIT_STABLE_MULT  = 3.5;   // × planet radius → stable orbit radius
const ORBIT_CAM_LERP     = 0.035; // slow cinematic camera pull for orbit view

export class ShipController {
    constructor(scene, camera, orbitControls, domElement) {
        this.scene         = scene;
        this.camera        = camera;
        this.orbitControls = orbitControls;
        this.domElement    = domElement;

        this.active        = false;
        this._vel          = new THREE.Vector3();
        this._targetSpeed  = 0;
        this._camLookAt    = new THREE.Vector3();
        this.keys          = {};
        // Cursor steering — absolute NDC position of mouse. (0,0) = center = fly straight.
        this._mouseNDC      = new THREE.Vector2(0, 0);
        this._cursorInWindow = true;  // false while cursor is outside the browser window
        this._raycaster     = new THREE.Raycaster();
        // Angular velocity (rad/s) — gives steering inertia/lag
        this._angVelYaw    = 0;
        this._angVelPitch  = 0;
        this._angVelRoll   = 0;
        // Fades mouse influence from 0→1 over 0.5s after orbit exit / fly entry
        // Prevents the ship from snapping to wherever the cursor happens to be
        this._mouseBlendIn = 0;
        this._fullThrottle = false; // Space key latches boost until charge runs out or W/S pressed
        this._boostCharge  = 1.0;  // 0.0–1.0; drains while boosting, recharges otherwise

        // Bodies (planets + sun) for orbit detection; planets for crosshair lock-on
        this._bodies       = [];
        this._planets      = [];  // [{ mesh, data, group }] — planets only, no sun

        // Orbit state
        this._orbitMode    = false;
        this._orbitBody    = null;
        this._orbitRadius  = 0;
        this._orbitAngle   = 0;
        this._orbitSpeed   = 0;
        this._orbitCooldown = 0;  // seconds before orbit re-entry is allowed after break

        // Warp animation state
        this._warpAnimating  = false;
        this._warpStartPos   = new THREE.Vector3();
        this._warpEndPos     = new THREE.Vector3();
        this._warpEntryAngle = 0;
        this._warpProgress   = 0;
        this._warpDuration   = 4.0;  // seconds for cinematic travel

        // Warp target (set from outside via setWarpTarget)
        this._warpTarget   = null;

        // Base camera FOV (stored on enter so warp effect can modify + restore)
        this._baseFOV      = 60;

        // Orbit event callbacks — wired from main.js
        this.onOrbitEnter  = null;  // (bodyName: string) => void
        this.onOrbitExit   = null;  // () => void

        // Mission autopilot flag — set by ArtemisMission (and future missions)
        // to suppress normal physics while the scripted path drives the ship.
        this._missionActive = false;

        this._isMobile = navigator.maxTouchPoints > 0;

        this.shipGroup = new THREE.Group();
        this.shipGroup.scale.setScalar(SHIP_SCALE);
        this.shipGroup.visible = false;
        scene.add(this.shipGroup);

        this._engineGlows = [];
        this._buildHull();
        this._buildEngineParticles();
        this._addHUD();
        this._addWarpFlash();
        this._bindEvents();
    }

    // ── External API ──────────────────────────────────────────────────────
    setBodies(bodies) {
        this._bodies = bodies;
    }

    setPlanets(planets) {
        this._planets = planets;  // used for crosshair lock-on; excludes the sun
    }

    setWarpTarget(body) {
        this._warpTarget = body;
        if (this._warpHintEl) {
            this._warpHintEl.textContent = body
                ? `${this._isMobile ? '' : 'G · '}WARP TO ${body.name.toUpperCase()}`
                : '';
        }
        // Update crosshair targeting state
        const ch = document.getElementById('hudCrosshair');
        if (ch) ch.classList.toggle('targeting', !!body);
        // Clear distance readout when target changes
        if (this._targetDistEl) this._targetDistEl.textContent = '';
    }

    // ── Ship mesh ─────────────────────────────────────────────────────────
    _buildHull() {
        const hull = new THREE.MeshStandardMaterial({
            color: 0x2a4060, metalness: 0.82, roughness: 0.20,
            emissive: 0x0d1e2c, emissiveIntensity: 1.2
        });
        const panel = new THREE.MeshStandardMaterial({
            color: 0x3a5270, metalness: 0.70, roughness: 0.30,
            emissive: 0x122030, emissiveIntensity: 0.8
        });
        const accent = new THREE.MeshStandardMaterial({
            color: 0x00bbff, metalness: 0.98, roughness: 0.05,
            emissive: 0x0055ee, emissiveIntensity: 2.5
        });
        const glass = new THREE.MeshStandardMaterial({
            color: 0x77ddff, transparent: true, opacity: 0.48,
            roughness: 0.0, metalness: 0.08,
            emissive: 0x1a3355, emissiveIntensity: 1.2
        });
        const nozzle = new THREE.MeshStandardMaterial({
            color: 0xaaeeff, emissive: 0x2266ff,
            emissiveIntensity: 6.0, transparent: true, opacity: 0.93
        });

        const add = (geo, mat, px=0, py=0, pz=0, rx=0, ry=0, rz=0) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(px, py, pz);
            m.rotation.set(rx, ry, rz);
            this.shipGroup.add(m);
            return m;
        };

        // ── Fuselage ──────────────────────────────────────────────────────
        add(new THREE.ConeGeometry(0.16, 1.8, 8),            hull, 0, 0, -5.2, -Math.PI/2, 0, 0);
        add(new THREE.CylinderGeometry(0.16, 0.42, 1.6, 10), hull, 0, 0, -3.8,  Math.PI/2, 0, 0);
        add(new THREE.CylinderGeometry(0.42, 0.55, 2.6, 12), hull, 0, 0, -2.1,  Math.PI/2, 0, 0);
        add(new THREE.CylinderGeometry(0.55, 0.58, 1.4, 12), hull, 0, 0.05, -0.2, Math.PI/2, 0, 0);
        add(new THREE.CylinderGeometry(0.58, 0.65, 2.0, 12), hull, 0, 0,  1.2,  Math.PI/2, 0, 0);
        add(new THREE.CylinderGeometry(0.65, 0.60, 1.0, 12), hull, 0, 0,  2.7,  Math.PI/2, 0, 0);

        // ── Dorsal spine ──
        add(new THREE.BoxGeometry(0.12, 0.22, 3.6), panel, 0, 0.70, -1.6);
        add(new THREE.BoxGeometry(0.08, 0.14, 1.8), panel, 0, 0.76,  1.0);
        add(new THREE.ConeGeometry(0.08, 0.6, 6),   panel, 0, 0.80, -3.6, -Math.PI/2, 0, 0);

        // ── Cockpit ──
        add(new THREE.SphereGeometry(0.35, 20, 14, 0, Math.PI*2, 0, Math.PI*0.55), glass,  0, 0.76, -2.6);
        add(new THREE.TorusGeometry(0.36, 0.028, 8, 28), accent, 0, 0.76, -2.6, Math.PI/2, 0, 0);
        add(new THREE.BoxGeometry(0.018, 0.018, 0.70), accent, 0, 1.07, -2.6);
        add(new THREE.BoxGeometry(0.70,  0.018, 0.018), accent, 0, 1.07, -2.6);

        // ── Delta wings ──
        [-1, 1].forEach(side => {
            const ws = new THREE.Shape();
            ws.moveTo(0,          -2.8);
            ws.lineTo(side * 1.2, -1.5);
            ws.lineTo(side * 4.2,  1.0);
            ws.lineTo(side * 4.8,  1.8);
            ws.lineTo(side * 5.0,  2.4);
            ws.lineTo(side * 4.8,  2.8);
            ws.lineTo(side * 4.0,  2.8);
            ws.lineTo(side * 3.8,  2.4);
            ws.lineTo(side * 0.5,  2.8);
            ws.lineTo(0,           2.8);
            ws.closePath();
            const wm = new THREE.Mesh(
                new THREE.ExtrudeGeometry(ws, { depth: 0.08, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.03, bevelSegments: 1 }),
                hull
            );
            wm.rotation.x = Math.PI / 2;
            wm.position.set(0, -0.06, 0);
            this.shipGroup.add(wm);

            // Leading-edge accent stripe
            const ls = new THREE.Shape();
            ls.moveTo(side * 0.05, -2.79);
            ls.lineTo(side * 0.24, -2.79);
            ls.lineTo(side * 4.34,  1.00);
            ls.lineTo(side * 4.15,  1.00);
            ls.closePath();
            const lm = new THREE.Mesh(
                new THREE.ExtrudeGeometry(ls, { depth: 0.09, bevelEnabled: false }),
                accent
            );
            lm.rotation.x = Math.PI / 2;
            lm.position.set(0, -0.02, 0);
            this.shipGroup.add(lm);

            // Under-wing sensor pod
            add(new THREE.CylinderGeometry(0.09, 0.11, 1.5, 8), panel,  side*2.2, -0.24, 0.8, Math.PI/2, 0, 0);
            add(new THREE.ConeGeometry(0.09, 0.44, 8),           panel,  side*2.2, -0.24, -0.07, -Math.PI/2, 0, 0);
            add(new THREE.TorusGeometry(0.10, 0.022, 6, 16),     accent, side*2.2, -0.24, 0.38, Math.PI/2, 0, 0);

            // Wingtip nav light — red port, green starboard
            add(new THREE.SphereGeometry(0.065, 8, 6),
                new THREE.MeshStandardMaterial({
                    color:    side < 0 ? 0xff2200 : 0x00ff44,
                    emissive: side < 0 ? 0xcc0000 : 0x00cc22,
                    emissiveIntensity: 4.5, transparent: true, opacity: 0.95
                }),
                side * 5.0, -0.06, 2.5);
        });

        // ── Dorsal fin ──
        const fin = new THREE.Shape();
        fin.moveTo(0, 0); fin.lineTo(0, 1.5); fin.lineTo(-0.28, 1.44);
        fin.lineTo(-1.9, 0.28); fin.lineTo(-1.9, 0); fin.closePath();
        const finMesh = new THREE.Mesh(
            new THREE.ExtrudeGeometry(fin, { depth: 0.038, bevelEnabled: false }), hull
        );
        finMesh.rotation.y = -Math.PI / 2;
        finMesh.position.set(0.019, 0.82, 1.6);
        this.shipGroup.add(finMesh);
        add(new THREE.BoxGeometry(0.013, 1.18, 0.032), accent, 0, 1.38, 1.75);

        // ── Engine nacelles ──
        [[-1.10, -0.20], [1.10, -0.20]].forEach(([ex, ey]) => {
            add(new THREE.ConeGeometry(0.18, 0.65, 12),           hull,   ex, ey, -0.72, -Math.PI/2, 0, 0);
            add(new THREE.CylinderGeometry(0.18, 0.24, 3.0, 14),  hull,   ex, ey,  1.0,   Math.PI/2, 0, 0);
            add(new THREE.CylinderGeometry(0.24, 0.21, 0.35, 14), hull,   ex, ey,  2.68,  Math.PI/2, 0, 0);
            add(new THREE.TorusGeometry(0.19, 0.028, 8, 22), accent, ex, ey, -0.40, Math.PI/2, 0, 0);
            add(new THREE.TorusGeometry(0.25, 0.035, 8, 22), accent, ex, ey,  0.55, Math.PI/2, 0, 0);
            add(new THREE.TorusGeometry(0.25, 0.032, 8, 22), accent, ex, ey,  2.22, Math.PI/2, 0, 0);
            add(new THREE.TorusGeometry(0.22, 0.026, 8, 22), accent, ex, ey,  2.58, Math.PI/2, 0, 0);
            // Intake inner glow (BackSide — visible from the front of nacelle)
            add(new THREE.CircleGeometry(0.13, 16),
                new THREE.MeshStandardMaterial({ color: 0x3366ff, emissive: 0x1133cc, emissiveIntensity: 2.5, transparent: true, opacity: 0.65, side: THREE.BackSide }),
                ex, ey, -1.04);
            // Nozzle outer glow disk
            this._engineGlows.push(add(new THREE.CircleGeometry(0.21, 22), nozzle, ex, ey, 2.88));
            // Nozzle inner core
            this._engineGlows.push(add(
                new THREE.CircleGeometry(0.10, 22),
                new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x99ddff, emissiveIntensity: 9.0, transparent: true, opacity: 0.98 }),
                ex, ey, 2.89
            ));
        });

        // ── Nose light ──
        add(new THREE.SphereGeometry(0.048, 8, 6),
            new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xaaccff, emissiveIntensity: 5.0, transparent: true, opacity: 0.95 }),
            0, 0, -6.1);

        // ── Ventral keel ──
        add(new THREE.BoxGeometry(0.26, 0.06, 2.6), panel,  0, -0.58, -0.8);
        add(new THREE.BoxGeometry(0.07, 0.04, 1.4), accent, 0, -0.61, -0.8);

        // ── Scene lights ──
        const fill1 = new THREE.PointLight(0x88bbff, 14.0, 80);
        fill1.position.set(0, 3, -3); this.shipGroup.add(fill1);
        const fill2 = new THREE.PointLight(0xffeedd, 6.0, 60);
        fill2.position.set(0, -2.5, 1.5); this.shipGroup.add(fill2);
        // Engine point light — intensity driven by thrust in update()
        this._engineLight = new THREE.PointLight(0x44aaff, 4.0, 28);
        this._engineLight.position.set(0, 0, 4.2);
        this.shipGroup.add(this._engineLight);
    }

    // ── Engine particles ───────────────────────────────────────────────────
    _buildEngineParticles() {
        const coreSprite  = this._makeGlowSprite(true);   // tight bright core
        const plumeSprite = this._makeGlowSprite(false);  // soft diffuse halo

        this._core  = this._makeLayer(1400, 0.034, coreSprite);
        this._cLife = new Float32Array(1400);
        this._cVel  = new Float32Array(1400 * 3);
        this._cHead = 0;

        this._plume  = this._makeLayer(1200, 0.120, plumeSprite);
        this._pLife  = new Float32Array(1200);
        this._pVel   = new Float32Array(1200 * 3);
        this._pHead  = 0;

        // Match updated nacelle nozzle positions
        this._exits = [
            new THREE.Vector3(-1.10, -0.20, 2.88),
            new THREE.Vector3( 1.10, -0.20, 2.88),
        ];
    }

    _makeLayer(maxCount, pointSize, texture) {
        const pos = new Float32Array(maxCount * 3).fill(1e6);
        const col = new Float32Array(maxCount * 3);
        const geo = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(pos, 3);
        const colAttr = new THREE.BufferAttribute(col, 3);
        geo.setAttribute('position', posAttr);
        geo.setAttribute('color',    colAttr);
        geo.setDrawRange(0, maxCount);

        const mat = new THREE.PointsMaterial({
            size: pointSize, map: texture,
            vertexColors: true, sizeAttenuation: true,
            transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });

        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        this.scene.add(pts);
        return { posAttr, colAttr, pos, col };
    }

    _makeGlowSprite(sharp = true) {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, 128, 128);
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        if (sharp) {
            // Hot inner core: bright white centre → cyan → deep blue
            g.addColorStop(0.00, 'rgba(255,255,255,1.00)');
            g.addColorStop(0.10, 'rgba(240,255,255,0.98)');
            g.addColorStop(0.28, 'rgba(160,220,255,0.82)');
            g.addColorStop(0.55, 'rgba(60,140,255,0.36)');
            g.addColorStop(0.80, 'rgba(20,70,210,0.08)');
            g.addColorStop(1.00, 'rgba(5, 30,170,0.00)');
        } else {
            // Soft outer plume: wide cyan–blue diffuse halo
            g.addColorStop(0.00, 'rgba(180,230,255,0.80)');
            g.addColorStop(0.22, 'rgba(100,185,255,0.48)');
            g.addColorStop(0.50, 'rgba(40,110,255,0.22)');
            g.addColorStop(0.75, 'rgba(15, 55,210,0.07)');
            g.addColorStop(1.00, 'rgba(0,  20,160,0.00)');
        }
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
    }

    // ── HUD ───────────────────────────────────────────────────────────────
    _addHUD() {
        this._hud = document.createElement('div');
        this._hud.id = 'shipHUD';
        this._hud.innerHTML = `
            <div id="hudMode">✦ FLIGHT MODE ✦</div>
            <div id="hudWarpHint"></div>
            <div id="hudOrbitStatus"></div>
            <div id="hudBottomBar">
                <div id="hudSpeedRow">
                    <span id="hudSpdLabel">SPD</span>
                    <span id="hudSpdVal">000</span>
                </div>
                <div id="hudBurnRow"></div>
            </div>
            <div id="hudCrosshair"></div>
            <div id="hudTargetDist"></div>
            <div id="hudHint">
                AIM&nbsp;crosshair&nbsp;→&nbsp;lock &nbsp;·&nbsp; G&nbsp;warp &nbsp;·&nbsp; X&nbsp;break&nbsp;orbit
                &nbsp;·&nbsp; W/S&nbsp;throttle &nbsp;·&nbsp; SPACE&nbsp;full&nbsp;throttle &nbsp;·&nbsp; SHIFT&nbsp;brake &nbsp;·&nbsp; F&nbsp;exit
            </div>
        `;
        this._hud.style.display = 'none';
        document.body.appendChild(this._hud);
        this._spdVal      = document.getElementById('hudSpdVal');
        this._burnRowEl   = document.getElementById('hudBurnRow');
        this._warpHintEl  = document.getElementById('hudWarpHint');
        this._orbitStatEl = document.getElementById('hudOrbitStatus');
        this._targetDistEl = document.getElementById('hudTargetDist');
    }

    _addWarpFlash() {
        this._warpFlashEl = document.createElement('div');
        Object.assign(this._warpFlashEl.style, {
            position: 'fixed', inset: '0',
            background: 'radial-gradient(ellipse at center, #ffffff 0%, #88ccff 40%, #001133 100%)',
            opacity: '0', pointerEvents: 'none', zIndex: '900',
        });
        document.body.appendChild(this._warpFlashEl);

        // Lightspeed streak canvas — drawn each frame during warp
        this._warpLinesCanvas = document.createElement('canvas');
        Object.assign(this._warpLinesCanvas.style, {
            position: 'fixed', inset: '0',
            width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: '395',
        });
        document.body.appendChild(this._warpLinesCanvas);
    }

    // Draw or clear lightspeed radial streaks. intensity = 0..1
    _drawWarpLines(intensity) {
        const c = this._warpLinesCanvas;
        const w = window.innerWidth, h = window.innerHeight;
        if (c.width !== w)  c.width  = w;
        if (c.height !== h) c.height = h;
        const ctx = c.getContext('2d');
        const cx = w / 2, cy = h / 2;
        const maxR = Math.hypot(cx, cy);

        ctx.clearRect(0, 0, w, h);
        if (intensity < 0.01) return;

        // 120 deterministic radial streaks — no Math.random() prevents per-frame flicker
        for (let i = 0; i < 120; i++) {
            const a   = (i / 120) * Math.PI * 2 + Math.sin(i * 2.399) * 0.03;
            const r0  = maxR * (0.02 + Math.abs(Math.sin(i * 1.618)) * 0.08);
            const r1  = maxR * (0.15 + intensity * 0.70 + Math.abs(Math.sin(i * 2.718)) * 0.10);
            const alp = (0.25 + Math.abs(Math.sin(i * 3.14)) * 0.20) * intensity;
            const lw  = 0.3 + Math.abs(Math.sin(i * 1.234)) * 0.8 + intensity * 0.5;

            const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
            const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;

            const g = ctx.createLinearGradient(x0, y0, x1, y1);
            g.addColorStop(0,   'rgba(200,235,255,0)');
            g.addColorStop(0.3, `rgba(200,235,255,${alp.toFixed(3)})`);
            g.addColorStop(1,   'rgba(220,248,255,0)');

            ctx.lineWidth   = lw;
            ctx.strokeStyle = g;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }

        // Central glow bloom
        const gr = maxR * 0.30 * intensity;
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
        glow.addColorStop(0,   `rgba(180,220,255,${(0.35 * intensity).toFixed(3)})`);
        glow.addColorStop(0.6, `rgba(100,170,255,${(0.08 * intensity).toFixed(3)})`);
        glow.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
    }

    // ── Input ─────────────────────────────────────────────────────────────
    _bindEvents() {
        const PREVENT_CODES = ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyQ', 'KeyE'];
        window.addEventListener('keydown', e => {
            this.keys[e.code] = true;
            if (e.code === 'KeyF') { e.preventDefault(); this.active ? this.exit() : this.enter(); }
            if (e.code === 'KeyG' && this.active && this._warpTarget) { e.preventDefault(); this._doWarp(); }
            if (e.code === 'KeyX' && this.active && this._orbitMode) { e.preventDefault(); this._breakOrbit(); }
            if (e.code === 'Space' && this.active && !this._orbitMode) { e.preventDefault(); this._targetSpeed = MAX_SPEED; this._fullThrottle = true; }
            // W/S step speed by 5 on each press
            // W/S handled continuously in update() — no keydown action needed
            if (this.active && PREVENT_CODES.includes(e.code)) e.preventDefault();
        });
        window.addEventListener('keyup', e => { this.keys[e.code] = false; });

        // Track absolute cursor position so the ship aims toward it each frame.
        // No pointer lock needed — the cursor is the steering wheel.
        document.addEventListener('mousemove', e => {
            if (!this.active) return;
            this._mouseNDC.x =  (e.clientX / window.innerWidth)  * 2 - 1;
            this._mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });
        document.addEventListener('mouseleave', () => { this._cursorInWindow = false; });
        document.addEventListener('mouseenter', () => { this._cursorInWindow = true;  });
    }

    // ── Warp ──────────────────────────────────────────────────────────────
    _doWarp() {
        if (!this._warpTarget || this._warpAnimating) return;

        const targetPos   = this._warpTarget.getPosition();
        const orbitRadius = Math.max(this._warpTarget.radius * ORBIT_STABLE_MULT, 10);

        // Arrive at the planet from the ship's current approach direction
        const dir = targetPos.clone().sub(this.shipGroup.position).normalize();
        this._warpEntryAngle = Math.atan2(dir.z, dir.x) + Math.PI; // opposite side → approach point
        this._warpEndPos.set(
            targetPos.x + Math.cos(this._warpEntryAngle) * orbitRadius,
            targetPos.y,
            targetPos.z + Math.sin(this._warpEntryAngle) * orbitRadius
        );
        this._warpStartPos.copy(this.shipGroup.position);
        this._warpProgress  = 0;
        this._warpAnimating = true;

        this._exitOrbit();

        // Brief directional flash at warp start
        this._warpFlashEl.style.transition = 'opacity 0.06s ease-in';
        this._warpFlashEl.style.opacity    = '0.55';
        setTimeout(() => {
            this._warpFlashEl.style.transition = 'opacity 1.0s ease-out';
            this._warpFlashEl.style.opacity    = '0';
        }, 100);
    }

    // Cubic ease in-out — ship accelerates, streaks, then decelerates into orbit
    _warpEase(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // ── Orbit mode ────────────────────────────────────────────────────────
    _enterOrbit(body, angle, radius) {
        this._orbitMode   = true;
        this._orbitBody   = body;
        this._orbitRadius = radius ?? Math.max(body.radius * ORBIT_STABLE_MULT, 10);
        this._orbitAngle  = angle  ?? (() => {
            const bodyPos = body.getPosition();
            const toShip  = this.shipGroup.position.clone().sub(bodyPos);
            return Math.atan2(toShip.z, toShip.x);
        })();
        // Constant cinematic orbit period ~80 seconds regardless of body size.
        // Formula: speed × dt × 60 = rad/frame at 60fps; 2π/(speed×60) = period in seconds.
        this._orbitSpeed  = 0.0013;  // → 2π/(0.0013×60) ≈ 80 second orbit
        this._vel.set(0, 0, 0);
        this._targetSpeed = 0;
        this._mouseBlendIn = 0;  // re-fade mouse on any orbit entry (warp arrival, proximity)

        // Snap _camLookAt so the camera doesn't drift toward the sun on entry
        const bodyPos0 = body.getPosition();
        // Snap look-at to ship so camera doesn't sweep from the sun/origin
        this._camLookAt.copy(this.shipGroup.position.clone());

        if (this._orbitStatEl) {
            this._orbitStatEl.textContent = `⊙ ORBITING ${body.name.toUpperCase()}`;
            this._orbitStatEl.style.color = '#55ffcc';
        }

        if (this.onOrbitEnter) this.onOrbitEnter(body.name);
    }

    get orbitedBody() { return this._orbitMode ? this._orbitBody : null; }

    // Called by mobile joystick each frame — maps joystick deflection to a
    // virtual cursor NDC position so the ship aims in that direction.
    addLookDelta(dx, dy) {
        const SCALE = 0.018;
        this._mouseNDC.x = Math.max(-1, Math.min(1,  dx * SCALE));
        this._mouseNDC.y = Math.max(-1, Math.min(1, -dy * SCALE));
    }

    _exitOrbit() {
        if (this._orbitMode && this.onOrbitExit) this.onOrbitExit();
        this._orbitMode = false;
        this._orbitBody = null;
        if (this._orbitStatEl) this._orbitStatEl.textContent = '';
        if (this._warpHintEl && this._warpTarget) {
            this._warpHintEl.textContent = `${this._isMobile ? '' : 'G · '}WARP TO ${this._warpTarget.name.toUpperCase()}`;
        }
        this._mouseNDC.set(0, 0);
    }

    // Break orbit — give the ship prograde velocity so it flies away naturally
    _breakOrbit() {
        if (!this._orbitMode) return;
        // Orient ship nose (-Z) along prograde — Y rotation of (π - orbitAngle) is exact;
        // avoids the antiparallel edge case of setFromUnitVectors when orbitAngle ≈ 0.
        this.shipGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - this._orbitAngle);

        // Move ship to just outside the orbit-trigger radius so it doesn't instantly re-enter
        const bodyPos  = this._orbitBody.getPosition();
        const radial   = this.shipGroup.position.clone().sub(bodyPos).normalize();
        const safeDist = Math.max(this._orbitBody.radius * ORBIT_TRIGGER_MULT * 1.3, 14);
        this.shipGroup.position.copy(bodyPos).addScaledVector(radial, safeDist);

        this._vel.set(0, 0, 0);
        this._targetSpeed = 0;
        this._orbitCooldown = 3.0;

        // Reset angular velocity so ship flies straight after orbit break.
        // _mouseNDC.set(0,0) has no durable effect since the next mousemove event
        // snaps it back to wherever the cursor physically is; _mouseBlendIn fades
        // that influence in over 0.5s so the ship doesn't immediately snap to cursor.
        this._mouseNDC.set(0, 0);
        this._mouseBlendIn = 0;
        this._angVelYaw   = 0;
        this._angVelPitch = 0;
        this._angVelRoll  = 0;

        // Snap camera behind ship facing prograde — no disorienting lerp from orbit position
        const progradeFwd = new THREE.Vector3(-Math.sin(this._orbitAngle), 0, Math.cos(this._orbitAngle));
        const q      = this.shipGroup.quaternion;
        const camOff = CAM_OFFSET.clone().applyQuaternion(q);
        this.camera.position.copy(this.shipGroup.position).add(camOff);
        this._camLookAt.copy(this.shipGroup.position.clone().addScaledVector(progradeFwd, 10));
        this.camera.lookAt(this._camLookAt);

        this._exitOrbit();
    }

    _checkOrbitEntry() {
        if (this._orbitCooldown > 0) return;
        for (const body of this._bodies) {
            if (body.noOrbit) continue;
            const bodyPos      = body.getPosition();
            const toShip       = this.shipGroup.position.clone().sub(bodyPos);
            const dist         = toShip.length();
            const triggerR     = Math.max(body.radius * ORBIT_TRIGGER_MULT, 8);

            if (dist < triggerR) {
                // Snap ship to safe orbit radius so it doesn't clip the surface
                const safeR = Math.max(body.radius * ORBIT_STABLE_MULT, 10);
                const dir   = toShip.lengthSq() > 0 ? toShip.normalize() : new THREE.Vector3(1, 0, 0);
                this.shipGroup.position.copy(bodyPos).addScaledVector(dir, safeR);
                const angle = Math.atan2(dir.z, dir.x);
                this._enterOrbit(body, angle, safeR);
                return;
            }
        }
    }

    // ── Crosshair lock-on — auto-targets planet in crosshair center ───────
    _updateCrosshairLock() {
        if (!this._planets.length || !this._bodies.length) return;

        const THRESHOLD = 0.14; // NDC distance from screen center to trigger lock
        let best = null;
        let bestDist = THRESHOLD;
        const proj = new THREE.Vector3();

        for (const p of this._planets) {
            p.group.getWorldPosition(proj);
            proj.project(this.camera);
            if (proj.z > 1.0) continue; // behind camera
            const d = Math.sqrt(proj.x * proj.x + proj.y * proj.y);
            if (d < bestDist) { bestDist = d; best = p; }
        }

        if (best) {
            const body = this._bodies.find(b => b.name === best.data.name);
            if (body && body !== this._warpTarget) this.setWarpTarget(body);
        }
    }

    // ── Enter / exit flight mode ──────────────────────────────────────────
    enter() {
        if (this.active) return;
        this.active = true;
        this.orbitControls.enabled = false;
        this._vel.set(0, 0, 0);
        this._targetSpeed  = 0;
        this._fullThrottle = false;
        this._boostCharge  = 1.0;
        this._orbitCooldown = 2.0;      // prevent instant orbit on entry if near a planet
        this._mouseNDC.set(0, 0);
        this._angVelYaw   = 0;
        this._angVelPitch = 0;
        this._angVelRoll  = 0;
        this._warpAnimating = false;
        this._baseFOV = this.camera.fov;
        this._exitOrbit();

        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        this.shipGroup.position.copy(this.camera.position).addScaledVector(dir, 20);
        // Inherit only the camera's yaw — level the ship so pitch/roll from OrbitControls
        // doesn't cause world-space yaw to feel wrong from the first input
        const flatDir = dir.clone(); flatDir.y = 0;
        if (flatDir.lengthSq() < 0.0001) flatDir.set(0, 0, -1);
        flatDir.normalize();
        const entryYaw = Math.atan2(-flatDir.x, -flatDir.z);
        this.shipGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), entryYaw);
        this._mouseBlendIn = 0;
        this.shipGroup.visible = true;

        const q = this.shipGroup.quaternion;
        const camOff = CAM_OFFSET.clone().applyQuaternion(q);
        this.camera.position.copy(this.shipGroup.position).add(camOff);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        this._camLookAt.copy(this.shipGroup.position.clone().addScaledVector(fwd, 10));
        this.camera.lookAt(this._camLookAt);

        // Refresh warp hint
        if (this._warpTarget && this._warpHintEl) {
            this._warpHintEl.textContent = `${this._isMobile ? '' : 'G · '}WARP TO ${this._warpTarget.name.toUpperCase()}`;
        }

        this._hud.style.display = 'block';
    }

    exit() {
        if (!this.active) return;
        this.active = false;
        this.orbitControls.enabled = true;
        this.orbitControls.target.copy(this.shipGroup.position);
        this.shipGroup.visible = false;
        this._warpAnimating = false;
        this.camera.fov = this._baseFOV;
        this.camera.updateProjectionMatrix();
        this._drawWarpLines(0);
        this._exitOrbit();
        this._hud.style.display = 'none';
        // Sync fly button state and hide mobile overlay (if any)
        document.getElementById('flyBtn')?.classList.remove('active');
        document.getElementById('mobileControls') &&
            (document.getElementById('mobileControls').style.display = 'none');
    }

    // ── Per-frame update ──────────────────────────────────────────────────
    update(dt) {
        if (!this.active) return;
        dt = Math.min(dt, 0.05);

        // Mission autopilot — the ArtemisMission (or future missions) sets
        // _missionActive = true and drives position / camera itself.
        // We skip all physics but keep ticking particles (handled by mission).
        if (this._missionActive) return;

        const k = this.keys;

        // ── Warp animation ────────────────────────────────────────────────
        if (this._warpAnimating) {
            this._warpProgress = Math.min(this._warpProgress + dt / this._warpDuration, 1.0);
            const t = this._warpEase(this._warpProgress);

            this.shipGroup.position.lerpVectors(this._warpStartPos, this._warpEndPos, t);

            // Point ship nose (-Z) toward destination
            const toEnd = this._warpEndPos.clone().sub(this.shipGroup.position);
            if (toEnd.lengthSq() > 0.001) {
                this.shipGroup.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 0, -1), toEnd.normalize()
                );
            }

            // FOV swells at peak speed + lightspeed streaks
            const speedPeak = Math.sin(this._warpProgress * Math.PI);
            this.camera.fov = this._baseFOV + speedPeak * 30;
            this.camera.updateProjectionMatrix();
            this._drawWarpLines(speedPeak);

            // Chase camera — locked directly behind ship, zero lag
            const q = this.shipGroup.quaternion;
            const camOff = new THREE.Vector3(0, 0.28, 0.70).applyQuaternion(q);
            this.camera.position.copy(this.shipGroup.position.clone().add(camOff));
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
            this._camLookAt.copy(this.shipGroup.position.clone().addScaledVector(fwd, 20));
            this.camera.lookAt(this._camLookAt);

            // Full engine particles during warp
            this._spawnParticles(20, fwd, 1.0, 1.0);
            this._tickParticles();

            if (this._spdVal)      this._spdVal.textContent = 'WRP';
            if (this._orbitStatEl) this._orbitStatEl.innerHTML =
                `⟶ WARPING TO ${this._warpTarget?.name.toUpperCase() ?? ''}`;
            if (this._warpHintEl)  this._warpHintEl.textContent = '';

            // Warp complete → enter orbit
            if (this._warpProgress >= 1.0) {
                this._warpAnimating = false;
                this.camera.fov = this._baseFOV;
                this.camera.updateProjectionMatrix();
                this._drawWarpLines(0);
                this.shipGroup.position.copy(this._warpEndPos);
                this._enterOrbit(
                    this._warpTarget,
                    this._warpEntryAngle,
                    Math.max(this._warpTarget.radius * ORBIT_STABLE_MULT, 10)
                );
            }
            return;
        }

        // ── Orbit mode ────────────────────────────────────────────────────
        if (this._orbitMode) {
            const bodyPos = this._orbitBody.getPosition();
            this._orbitAngle += this._orbitSpeed * dt * 60;

            // Ship position on circular orbit (ecliptic plane)
            const x = bodyPos.x + Math.cos(this._orbitAngle) * this._orbitRadius;
            const z = bodyPos.z + Math.sin(this._orbitAngle) * this._orbitRadius;
            const y = bodyPos.y;
            this.shipGroup.position.set(x, y, z);

            // Ship nose (-Z) faces prograde — tangent to orbit
            this.shipGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - this._orbitAngle);

            // ── Cinematic camera ──────────────────────────────────────────
            // Camera is placed directly behind and slightly above the ship each
            // frame (no lerp) so it moves in lockstep — eliminates jitter/sway.
            // Offset is expressed in orbit-tangent space:
            //   +radial  = away from planet  (camera behind ship)
            //   +Y       = slightly above
            const radial   = this.shipGroup.position.clone().sub(bodyPos).normalize();
            const camDist  = Math.max(0.30, this._orbitRadius * 0.022);
            const orbitCamPos = this.shipGroup.position.clone()
                .addScaledVector(radial, camDist)
                .add(new THREE.Vector3(0, camDist * 0.35, 0));
            this.camera.position.copy(orbitCamPos);

            // Look toward ship with slight bias toward planet so planet fills frame
            const orbitLookTarget = this.shipGroup.position.clone().lerp(bodyPos, 0.12);
            this._camLookAt.copy(orbitLookTarget);
            this.camera.lookAt(this._camLookAt);

            // Idle engine particles
            const prograde = new THREE.Vector3(-Math.sin(this._orbitAngle), 0, Math.cos(this._orbitAngle));
            this._spawnParticles(0, prograde, 0, 0);
            this._tickParticles();

            // HUD: show orbit status + prominent break hint
            if (this._spdVal) this._spdVal.textContent = '000';
            if (this._orbitStatEl) {
                this._orbitStatEl.innerHTML =
                    `⊙ ORBITING ${this._orbitBody.name.toUpperCase()}<br>` +
                    `<span style="font-size:0.60rem;color:#ffcc44;letter-spacing:2px">${this._isMobile ? 'TAP BREAK ORBIT' : '[ X ] BREAK ORBIT'}</span>`;
            }
            if (this._warpHintEl) this._warpHintEl.textContent = '';
            return;
        }

        // ── Cooldown tick ─────────────────────────────────────────────────
        if (this._orbitCooldown > 0) this._orbitCooldown -= dt;

        // ── Crosshair planet lock-on ──────────────────────────────────────
        this._updateCrosshairLock();

        // ── Check for orbit entry (proximity to any body) ─────────────────
        this._checkOrbitEntry();
        if (this._orbitMode) return; // just entered orbit this frame

        // ── Normal flight ─────────────────────────────────────────────────
        const braking  = !!(k['ShiftLeft'] || k['ShiftRight']);
        const q        = this.shipGroup.quaternion;

        const curSpd  = this._vel.length();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const up      = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

        // ── Angular-velocity steering (X-Wing / joystick style) ──────────
        // Cursor NDC position maps directly to desired turn rate — no raycaster.
        // This avoids any feedback loop with the lagging camera:
        //   cursor at center (0,0) → no rotation
        //   cursor right          → yaw right at proportional rate
        //   cursor up             → pitch up at proportional rate
        // Angular velocity ramps toward desired (inertia) then coasts back to 0.

        // Fade mouse influence in from 0→1 over ~0.5s after orbit exit / fly entry.
        // Prevents the ship from immediately steering toward wherever the cursor
        // happens to be sitting when orbit breaks or fly mode starts.
        if (this._mouseBlendIn < 1) this._mouseBlendIn = Math.min(1, this._mouseBlendIn + dt * 2.0);
        const mouseX = this._mouseNDC.x * this._mouseBlendIn;
        const mouseY = this._mouseNDC.y * this._mouseBlendIn;

        // Steering is gated: ship must be moving before cursor has any effect.
        const steerActive = curSpd > 0.3 && this._cursorInWindow;
        const adInput     = (k['KeyA'] ? 1 : 0) - (k['KeyD'] ? 1 : 0);

        // Speed-scaled steering — ship gets progressively heavier above ~20 u/s.
        // At max speed turn rate drops to 28% and A/D yaw to 35%, keeping the ship
        // controllable without becoming a wild projectile at full throttle.
        const sFrac       = Math.min(curSpd / MAX_SPEED, 1.0);
        const dynTurn     = TURN_RATE_MAX  * (1.0 - sFrac * 0.72);   // 1.6 → 0.45 rad/s
        const dynAdYaw    = AD_YAW_RATE    * (1.0 - sFrac * 0.65);   // 0.9 → 0.32 rad/s
        const dynResponse = ANGULAR_RESPONSE * (1.0 - sFrac * 0.45); // 2.0 → 1.1

        const desiredYaw   = steerActive ? YAW_SIGN   * mouseX * dynTurn + adInput * dynAdYaw : 0;
        const desiredPitch = steerActive ? PITCH_SIGN * mouseY * dynTurn : 0;

        this._angVelYaw   += (desiredYaw   - this._angVelYaw)   * dynResponse * dt;
        this._angVelPitch += (desiredPitch - this._angVelPitch) * dynResponse * dt;

        // Local-space axes for yaw and pitch — heading-invariant.
        // Using world-space right for pitch inverts when ship faces +Z (right → -X after π yaw).
        // Pure local (1,0,0) for pitch and local up for yaw stay consistent at every heading.
        q.multiply(new THREE.Quaternion().setFromAxisAngle(up, this._angVelYaw * dt))
         .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this._angVelPitch * dt))
         .normalize();

        // Q/E roll — speed-scaled like yaw/pitch
        const rollInput    = (k['KeyE'] ? 1 : 0) - (k['KeyQ'] ? 1 : 0);
        const desiredRoll  = rollInput * dynTurn * 0.6;
        this._angVelRoll  += (desiredRoll - this._angVelRoll) * dynResponse * dt;
        if (Math.abs(this._angVelRoll) > 0.0001) {
            q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this._angVelRoll * dt)).normalize();
        }

        // Auto-level roll — spring back to 0 roll when Q/E not held.
        // Keeps local up close to world up, which is required for local-space yaw
        // to feel consistent (if roll reaches 90° local up → world horizontal → yaw becomes roll).
        if (!k['KeyQ'] && !k['KeyE']) {
            const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
            if (Math.abs(euler.z) > 0.003) {
                const rollBack = -euler.z * Math.min(5.0 * dt, 0.18);
                q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollBack)).normalize();
            }
        }

        // Arrow steering
        const arrowYaw   = (k['ArrowLeft']  ? 1 : 0) - (k['ArrowRight'] ? 1 : 0);
        const arrowPitch = (k['ArrowUp']    ? 1 : 0) - (k['ArrowDown']  ? 1 : 0);
        if (arrowYaw !== 0 || arrowPitch !== 0) {
            q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), arrowYaw * ARROW_RATE))
             .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), arrowPitch * ARROW_RATE))
             .normalize();
        }

        // W/S smoothly ramp throttle; W/S contact clears boost latch
        if (k['KeyW']) { this._targetSpeed = Math.min(this._targetSpeed + 8 * dt, CRUISE_MAX); this._fullThrottle = false; }
        if (k['KeyS']) { this._targetSpeed = Math.max(this._targetSpeed - 8 * dt, 0);          this._fullThrottle = false; }
        if (braking)   { this._targetSpeed = MIN_SPEED; this._fullThrottle = false; }

        // Boost — drains charge while active; auto-cuts when depleted; recharges when off
        if (this._fullThrottle) {
            if (this._boostCharge > 0) {
                this._boostCharge = Math.max(0, this._boostCharge - dt / BOOST_DURATION);
                this._targetSpeed = MAX_SPEED;
            } else {
                // Charge depleted — auto-disengage boost, coast back to cruise
                this._fullThrottle = false;
                this._targetSpeed  = Math.min(this._targetSpeed, CRUISE_MAX);
            }
        } else {
            this._boostCharge = Math.min(1.0, this._boostCharge + dt * BOOST_RECHARGE);
        }

        // Engine applies smooth constant force toward target speed — no multiplier jumps
        const fwdVel          = this._vel.dot(forward);
        const effectiveTarget = braking ? 0 : Math.max(this._targetSpeed, MIN_SPEED);
        const fwdErr          = effectiveTarget - fwdVel;
        if (Math.abs(fwdErr) > 0.001) {
            const maxCorr = (braking ? BRAKE_FORCE : THRUST) * dt;
            this._vel.addScaledVector(forward, Math.sign(fwdErr) * Math.min(Math.abs(fwdErr), maxCorr));
        }

        // Arrow strafe
        const strafeH = (k['ArrowRight'] ? 1 : 0) - (k['ArrowLeft']  ? 1 : 0);
        const strafeV = (k['ArrowUp']    ? 1 : 0) - (k['ArrowDown']  ? 1 : 0);
        if (strafeH !== 0) this._vel.addScaledVector(right, strafeH * STRAFE_FORCE * dt);
        if (strafeV !== 0) this._vel.addScaledVector(up,    strafeV * STRAFE_FORCE * dt);

        // Drag
        if (braking) {
            const spd = this._vel.length();
            if (spd > 0) this._vel.multiplyScalar(Math.max(spd - BRAKE_FORCE * dt, 0) / spd);
        } else {
            const latVel = this._vel.clone().addScaledVector(forward, -fwdVel);
            const latSpd = latVel.length();
            if (latSpd > 0.001) {
                this._vel.addScaledVector(latVel, -Math.min(LAT_DRAG * dt, latSpd) / latSpd);
            }
        }

        // Move
        this.shipGroup.position.addScaledVector(this._vel, dt);

        // Engine glow — driven by throttle fraction
        const throttleFrac  = Math.min(curSpd / MAX_SPEED, 1.0);
        const thrForDisplay = Math.min(throttleFrac + (k['KeyW'] || this._fullThrottle ? 0.12 : 0), 1.0);
        this._engineGlows.forEach((g, idx) => {
            const base = idx % 2 === 0 ? 2.0 + thrForDisplay * 6.0 : 4.0 + thrForDisplay * 10.0;
            g.material.emissiveIntensity = base + Math.random() * 1.2;
        });
        if (this._engineLight) {
            this._engineLight.intensity = 2.0 + thrForDisplay * 22.0 + Math.random() * 3.0;
        }

        // Particles — exhaust direction blends nose with velocity for realistic trail angle
        const spawnN = Math.round(14 + throttleFrac * 18); // 14–32 per engine
        const exhaustDir = curSpd > 0.5
            ? forward.clone().lerp(this._vel.clone().normalize(), Math.min(curSpd / 60.0, 0.18)).normalize()
            : forward;
        this._spawnParticles(spawnN, exhaustDir, throttleFrac, throttleFrac);
        this._tickParticles();

        // Camera follow — dt-based exponential smoothing + hard distance clamp.
        // _mouseBlendIn doubles as a "settle" factor after orbit exit:
        //   settle=0 → camera and look-at snap directly (no lag, no sway)
        //   settle=1 → normal smooth follow
        // This eliminates the post-orbit sway that lerp lag causes when
        // transitioning from the orbital camera angle back to behind-ship.
        const speedFrac  = Math.min(curSpd / MAX_SPEED, 1.0);
        // Subtle pull-back at speed (max +12%) — ship stays large in frame
        const dynZ      = CAM_OFFSET.z * (1 + speedFrac * 0.12);
        const camTarget = this.shipGroup.position.clone().add(
            new THREE.Vector3(CAM_OFFSET.x, CAM_OFFSET.y, dynZ).applyQuaternion(q));

        const settle   = this._mouseBlendIn;
        const baseCam  = 1 - Math.exp(-CAM_SMOOTH * dt);
        const camAlpha = baseCam + (1 - baseCam) * (1 - settle);
        this.camera.position.lerp(camTarget, camAlpha);

        // Hard clamp — constant tight leash, does NOT grow at speed.
        // Previous behaviour (lag growing to 0.72 at max) was letting the ship escape the frame.
        const toTarget = camTarget.clone().sub(this.camera.position);
        const lagDist  = toTarget.length();
        if (lagDist > CAM_MAX_LAG) {
            this.camera.position.addScaledVector(toTarget, 1 - CAM_MAX_LAG / lagDist);
        }

        // Look-ahead shortened from 10 → 4 units so a sharp turn at high speed
        // doesn't sweep the look-target off-screen before LOOK_SMOOTH catches up.
        const lookTarget = this.shipGroup.position.clone().addScaledVector(forward, 4);
        const baseLook   = 1 - Math.exp(-LOOK_SMOOTH * dt);
        const lookAlpha  = baseLook + (1 - baseLook) * (1 - settle);
        this._camLookAt.lerp(lookTarget, lookAlpha);
        this.camera.lookAt(this._camLookAt);

        // HUD speed — normalised 0–100 percentage of max speed
        if (this._spdVal) {
            this._spdVal.textContent = String(Math.round(curSpd / MAX_SPEED * 100)).padStart(3, '0');
        }
        // HUD boost charge bar
        if (this._burnRowEl) {
            const chargePct = Math.round(this._boostCharge * 100);
            const boosting  = this._fullThrottle && this._boostCharge > 0;
            const depleted  = this._boostCharge < 0.05;
            const col       = boosting ? '#ff9922' : depleted ? '#442200' : '#44ccff';
            const label     = boosting ? 'BOOST' : depleted ? 'RCHG' : 'BOOST';
            this._burnRowEl.innerHTML =
                `<span style="color:${col};letter-spacing:2px">${label}</span>` +
                `<span style="display:inline-block;width:70px;height:5px;` +
                `background:linear-gradient(to right,${col} ${chargePct}%,#0a1520 ${chargePct}%);` +
                `margin-left:6px;border-radius:3px;vertical-align:middle"></span>`;
        }

        // HUD target distance — only shown while a warp target is locked
        if (this._targetDistEl) {
            if (this._warpTarget) {
                const d = this.shipGroup.position.distanceTo(this._warpTarget.getPosition());
                this._targetDistEl.textContent = d >= 100
                    ? (d / 100).toFixed(2) + ' AU'
                    : d.toFixed(1) + ' u';
            } else {
                this._targetDistEl.textContent = '';
            }
        }
    }

    // ── Spawn particles at both engine exits ──────────────────────────────
    _spawnParticles(countPerEngine, forward, boostIntensity, thrust) {
        const q   = this.shipGroup.quaternion;
        const pos = this.shipGroup.position;
        const t   = Math.min(Math.max(thrust, 0), 1);

        // Perpendicular basis computed once per call — no per-particle allocation
        const rt = new THREE.Vector3(forward.y, -forward.x, 0);
        if (rt.lengthSq() < 0.01) rt.set(0, forward.z, -forward.y);
        rt.normalize();
        const up = new THREE.Vector3().crossVectors(forward, rt);

        // Idle shimmer — faint blue pulse at nozzle mouths
        if (t < 0.12) {
            for (let eng = 0; eng < 2; eng++) {
                const we = this._exits[eng].clone().multiplyScalar(SHIP_SCALE).applyQuaternion(q).add(pos);
                for (let n = 0; n < 4; n++) {
                    const idx = this._cHead % 1400; this._cHead++;
                    const sp  = 0.0007;
                    this._core.pos[idx*3]   = we.x; this._core.pos[idx*3+1] = we.y; this._core.pos[idx*3+2] = we.z;
                    this._cVel[idx*3]   = -forward.x*0.0005+(Math.random()-.5)*sp;
                    this._cVel[idx*3+1] = -forward.y*0.0005+(Math.random()-.5)*sp;
                    this._cVel[idx*3+2] = -forward.z*0.0005+(Math.random()-.5)*sp;
                    this._cLife[idx] = 0.30;
                    this._core.col[idx*3]=0.012; this._core.col[idx*3+1]=0.030; this._core.col[idx*3+2]=0.055;
                }
            }
            return;
        }

        // Spawn counts — core is tighter/brighter, plume is wide and long-lived
        const coreN  = Math.max(6,  Math.floor(countPerEngine * (0.55 + t * 0.45)));
        const plumeN = Math.max(3,  Math.floor(countPerEngine * (0.25 + t * 0.45)));

        for (let eng = 0; eng < 2; eng++) {
            const we = this._exits[eng].clone().multiplyScalar(SHIP_SCALE).applyQuaternion(q).add(pos);

            // ── Core: tight bright hot beam ────────────────────────────────
            // Particles are pre-seeded backward along the trail so the stream
            // looks dense at the moment of spawn (no "building up" delay).
            for (let n = 0; n < coreN; n++) {
                const idx  = this._cHead % 1400; this._cHead++;
                const spd  = (0.006 + Math.random()*0.005) * (0.25 + t*0.75);
                const cone = (0.04 + boostIntensity*0.05) * Math.random();
                const th   = Math.random() * Math.PI * 2;
                const sr   = cone * spd;
                const back = Math.random() * 0.32 * (0.4 + t * 0.6);
                this._core.pos[idx*3]   = we.x - forward.x * back;
                this._core.pos[idx*3+1] = we.y - forward.y * back;
                this._core.pos[idx*3+2] = we.z - forward.z * back;
                this._cVel[idx*3]   = -forward.x*spd + (rt.x*Math.cos(th)+up.x*Math.sin(th))*sr;
                this._cVel[idx*3+1] = -forward.y*spd + (rt.y*Math.cos(th)+up.y*Math.sin(th))*sr;
                this._cVel[idx*3+2] = -forward.z*spd + (rt.z*Math.cos(th)+up.z*Math.sin(th))*sr;
                this._cLife[idx] = 0.50 + t*0.50;
                // White-hot at birth; colour evolves in _tickParticles
                const cs = 0.08 + t*0.60;
                this._core.col[idx*3] = cs; this._core.col[idx*3+1] = cs*0.92; this._core.col[idx*3+2] = cs;
            }

            // ── Plume: wide cinematic bloom ────────────────────────────────
            for (let n = 0; n < plumeN; n++) {
                const idx  = this._pHead % 1200; this._pHead++;
                const spd  = (0.0022 + Math.random()*0.0028) * (0.15 + t*0.85);
                const cone = (0.14 + boostIntensity*0.14) * Math.random();
                const th   = Math.random() * Math.PI * 2;
                const sr   = cone * spd;
                const back = Math.random() * 0.45 * (0.3 + t * 0.7);
                this._plume.pos[idx*3]   = we.x - forward.x * back;
                this._plume.pos[idx*3+1] = we.y - forward.y * back;
                this._plume.pos[idx*3+2] = we.z - forward.z * back;
                this._pVel[idx*3]   = -forward.x*spd + (rt.x*Math.cos(th)+up.x*Math.sin(th))*sr;
                this._pVel[idx*3+1] = -forward.y*spd + (rt.y*Math.cos(th)+up.y*Math.sin(th))*sr;
                this._pVel[idx*3+2] = -forward.z*spd + (rt.z*Math.cos(th)+up.z*Math.sin(th))*sr;
                this._pLife[idx] = 0.65 + t*0.35;
                const cs = 0.025 + t*0.30;
                this._plume.col[idx*3]=cs*0.12; this._plume.col[idx*3+1]=cs*0.72; this._plume.col[idx*3+2]=cs;
            }
        }
    }

    // ── Advance particle lifetimes ─────────────────────────────────────────
    _tickParticles() {
        // Core — white-hot at birth → electric cyan → deep blue-violet
        for (let i = 0; i < 1400; i++) {
            if (this._cLife[i] <= 0) continue;
            this._cLife[i] -= 0.020;
            if (this._cLife[i] <= 0) {
                this._cLife[i] = 0;
                this._core.pos[i*3] = this._core.pos[i*3+1] = this._core.pos[i*3+2] = 1e6;
                continue;
            }
            const t = this._cLife[i];
            this._core.pos[i*3]   += this._cVel[i*3];
            this._core.pos[i*3+1] += this._cVel[i*3+1];
            this._core.pos[i*3+2] += this._cVel[i*3+2];
            // t: 1.0=fresh → 0.0=dead
            // >0.7 white-hot, 0.4–0.7 cyan, <0.4 blue-violet
            const bright = Math.min(t * 1.4, 1.0);
            this._core.col[i*3]   = t > 0.70 ? bright * 0.95 : t > 0.40 ? bright * 0.15 : bright * 0.08;
            this._core.col[i*3+1] = t > 0.70 ? bright * 0.96 : t > 0.40 ? bright * 0.85 : bright * 0.40;
            this._core.col[i*3+2] = bright;   // blue channel persists longest
        }
        this._core.posAttr.needsUpdate = true;
        this._core.colAttr.needsUpdate = true;

        // Plume — wide soft cyan halo fades to deep blue-indigo
        for (let i = 0; i < 1200; i++) {
            if (this._pLife[i] <= 0) continue;
            this._pLife[i] -= 0.010;
            if (this._pLife[i] <= 0) {
                this._pLife[i] = 0;
                this._plume.pos[i*3] = this._plume.pos[i*3+1] = this._plume.pos[i*3+2] = 1e6;
                continue;
            }
            const t = this._pLife[i];
            this._plume.pos[i*3]   += this._pVel[i*3];
            this._plume.pos[i*3+1] += this._pVel[i*3+1];
            this._plume.pos[i*3+2] += this._pVel[i*3+2];
            // Cyan near nozzle, fading to indigo at tail
            this._plume.col[i*3]   = t * 0.05;
            this._plume.col[i*3+1] = t > 0.5 ? t * 0.60 : t * 0.30;
            this._plume.col[i*3+2] = t * 0.92;
        }
        this._plume.posAttr.needsUpdate = true;
        this._plume.colAttr.needsUpdate = true;
    }
}
