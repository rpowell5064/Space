// Mobile on-screen controls — only initialises on touch devices.
// Provides a virtual joystick for steering and tap/hold buttons for ship actions.

const JOYSTICK_RADIUS = 55;   // px — max knob travel
const LOOK_SCALE      = 0.40; // joystick-px → look-delta scale (tuned down slightly)

// Mirror constants from spaceship.js (must stay in sync)
const MOBILE_SPEED_STEP = 20.0;
const MOBILE_MIN_SPEED  = 1.0;
const MOBILE_CRUISE_MAX = 13.0;  // matches CRUISE_MAX in spaceship.js

export function initMobileControls(shipController) {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) return null;

    // ── Build overlay DOM ────────────────────────────────────────────────
    const root = document.createElement('div');
    root.id = 'mobileControls';
    root.innerHTML = `
        <div id="mobJoyZone">
            <div id="mobJoyBase"></div>
            <div id="mobJoyKnob"></div>
        </div>
        <div id="mobTopBar">
            <div class="mob-btn" id="mobWarp">WARP</div>
            <div class="mob-btn" id="mobExit">EXIT FLY</div>
        </div>
        <div id="mobRightBtns">
            <div class="mob-row">
                <div class="mob-btn mob-tap" id="mobSpeedUp">＋</div>
                <div class="mob-btn mob-tap" id="mobSpeedDown">－</div>
            </div>
            <div class="mob-row">
                <div class="mob-btn mob-hold" id="mobBoost">BOOST</div>
                <div class="mob-btn mob-hold" id="mobBrake">BRAKE</div>
            </div>
        </div>
    `;
    document.body.appendChild(root);

    // ── Joystick ─────────────────────────────────────────────────────────
    const joyZone = root.querySelector('#mobJoyZone');
    const joyKnob = root.querySelector('#mobJoyKnob');
    let joyId = null, joyDx = 0, joyDy = 0, zoneRect;

    joyZone.addEventListener('touchstart', e => {
        e.preventDefault();
        if (joyId !== null) return;
        const t = e.changedTouches[0];
        joyId = t.identifier;
        zoneRect = joyZone.getBoundingClientRect();
    }, { passive: false });

    joyZone.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier !== joyId) continue;
            const cx = zoneRect.left + zoneRect.width  / 2;
            const cy = zoneRect.top  + zoneRect.height / 2;
            let dx = t.clientX - cx;
            let dy = t.clientY - cy;
            const d = Math.hypot(dx, dy);
            if (d > JOYSTICK_RADIUS) { dx = dx / d * JOYSTICK_RADIUS; dy = dy / d * JOYSTICK_RADIUS; }
            joyDx = dx; joyDy = dy;
            joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }
    }, { passive: false });

    const resetJoy = e => {
        for (const t of e.changedTouches) {
            if (t.identifier !== joyId) continue;
            joyId = null; joyDx = 0; joyDy = 0;
            joyKnob.style.transform = 'translate(-50%, -50%)';
        }
    };
    joyZone.addEventListener('touchend',    resetJoy, { passive: false });
    joyZone.addEventListener('touchcancel', resetJoy, { passive: false });

    // ── Speed +/− hold buttons — ramp speed while held, same rate as W/S ──
    let speedUpHeld = false, speedDownHeld = false;
    function speedHold(id, setHeld) {
        const el = root.querySelector(`#${id}`);
        el.addEventListener('touchstart',  e => { e.preventDefault(); setHeld(true);  el.classList.add('held');    }, { passive: false });
        el.addEventListener('touchend',    e => { e.preventDefault(); setHeld(false); el.classList.remove('held'); }, { passive: false });
        el.addEventListener('touchcancel', e => { e.preventDefault(); setHeld(false); el.classList.remove('held'); }, { passive: false });
    }
    speedHold('mobSpeedUp',   v => speedUpHeld   = v);
    speedHold('mobSpeedDown', v => speedDownHeld = v);

    // ── BOOST: engages _fullThrottle latch — mirrors Space keydown in spaceship.js.
    //    Drain/auto-cut is handled by the spaceship.js update loop via _boostCharge.
    const boostEl = root.querySelector('#mobBoost');
    const triggerBoost = () => {
        if (shipController.active && !shipController._orbitMode && shipController._boostCharge > 0) {
            shipController._fullThrottle = true;
        }
    };
    boostEl.addEventListener('touchstart', e => { e.preventDefault(); triggerBoost(); boostEl.classList.add('held'); },    { passive: false });
    boostEl.addEventListener('touchend',   e => { e.preventDefault(); boostEl.classList.remove('held'); }, { passive: false });
    boostEl.addEventListener('touchcancel',e => { e.preventDefault(); boostEl.classList.remove('held'); }, { passive: false });

    // ── BRAKE: polling-based in update loop, keys[] works fine ───────────
    const brakeEl = root.querySelector('#mobBrake');
    const setBrake = v => { shipController.keys['ShiftLeft'] = v; brakeEl.classList.toggle('held', v); };
    brakeEl.addEventListener('touchstart',  e => { e.preventDefault(); setBrake(true);  }, { passive: false });
    brakeEl.addEventListener('touchend',    e => { e.preventDefault(); setBrake(false); }, { passive: false });
    brakeEl.addEventListener('touchcancel', e => { e.preventDefault(); setBrake(false); }, { passive: false });

    // ── Action tap buttons ────────────────────────────────────────────────
    function actionTap(id, action) {
        root.querySelector(`#${id}`).addEventListener('touchstart', e => {
            e.preventDefault(); action();
        }, { passive: false });
    }
    actionTap('mobWarp', () => {
        if (shipController.active && shipController._warpTarget) shipController._doWarp();
    });
    actionTap('mobExit', () => {
        if (!shipController.active) return;
        shipController.exit();
        document.getElementById('flyBtn')?.classList.remove('active');
        root.style.display = 'none';
    });

    // ── Per-frame tick ────────────────────────────────────────────────────
    function tick(dt = 0.016) {
        if (shipController.active) {
            // Always push look delta — sending 0,0 when centered resets _mouseNDC
            shipController.addLookDelta(joyDx * LOOK_SCALE, joyDy * LOOK_SCALE);

            // Ramp speed while +/− held — mirrors W/S rate in spaceship.js
            if (!shipController._orbitMode) {
                if (speedUpHeld)   { shipController._targetSpeed = Math.min(shipController._targetSpeed + 8 * dt, MOBILE_CRUISE_MAX); shipController._fullThrottle = false; }
                if (speedDownHeld) { shipController._targetSpeed = Math.max(shipController._targetSpeed - 8 * dt, 0);                 shipController._fullThrottle = false; }
            }
        }
        // While orbiting, hide speed/boost/brake — they do nothing until orbit breaks
        root.classList.toggle('orbit-mode', !!(shipController.active && shipController._orbitMode));
    }

    return {
        show() { root.style.display = 'block'; },
        hide() { root.style.display = 'none'; },
        tick,
    };
}
