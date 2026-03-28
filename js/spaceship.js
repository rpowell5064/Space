// spaceship.js — Flyable spacecraft with engine particle trails + orbital insertion
// Controls: W/S throttle · A/D yaw · Q/E roll · Mouse pitch+yaw
//           Arrow keys strafe · Space boost · Shift brake · G warp to target · F exit
import * as THREE from 'https://esm.sh/three@0.160.0';

// ── Constants ──────────────────────────────────────────────────────────────
const SHIP_SCALE = 0.012;

// Flight physics — scaled for real AU distances (1 AU = 100 scene units)
const THRUST        = 15.0;   // units/s² engine force
const THROTTLE_RATE = 4.0;    // units/s² rate W/S adjusts target speed
const BOOST_MULT    = 8.0;
const MIN_SPEED     = 1.0;    // units/s — ship always moves at least this fast
const MAX_SPEED     = 6.0;    // units/s normal ceiling (W key)
const BOOST_MAX     = 100.0;  // units/s burn ceiling
const BURN_DURATION = 1.0;    // seconds a burn lasts
const BURN_COOLDOWN = 5.0;    // seconds before burn is available again
const POST_BURN_DECEL = 32.0; // units/s² deceleration rate back to cruise after burn
const CRUISE_PEAK_SPD = BOOST_MAX * 50 / 150;
const BOOST_PEAK_SPD  = BOOST_MAX * 80 / 150;
const LAT_DRAG      = 2.5;    // lateral grip — tracks nose without jerking at speed
const BRAKE_FORCE   = 8.0;
const STRAFE_FORCE  = 1.8;

// Steering — angular velocity model for X-Wing-style inertial feel
const TURN_RATE_MAX    = 2.0;  // rad/s max angular velocity (~115 deg/sec)
const ANGULAR_RESPONSE = 3.5;  // how quickly angular vel ramps toward desired (lower = more lag)
const ANGULAR_DAMP     = 6.0;  // how quickly spin bleeds off when aim is centered
const AD_YAW_RATE      = 1.2;  // extra yaw from A/D keys (rad/s)
const ROLL_RATE        = 0.025;
const ARROW_RATE       = 0.016;

