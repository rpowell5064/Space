// UI controls wiring — no Three.js imports

/**
 * @param {object} opts
 * @param {function} opts.onPlanetSelect - called with the change event
 * @param {function} opts.onSpeedChange  - called with the input event
 * @param {function} opts.onFly         - called when fly button clicked
 * @param {function} opts.onClosePanel  - called when focus close button clicked
 * @param {object}   opts.labelRenderer - CSS2DRenderer instance
 * @param {Array}    opts.orbitLines    - array of THREE.Line objects
 */
export function initControls({ onPlanetSelect, onSpeedChange, onFly, onClosePanel, labelRenderer, orbitLines }) {
    const uiContainer  = document.getElementById('uiContainer');
    const menuToggle   = document.getElementById('menuToggle');
    const uiClose      = document.getElementById('uiClose');

    function closePanel() {
        uiContainer?.classList.remove('open');
        menuToggle?.classList.remove('open');
    }
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            const isOpen = uiContainer?.classList.toggle('open');
            menuToggle.classList.toggle('open', isOpen);
        });
    }
    if (uiClose) uiClose.addEventListener('click', closePanel);

    const planetSelect = document.getElementById('planetSelect');
    if (planetSelect) {
        planetSelect.addEventListener('change', e => {
            onPlanetSelect(e);
            // Auto-close the panel on mobile after selecting a planet
            if (window.matchMedia('(max-width: 900px)').matches) closePanel();
        });
    }

    const spinSpeedSlider = document.getElementById('spinSpeed');
    if (spinSpeedSlider) spinSpeedSlider.addEventListener('input', onSpeedChange);

    const labelsBtn = document.getElementById('labelsBtn');
    if (labelsBtn) {
        labelsBtn.addEventListener('click', () => {
            const hidden = labelRenderer.domElement.style.display === 'none';
            labelRenderer.domElement.style.display = hidden ? '' : 'none';
            labelsBtn.classList.toggle('active', hidden);
        });
    }

    const orbitsBtn = document.getElementById('orbitsBtn');
    if (orbitsBtn) {
        orbitsBtn.addEventListener('click', () => {
            const nowVisible = !orbitLines[0]?.visible;
            orbitLines.forEach(l => { l.visible = nowVisible; });
            orbitsBtn.classList.toggle('active', nowVisible);
        });
    }

    const flyBtn = document.getElementById('flyBtn');
    if (flyBtn) {
        flyBtn.addEventListener('click', () => {
            onFly(flyBtn);
            if (window.matchMedia('(max-width: 900px)').matches) closePanel();
        });
    }

    const closeBtn = document.getElementById('focusClose');
    if (closeBtn) closeBtn.addEventListener('click', onClosePanel);
}
