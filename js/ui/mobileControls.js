// Mobile on-screen controls — only initialises on touch devices.
// Provides a virtual joystick for steering and tap/hold buttons for ship actions.

const JOYSTICK_RADIUS = 55;   // px — max knob travel
const LOOK_SCALE      = 0.45; // joystick-px per frame → look-delta scaling

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
            <div class="mob-btn mob-hold" id="mobThrust">THRUST</div>
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

    // ── Hold buttons ─────────────────────────────────────────────────────
    function holdBtn(id, code) {
        const el = root.querySelector(`#${id}`);
        const toggle = v => { shipController.keys[code] = v; el.classList.toggle('held', v); };
        el.addEventListener('touchstart',  e => { e.preventDefault(); toggle(true);  }, { passive: false });
        el.addEventListener('touchend',    e => { e.preventDefault(); toggle(false); }, { passive: false });
        el.addEventListener('touchcancel', e => { e.preventDefault(); toggle(false); }, { passive: false });
    }
    holdBtn('mobThrust', 'KeyW');
    holdBtn('mobBoost',  'Space');
    holdBtn('mobBrake',  'ShiftLeft');

    // ── Tap buttons ──────────────────────────────────────────────────────
    function tapBtn(id, action) {
        root.querySelector(`#${id}`).addEventListener('touchstart', e => {
            e.preventDefault(); action();
        }, { passive: false });
    }
    tapBtn('mobWarp', () => {
        if (shipController.active && shipController._warpTarget) shipController._doWarp();
    });
    tapBtn('mobBreakOrbit', () => {
        if (shipController.active && shipController._orbitMode) shipController._breakOrbit();
    });
    tapBtn('mobExit', () => {
        if (!shipController.active) return;
        shipController.exit();
        document.getElementById('flyBtn')?.classList.remove('active');
        root.style.display = 'none';
    });

    // ── Per-frame tick: inject joystick as look delta ────────────────────
    function tick() {
        if (shipController.active && (joyDx !== 0 || joyDy !== 0)) {
            shipController.addLookDelta(joyDx * LOOK_SCALE, joyDy * LOOK_SCALE);
        }
    }

    return {
        show() { root.style.display = 'block'; },
        hide() { root.style.display = 'none'; },
        tick,
    };
}