// Camera
const CAM_OFFSET     = new THREE.Vector3(0, 0.22, 0.50);
const CAM_LERP       = 0.18;
const BOOST_CAM_LERP = 0.18;  // same rate — speed is handled by scaling the offset
const LOOK_LERP      = 0.22;

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
        // Burn timer: counts down from BURN_DURATION after Space is pressed
        this._burnTimer    = 0;
        this._burnCooldown = 0;  // counts down before burn is available again

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
                ? `G · WARP TO ${body.name.toUpperCase()}`
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
        const hullMat = new THREE.MeshStandardMaterial({
            color: 0x3a6080, metalness: 0.60, roughness: 0.30,
            emissive: 0x0d2035, emissiveIntensity: 0.6
        });
        const accentMat = new THREE.MeshStandardMaterial({
            color: 0x1f5fcc, metalness: 0.92, roughness: 0.12,
            emissive: 0x0a2655, emissiveIntensity: 1.1
        });
        const glassMat = new THREE.MeshStandardMaterial({
            color: 0x66bbff, transparent: true, opacity: 0.48,
            roughness: 0.0, metalness: 0.05
        });
        const glowMat = new THREE.MeshStandardMaterial({
            color: 0x99ddff, emissive: 0x3366ff,
            emissiveIntensity: 3.5, transparent: true, opacity: 0.90
        });

        const add = (geo, mat, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(px, py, pz);
            m.rotation.set(rx, ry, rz);
            this.shipGroup.add(m);
            return m;
        };

        add(new THREE.ConeGeometry(0.50, 2.6, 8),          hullMat, 0, 0, -3.8, -Math.PI/2, 0, 0);
        add(new THREE.CylinderGeometry(0.50, 0.64, 3.2, 10), hullMat, 0, 0, -1.8,  Math.PI/2, 0, 0);
        add(new THREE.CylinderGeometry(0.64, 0.76, 2.4, 10), hullMat, 0, 0,  0.6,  Math.PI/2, 0, 0);

        [-1, 1].forEach(side => {
            const shape = new THREE.Shape();
            shape.moveTo(0,          -2.6);
            shape.lineTo(side * 3.8, -0.3);
            shape.lineTo(side * 4.7,  2.8);
            shape.lineTo(0,           2.8);
            shape.closePath();
            const w = new THREE.Mesh(
                new THREE.ExtrudeGeometry(shape, { depth: 0.10, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.05, bevelSegments: 1 }),
                hullMat
            );
            w.rotation.x = Math.PI / 2;
            w.position.set(0, -0.14, 0);
            this.shipGroup.add(w);
        });

        add(new THREE.SphereGeometry(0.45, 18, 12, 0, Math.PI*2, 0, Math.PI*0.52), glassMat,  0, 0.62, -1.8);
        add(new THREE.TorusGeometry(0.45, 0.05, 6, 24),                            accentMat, 0, 0.62, -1.8, Math.PI/2, 0, 0);
        add(new THREE.BoxGeometry(0.05, 0.03, 5.2), accentMat,  0.00,  0.67, -1.5);
        add(new THREE.BoxGeometry(0.03, 0.05, 4.2), accentMat, -0.62,  0.00, -1.6);
        add(new THREE.BoxGeometry(0.03, 0.05, 4.2), accentMat,  0.62,  0.00, -1.6);

        const finShape = new THREE.Shape();
        finShape.moveTo(0, 0); finShape.lineTo(0, 1.15); finShape.lineTo(-1.9, 0); finShape.closePath();
        const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.05, bevelEnabled: false }), hullMat);
        fin.rotation.y = -Math.PI / 2;
        fin.position.set(0.025, 0.66, 2.6);
        this.shipGroup.add(fin);

        [[-0.88, -0.22], [0.88, -0.22]].forEach(([ex, ey]) => {
            add(new THREE.CylinderGeometry(0.22, 0.28, 2.4, 10), hullMat,   ex, ey, 1.5, Math.PI/2, 0, 0);
            add(new THREE.TorusGeometry(0.24, 0.05, 6, 18),      accentMat, ex, ey, 0.3, Math.PI/2, 0, 0);
            add(new THREE.TorusGeometry(0.21, 0.04, 6, 18),      accentMat, ex, ey, 2.7, Math.PI/2, 0, 0);
            this._engineGlows.push(add(new THREE.CircleGeometry(0.18, 16), glowMat, ex, ey, 2.72));
            this._engineGlows.push(add(
                new THREE.CircleGeometry(0.09, 16),
                new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xaaddff, emissiveIntensity: 5.0, transparent: true, opacity: 0.95 }),
                ex, ey, 2.73
            ));
        });

        // Primary fill — blue-white, illuminates top/front
        const fill = new THREE.PointLight(0xaaccff, 5.0, 40);
        fill.position.set(0, 2, -2);
        this.shipGroup.add(fill);
        // Secondary fill — warm white from below, prevents pure-black underside
        const fill2 = new THREE.PointLight(0xffeedd, 2.5, 30);
        fill2.position.set(0, -2, 1);
        this.shipGroup.add(fill2);
    }

    // ── Engine particles ───────────────────────────────────────────────────
    _buildEngineParticles() {
        const tex = this._makeGlowSprite();

        this._core  = this._makeLayer(400, 0.030, tex);
        this._cLife = new Float32Array(400);
        this._cVel  = new Float32Array(400 * 3);
        this._cHead = 0;

        this._plume  = this._makeLayer(300, 0.065, tex);
        this._pLife  = new Float32Array(300);
        this._pVel   = new Float32Array(300 * 3);
        this._pHead  = 0;

        this._exits = [
            new THREE.Vector3(-0.88, -0.22, 2.72),
            new THREE.Vector3( 0.88, -0.22, 2.72),
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

    _makeGlowSprite() {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 128, 128);
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0.00, 'rgba(255,255,255,1.00)');
        g.addColorStop(0.08, 'rgba(220,240,255,0.95)');
        g.addColorStop(0.20, 'rgba(140,195,255,0.78)');
        g.addColorStop(0.42, 'rgba(60,120,255,0.40)');
        g.addColorStop(0.68, 'rgba(25,60,200,0.12)');
        g.addColorStop(1.00, 'rgba(5, 20,160,0.00)');
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
            <div id="hudSpeedRow">
                <span id="hudSpdLabel">SPD</span>
                <span id="hudSpdVal">000</span>
            </div>
            <div id="hudBurnRow"></div>
            <div id="hudCrosshair"></div>
            <div id="hudTargetDist"></div>
            <div id="hudHint">
                AIM&nbsp;crosshair&nbsp;→&nbsp;lock &nbsp;·&nbsp; G&nbsp;warp &nbsp;·&nbsp; X&nbsp;break&nbsp;orbit
                &nbsp;·&nbsp; W&nbsp;thrust &nbsp;·&nbsp; SPACE&nbsp;5s&nbsp;burn &nbsp;·&nbsp; SHIFT&nbsp;brake &nbsp;·&nbsp; F&nbsp;exit
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
            if (e.code === 'Space' && this.active && !this._orbitMode && this._burnTimer <= 0 && this._burnCooldown <= 0) { e.preventDefault(); this._burnTimer = BURN_DURATION; }
            // W/S set cruise speed on press — no holding required
            if (e.code === 'KeyW' && this.active && !this._orbitMode) this._targetSpeed = MAX_SPEED;
            if (e.code === 'KeyS' && this.active && !this._orbitMode) this._targetSpeed = MIN_SPEED;
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
            this._warpHintEl.textContent = `G · WARP TO ${this._warpTarget.name.toUpperCase()}`;
        }
        this._mouseNDC.set(0, 0);
    }

    // Break orbit — give the ship prograde velocity so it flies away naturally
    _breakOrbit() {
        if (!this._orbitMode) return;
        // Orient ship nose (-Z) along prograde
        const prograde = new THREE.Vector3(
            -Math.sin(this._orbitAngle),
            0,
            Math.cos(this._orbitAngle)
        ).normalize();
        this.shipGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), prograde);

        // Move ship to just outside the orbit-trigger radius so it doesn't instantly re-enter
        const bodyPos  = this._orbitBody.getPosition();
        const radial   = this.shipGroup.position.clone().sub(bodyPos).normalize();
        const safeDist = Math.max(this._orbitBody.radius * ORBIT_TRIGGER_MULT * 1.3, 14);
        this.shipGroup.position.copy(bodyPos).addScaledVector(radial, safeDist);

        this._vel.set(0, 0, 0);
        this._targetSpeed = 0;
        this._orbitCooldown = 3.0;

        // Reset virtual cursor and angular velocity so ship flies straight after orbit break
        this._mouseNDC.set(0, 0);
        this._angVelYaw   = 0;
        this._angVelPitch = 0;
        this._angVelRoll  = 0;

        // Snap camera behind ship facing prograde — no disorienting lerp from orbit position
        const q      = this.shipGroup.quaternion;
        const camOff = CAM_OFFSET.clone().applyQuaternion(q);
        this.camera.position.copy(this.shipGroup.position).add(camOff);
        this._camLookAt.copy(this.shipGroup.position.clone().addScaledVector(prograde, 10));
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
        this._targetSpeed  = MIN_SPEED;
        this._burnTimer    = 0;
        this._burnCooldown = 0;
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
        this.shipGroup.quaternion.copy(this.camera.quaternion);
        this.shipGroup.visible = true;

        const q = this.shipGroup.quaternion;
        const camOff = CAM_OFFSET.clone().applyQuaternion(q);
        this.camera.position.copy(this.shipGroup.position).add(camOff);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        this._camLookAt.copy(this.shipGroup.position.clone().addScaledVector(fwd, 10));
        this.camera.lookAt(this._camLookAt);

        // Refresh warp hint
        if (this._warpTarget && this._warpHintEl) {
            this._warpHintEl.textContent = `G · WARP TO ${this._warpTarget.name.toUpperCase()}`;
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
            const prograde = new THREE.Vector3(
                -Math.sin(this._orbitAngle),
                0,
                Math.cos(this._orbitAngle)
            ).normalize();
            this.shipGroup.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 0, -1), prograde
            );

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
            this._spawnParticles(0, prograde, 0, 0);
            this._tickParticles();

            // HUD: show orbit status + prominent break hint
            if (this._spdVal) this._spdVal.textContent = '000';
            if (this._orbitStatEl) {
                this._orbitStatEl.innerHTML =
                    `⊙ ORBITING ${this._orbitBody.name.toUpperCase()}<br>` +
                    `<span style="font-size:0.60rem;color:#ffcc44;letter-spacing:2px">[ X ] BREAK ORBIT</span>`;
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
        const wasBurning = this._burnTimer > 0;
        if (this._burnTimer   > 0) this._burnTimer   = Math.max(this._burnTimer   - dt, 0);
        if (this._burnCooldown > 0) this._burnCooldown = Math.max(this._burnCooldown - dt, 0);
        if (wasBurning && this._burnTimer <= 0) this._burnCooldown = BURN_COOLDOWN;
        const burning  = this._burnTimer > 0;
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

        // Steering is gated: ship must be moving, burning, or under W thrust before
        // cursor input has any effect. Prevents out-of-control spinning at entry.
        const steerActive = (burning || curSpd > 0.3) && this._cursorInWindow;
        const adInput     = (k['KeyA'] ? 1 : 0) - (k['KeyD'] ? 1 : 0);
        const desiredYaw   = steerActive ? -this._mouseNDC.x * TURN_RATE_MAX + adInput * AD_YAW_RATE : 0;
        const desiredPitch = steerActive ? -this._mouseNDC.y * TURN_RATE_MAX : 0;

        this._angVelYaw   += (desiredYaw   - this._angVelYaw)   * ANGULAR_RESPONSE * dt;
        this._angVelPitch += (desiredPitch - this._angVelPitch) * ANGULAR_RESPONSE * dt;

        q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this._angVelYaw   * dt))
         .multiply(new THREE.Quaternion().setFromAxisAngle(right,                          this._angVelPitch * dt))
         .normalize();

        // Q/E roll — same inertia model as yaw/pitch
        const rollInput    = (k['KeyE'] ? 1 : 0) - (k['KeyQ'] ? 1 : 0);
        const desiredRoll  = rollInput * TURN_RATE_MAX * 0.6; // roll slightly slower than yaw
        this._angVelRoll  += (desiredRoll - this._angVelRoll) * ANGULAR_RESPONSE * dt;
        if (Math.abs(this._angVelRoll) > 0.0001) {
            q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this._angVelRoll * dt)).normalize();
        }

        // Arrow steering
        const arrowYaw   = (k['ArrowLeft']  ? 1 : 0) - (k['ArrowRight'] ? 1 : 0);
        const arrowPitch = (k['ArrowUp']    ? 1 : 0) - (k['ArrowDown']  ? 1 : 0);
        if (arrowYaw !== 0 || arrowPitch !== 0) {
            q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), arrowYaw * ARROW_RATE))
             .multiply(new THREE.Quaternion().setFromAxisAngle(right, arrowPitch * ARROW_RATE))
             .normalize();
        }

        // Engine force — W/S set _targetSpeed via keydown; engine maintains it automatically.
        // Braking overrides to zero; burn overshoots then decelerates back to _targetSpeed.
        const fwdVel          = this._vel.dot(forward);
        const postBurnDecel   = !burning && !braking && fwdVel > this._targetSpeed + 0.5;
        const effectiveTarget = burning  ? BOOST_MAX
                              : braking  ? 0
                              : Math.max(this._targetSpeed, MIN_SPEED);
        const forceMult       = (burning || postBurnDecel || braking) ? BOOST_MULT : 1;

        const fwdErr = effectiveTarget - fwdVel;
        if (Math.abs(fwdErr) > 0.001) {
            const maxCorr = THRUST * forceMult * dt;
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

        // Engine glow — curSpd already computed above
        const cruiseVis = Math.min(curSpd / CRUISE_PEAK_SPD, 1.0);
        const boostVis  = Math.max(0, Math.min(
            (curSpd - CRUISE_PEAK_SPD) / (BOOST_PEAK_SPD - CRUISE_PEAK_SPD), 1.0));
        const thrForDisplay = burning
            ? 1.0 + boostVis * 0.5
            : k['KeyW'] ? Math.max(cruiseVis, 0.5) : cruiseVis * 0.4;
        this._engineGlows.forEach((g, idx) => {
            const base = idx % 2 === 0 ? 1.5 + thrForDisplay * 4.0 : 3.0 + thrForDisplay * 7.0;
            g.material.emissiveIntensity = base + Math.random() * 0.6;
        });

        // Particles — exhaust direction blends nose-backward with velocity-backward
        // so the trail aligns with actual travel direction, not just where the nose points.
        const isThrusting = curSpd > 0.01 || k['KeyW'];
        const spawnN = isThrusting ? Math.round(10 + boostVis * 10) : 4;
        const exhaustDir = curSpd > 0.5
            ? forward.clone().lerp(this._vel.clone().normalize(), Math.min(curSpd / 60.0, 0.18)).normalize()
            : forward;
        this._spawnParticles(spawnN, exhaustDir, boostVis, cruiseVis);
        this._tickParticles();

        // Camera follow
        // Pull camera back proportionally to speed so fast travel feels cinematic
        const speedFrac = Math.min(curSpd / BOOST_MAX, 1.0);
        const boostZ    = CAM_OFFSET.z * (1.0 + speedFrac * 0.8);
        const camLocal  = new THREE.Vector3(CAM_OFFSET.x, CAM_OFFSET.y, boostZ).applyQuaternion(q);
        this.camera.position.lerp(this.shipGroup.position.clone().add(camLocal), CAM_LERP);
        const lookTarget = this.shipGroup.position.clone().addScaledVector(forward, 10);
        this._camLookAt.lerp(lookTarget, LOOK_LERP);
        this.camera.lookAt(this._camLookAt);

        // HUD speed
        if (this._spdVal) {
            const display = Math.min(Math.round(curSpd / BOOST_MAX * 500), 500);
            this._spdVal.textContent = String(display).padStart(3, '0');
        }
        // HUD burn timer
        if (this._burnRowEl) {
            if (burning) {
                const pct = (this._burnTimer / BURN_DURATION) * 100;
                this._burnRowEl.innerHTML =
                    `<span style="color:#ff9922;letter-spacing:2px">BURN</span>` +
                    `<span style="display:inline-block;width:60px;height:6px;` +
                    `background:linear-gradient(to right,#ff6600 ${pct.toFixed(0)}%,#331100 ${pct.toFixed(0)}%);` +
                    `margin-left:6px;border-radius:3px;vertical-align:middle"></span>`;
            } else if (this._burnCooldown > 0) {
                const pct = ((BURN_COOLDOWN - this._burnCooldown) / BURN_COOLDOWN) * 100;
                this._burnRowEl.innerHTML =
                    `<span style="color:#556677;letter-spacing:2px">RECHARGE</span>` +
                    `<span style="display:inline-block;width:60px;height:6px;` +
                    `background:linear-gradient(to right,#225588 ${pct.toFixed(0)}%,#112233 ${pct.toFixed(0)}%);` +
                    `margin-left:6px;border-radius:3px;vertical-align:middle"></span>`;
            } else {
                this._burnRowEl.innerHTML = `<span style="color:#33aa66;letter-spacing:2px">BURN READY</span>`;
            }
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
        const i   = Math.min(Math.max(thrust, 0), 1);
        const idle = i < 0.15;
        const c    = i * 0.35 + boostIntensity * 0.20;

        if (idle) {
            for (let eng = 0; eng < 2; eng++) {
                const worldExit = this._exits[eng].clone()
                    .multiplyScalar(SHIP_SCALE).applyQuaternion(q).add(pos);
                for (let n = 0; n < 4; n++) {
                    const idx = this._cHead % 400; this._cHead++;
                    this._core.pos.set([worldExit.x, worldExit.y, worldExit.z], idx*3);
                    const sp = 0.0008;
                    this._cVel[idx*3]   = -forward.x*0.00055 + (Math.random()-.5)*sp;
                    this._cVel[idx*3+1] = -forward.y*0.00055 + (Math.random()-.5)*sp;
                    this._cVel[idx*3+2] = -forward.z*0.00055 + (Math.random()-.5)*sp;
                    this._cLife[idx] = 0.35;
                    const f = 0.03;
                    this._core.col[idx*3] = f*0.4; this._core.col[idx*3+1] = f*0.6; this._core.col[idx*3+2] = f;
                }
            }
            return;
        }

        const scaledCount = Math.max(2, Math.floor(countPerEngine * (0.05 + c * 0.5)));
        for (let eng = 0; eng < 2; eng++) {
            const worldExit = this._exits[eng].clone()
                .multiplyScalar(SHIP_SCALE).applyQuaternion(q).add(pos);
            for (let n = 0; n < scaledCount; n++) {
                // Core
                {
                    const idx = this._cHead % 400; this._cHead++;
                    const spd = (0.0012 + Math.random()*0.0008) * (0.2 + c*0.8);
                    const sp  = 0.0009*(0.2+c*0.8);
                    this._core.pos[idx*3]   = worldExit.x;
                    this._core.pos[idx*3+1] = worldExit.y;
                    this._core.pos[idx*3+2] = worldExit.z;
                    this._cVel[idx*3]   = -forward.x*spd+(Math.random()-.5)*sp;
                    this._cVel[idx*3+1] = -forward.y*spd+(Math.random()-.5)*sp;
                    this._cVel[idx*3+2] = -forward.z*spd+(Math.random()-.5)*sp;
                    this._cLife[idx] = 0.3+c*0.5;
                    const hot=0.6+boostIntensity*0.4, cs=0.03+c*0.40;
                    this._core.col[idx*3]=hot*cs; this._core.col[idx*3+1]=0.65*cs; this._core.col[idx*3+2]=cs;
                }
                if (n%2===0) {
                    const idx = this._pHead % 300; this._pHead++;
                    const spd = (0.0006+Math.random()*0.0008)*(0.2+c*0.8);
                    const sp  = 0.004*(0.1+c*0.5);
                    this._plume.pos[idx*3]   = worldExit.x;
                    this._plume.pos[idx*3+1] = worldExit.y;
                    this._plume.pos[idx*3+2] = worldExit.z;
                    this._pVel[idx*3]   = -forward.x*spd+(Math.random()-.5)*sp;
                    this._pVel[idx*3+1] = -forward.y*spd+(Math.random()-.5)*sp;
                    this._pVel[idx*3+2] = -forward.z*spd+(Math.random()-.5)*sp;
                    this._pLife[idx] = 0.3+c*0.5;
                    const base=0.08+boostIntensity*0.14, cs=0.02+c*0.35;
                    this._plume.col[idx*3]=base*cs; this._plume.col[idx*3+1]=0.55*cs; this._plume.col[idx*3+2]=cs;
                }
            }
        }
    }

    // ── Advance particle lifetimes ─────────────────────────────────────────
    _tickParticles() {
        for (let i = 0; i < 400; i++) {
            if (this._cLife[i] <= 0) continue;
            this._cLife[i] -= 0.050;
            if (this._cLife[i] <= 0) {
                this._cLife[i] = 0;
                this._core.pos[i*3] = this._core.pos[i*3+1] = this._core.pos[i*3+2] = 1e6;
                continue;
            }
            const t = this._cLife[i];
            this._core.pos[i*3]   += this._cVel[i*3];
            this._core.pos[i*3+1] += this._cVel[i*3+1];
            this._core.pos[i*3+2] += this._cVel[i*3+2];
            this._core.col[i*3]   = t > 0.55 ? t : t*0.25;
            this._core.col[i*3+1] = t > 0.65 ? t*0.94 : t*0.68;
            this._core.col[i*3+2] = t;
        }
        this._core.posAttr.needsUpdate = true;
        this._core.colAttr.needsUpdate = true;

        for (let i = 0; i < 300; i++) {
            if (this._pLife[i] <= 0) continue;
            this._pLife[i] -= 0.022;
            if (this._pLife[i] <= 0) {
                this._pLife[i] = 0;
                this._plume.pos[i*3] = this._plume.pos[i*3+1] = this._plume.pos[i*3+2] = 1e6;
                continue;
            }
            const t = this._pLife[i];
            this._plume.pos[i*3]   += this._pVel[i*3];
            this._plume.pos[i*3+1] += this._pVel[i*3+1];
            this._plume.pos[i*3+2] += this._pVel[i*3+2];
            this._plume.col[i*3]   = t*0.10;
            this._plume.col[i*3+1] = t*0.58;
            this._plume.col[i*3+2] = t*0.92;
        }
        this._plume.posAttr.needsUpdate = true;
        this._plume.colAttr.needsUpdate = true;
    }
}
