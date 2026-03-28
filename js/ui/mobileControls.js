// Mobile on-screen controls — only initialises on touch devices.
// Provides a virtual joystick for steering and tap/hold buttons for ship actions.

const JOYSTICK_RADIUS = 55;   // px — max knob travel
const LOOK_SCALE      = 0.40; // joystick-px → look-delta scale (tuned down slightly)

// Mirror constants from spaceship.js (must stay in sync)
const MOBILE_SPEED_STEP    = 5.0;
const MOBILE_MIN_SPEED     = 1.0;
const MOBILE_BOOST_MAX     = 100.0;
const MOBILE_BURN_DURATION = 1.0;

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
            <div class="mob-btn" id="mobBreakOrbit">BREAK ORBIT</div>
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

    // ── Speed +/− tap buttons (mirror W / S keydown behavior) ────────────
    function tapBtn(id, action) {
        const el = root.querySelector(`#${id}`);
        el.addEventListener('touchstart', e => { e.preventDefault(); action(); el.classList.add('held'); },    { passive: false });
        el.addEventListener('touchend',   e => { e.preventDefault(); el.classList.remove('held'); }, { passive: false });
    }
    tapBtn('mobSpeedUp', () => {
        if (shipController.active && !shipController._orbitMode)
            shipController._targetSpeed = Math.min(shipController._targetSpeed + MOBILE_SPEED_STEP, MOBILE_BOOST_MAX);
    });
    tapBtn('mobSpeedDown', () => {
        if (shipController.active && !shipController._orbitMode)
            shipController._targetSpeed = Math.max(shipController._targetSpeed - MOBILE_SPEED_STEP, MOBILE_MIN_SPEED);
    });

    // ── BOOST: triggers burn timer directly (Space is keydown-only, not polled) ──
    const boostEl = root.querySelector('#mobBoost');
    const triggerBoost = pressed => {
        if (pressed && shipController.active && !shipController._orbitMode &&
            shipController._burnTimer <= 0 && shipController._burnCooldown <= 0) {
            shipController._burnTimer = MOBILE_BURN_DURATION;
        }
        boostEl.classList.toggle('held', pressed);
    };
    boostEl.addEventListener('touchstart',  e => { e.preventDefault(); triggerBoost(true);  }, { passive: false });
    boostEl.addEventListener('touchend',    e => { e.preventDefault(); triggerBoost(false); }, { passive: false });
    boostEl.addEventListener('touchcancel', e => { e.preventDefault(); triggerBoost(false); }, { passive: false });

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
    actionTap('mobBreakOrbit', () => {
        if (shipController.active && shipController._orbitMode) shipController._breakOrbit();
    });
    actionTap('mobExit', () => {
        if (!shipController.active) return;
        shipController.exit();
        document.getElementById('flyBtn')?.classList.remove('active');
        root.style.display = 'none';
    });

    // ── Per-frame tick ────────────────────────────────────────────────────
    function tick() {
        if (shipController.active) {
            // Always push look delta — sending 0,0 when centered resets _mouseNDC
            // so the ship flies straight when joystick is released
            shipController.addLookDelta(joyDx * LOOK_SCALE, joyDy * LOOK_SCALE);
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
