// Pure DOM — no Three.js imports

export function showFocusPanel(data) {
    const panel = document.getElementById('focusPanel');
    if (!panel) return;
    document.getElementById('focusPlanetName').textContent = data.name;
    document.getElementById('focusPlanetType').textContent = data.type || '';
    document.getElementById('focusDiameter').textContent = data.diameter || '—';
    document.getElementById('focusDayLength').textContent = data.dayLength || '—';
    document.getElementById('focusOrbitalPeriod').textContent = data.orbitalPeriod || '—';
    document.getElementById('focusMoons').textContent = data.moons !== undefined ? data.moons : '—';
    document.getElementById('focusDescription').textContent = data.description || '';
    panel.style.opacity = '1';
    panel.style.transform = 'translateY(0)';
    panel.style.pointerEvents = 'auto';
}

export function hideFocusPanel() {
    const panel = document.getElementById('focusPanel');
    if (!panel) return;
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(16px)';
    panel.style.pointerEvents = 'none';
}
