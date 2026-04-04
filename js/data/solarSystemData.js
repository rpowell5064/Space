// Static configuration data — no Three.js imports
// Scale: 1 AU = 100 scene units
// Planet sizes: Earth = 4.0 baseline; all planets proportional to real radii
//   (Sun kept at 25 — true proportional ~437 would engulf Mercury's orbit)

export const PLANET_DATA = [
    {
        name: "Mercury", size: 1.5, distance: 39,  eccentricity: 0.206, speed: 0.000415,  axialTilt: 0.03,
        selfRotation: 0.017, type: "Terrestrial Planet",
        diameter: "4,879 km", dayLength: "58.65 Earth days", orbitalPeriod: "88 Earth days", moons: 0,
        description: "The smallest planet and closest to the Sun. Mercury has no atmosphere, creating extreme temperature swings from -180°C to 430°C across its heavily cratered surface."
    },
    {
        name: "Venus",   size: 3.8, distance: 72,  eccentricity: 0.007, speed: 0.000163,  axialTilt: 177.4,
        selfRotation: -0.004, type: "Terrestrial Planet",
        diameter: "12,104 km", dayLength: "243 Earth days", orbitalPeriod: "225 Earth days", moons: 0,
        description: "The hottest planet at 465°C. Venus rotates backwards under a crushing atmosphere of CO₂ and sulfuric acid clouds, making it the most hostile surface in the solar system."
    },
    {
        name: "Earth",   size: 4,   distance: 100, eccentricity: 0.017, speed: 0.0001,    axialTilt: 23.4,
        selfRotation: 1.0, type: "Terrestrial Planet",
        diameter: "12,742 km", dayLength: "24 hours", orbitalPeriod: "365.25 days", moons: 1,
        description: "Our home world — the only known planet with life. Earth has liquid water oceans, a protective magnetic field, and a diverse biosphere spanning from deep ocean vents to mountain peaks."
    },
    {
        name: "Mars",    size: 2.1, distance: 152, eccentricity: 0.093, speed: 0.0000532, axialTilt: 25.2,
        selfRotation: 0.976, type: "Terrestrial Planet",
        diameter: "6,779 km", dayLength: "24.6 hours", orbitalPeriod: "687 Earth days", moons: 2,
        description: "The Red Planet hosts Olympus Mons, the solar system's largest volcano at 21 km high. Mars is the primary target for human exploration and potential future colonization."
    },
    {
        name: "Jupiter", size: 44,  distance: 520, eccentricity: 0.049, speed: 0.00000843, axialTilt: 3.1,
        selfRotation: 2.41, type: "Gas Giant",
        diameter: "139,820 km", dayLength: "9.9 hours", orbitalPeriod: "11.9 Earth years", moons: 95,
        description: "The king of planets. Jupiter's Great Red Spot is a storm larger than Earth that has raged for centuries. Its powerful gravity acts as a shield, deflecting asteroids from the inner solar system."
    },
    {
        name: "Saturn",  size: 36.5, distance: 954, eccentricity: 0.057, speed: 0.00000340, axialTilt: 26.7,
        selfRotation: 2.25, hasRing: true, type: "Gas Giant",
        diameter: "116,460 km", dayLength: "10.7 hours", orbitalPeriod: "29.5 Earth years", moons: 146,
        description: "Famous for its spectacular ring system of ice and rock spanning 282,000 km. Saturn is so low-density it could theoretically float on water, and hosts 146 known moons including Titan with its thick atmosphere."
    },
    {
        name: "Uranus",  size: 16,  distance: 1919, eccentricity: 0.046, speed: 0.00000119, axialTilt: 97.8,
        selfRotation: -1.39, type: "Ice Giant",
        diameter: "50,724 km", dayLength: "17.2 hours", orbitalPeriod: "84 Earth years", moons: 28,
        description: "An ice giant tilted on its side — likely the result of an ancient giant impact. Uranus emits almost no internal heat and experiences extreme 42-year-long seasons."
    },
    {
        name: "Neptune", size: 15.5, distance: 3007, eccentricity: 0.010, speed: 0.000000607, axialTilt: 28.3,
        selfRotation: 1.49, type: "Ice Giant",
        diameter: "49,244 km", dayLength: "16.1 hours", orbitalPeriod: "165 Earth years", moons: 16,
        description: "The windiest planet, with supersonic winds reaching 2,100 km/h. Neptune's largest moon Triton orbits backwards and is slowly spiraling inward — it will eventually break apart into a new ring system."
    }
];

export const SUN_DATA = {
    name: 'Sun', type: 'G-type Main Sequence Star',
    diameter: '1,392,700 km', dayLength: '25–35 Earth days',
    orbitalPeriod: '225 million years', moons: 'N/A',
    description: "The Sun contains 99.86% of the solar system's total mass. Its core reaches 15 million°C, fusing 600 million tonnes of hydrogen per second into helium and powering all life on Earth."
};

// Major moons — sizes proportional to Earth's Moon (Moon = 1.1 at Earth = 4 scale)
// Orbit radii are artistically compressed for visibility but scaled to planet size
export const MOON_DATA = [
    // Earth — Moon radius 1737 km = 0.273× Earth → 1.1 scene units
    { planet: 'Earth',   name: 'Moon',      size: 1.1,  orbitRadius: 14,  speed:  0.000175, color: 0xBBBBBB },
    // Mars — Phobos/Deimos are tiny (11 km / 6 km); kept large enough to see
    { planet: 'Mars',    name: 'Phobos',    size: 0.18, orbitRadius:  6,  speed:  0.000271, color: 0x998877 },
    { planet: 'Mars',    name: 'Deimos',    size: 0.12, orbitRadius:  9,  speed:  0.000214, color: 0x887766 },
    // Jupiter — 4 Galilean moons; sizes proportional (Ganymede > Callisto > Io > Europa)
    // Orbit radii scaled ×2.2 for Jupiter size 44 vs old 20
    { planet: 'Jupiter', name: 'Io',        size: 1.1,  orbitRadius:  81, speed:  0.000129, color: 0xFFDD88 },
    { planet: 'Jupiter', name: 'Europa',    size: 1.0,  orbitRadius: 110, speed:  0.000111, color: 0xDDCCAA },
    { planet: 'Jupiter', name: 'Ganymede',  size: 1.7,  orbitRadius: 147, speed:  0.000096, color: 0x998877 },
    { planet: 'Jupiter', name: 'Callisto',  size: 1.5,  orbitRadius: 191, speed:  0.000084, color: 0x776655 },
    // Saturn — ring outer edge ≈ size×2.8 = 102.2; all moons start beyond 115
    // Orbit radii scaled ×2.15 for Saturn size 36.5 vs old 17
    { planet: 'Saturn',  name: 'Mimas',     size: 0.25, orbitRadius: 118, speed:  0.000111, color: 0xCCCCCC },
    { planet: 'Saturn',  name: 'Enceladus', size: 0.30, orbitRadius: 133, speed:  0.000105, color: 0xEEEEFF },
    { planet: 'Saturn',  name: 'Tethys',    size: 0.38, orbitRadius: 146, speed:  0.000101, color: 0xDDDDCC },
    { planet: 'Saturn',  name: 'Dione',     size: 0.38, orbitRadius: 159, speed:  0.000097, color: 0xCCBBAA },
    { planet: 'Saturn',  name: 'Rhea',      size: 0.48, orbitRadius: 172, speed:  0.000093, color: 0xCCBBAA },
    { planet: 'Saturn',  name: 'Titan',     size: 1.6,  orbitRadius: 189, speed:  0.000089, color: 0xCC8833 },
    { planet: 'Saturn',  name: 'Iapetus',   size: 0.47, orbitRadius: 215, speed:  0.000084, color: 0x998877 },
    // Uranus — 5 major moons; orbit in Uranus equatorial plane (nearly perpendicular to ecliptic)
    // Orbit radii scaled ×1.78 for Uranus size 16 vs old 9
    { planet: 'Uranus',  name: 'Miranda',   size: 0.22, orbitRadius:  30, speed:  0.000183, color: 0xBBBBCC },
    { planet: 'Uranus',  name: 'Ariel',     size: 0.37, orbitRadius:  37, speed:  0.000162, color: 0xCCCCCC },
    { planet: 'Uranus',  name: 'Umbriel',   size: 0.37, orbitRadius:  46, speed:  0.000147, color: 0x888888 },
    { planet: 'Uranus',  name: 'Titania',   size: 0.50, orbitRadius:  57, speed:  0.000132, color: 0xAAAAAA },
    { planet: 'Uranus',  name: 'Oberon',    size: 0.48, orbitRadius:  68, speed:  0.000119, color: 0x999999 },
    // Neptune — Triton (retrograde) + Nereid
    // Orbit radii scaled ×1.82 for Neptune size 15.5 vs old 8.5
    { planet: 'Neptune', name: 'Triton',    size: 0.86, orbitRadius:  36, speed: -0.000168, color: 0xCCBBAA },
    { planet: 'Neptune', name: 'Nereid',    size: 0.18, orbitRadius:  62, speed:  0.000129, color: 0xAAAAAA },
];

export const TEXTURE_FILES = {
    Mercury: './textures/2k_mercury.jpg',
    Venus:   './textures/2k_venus_surface.jpg',
    Earth:   './textures/2k_earth_daymap.jpg',
    Mars:    './textures/2k_mars.jpg',
    Jupiter: './textures/2k_jupiter.jpg',
    Saturn:  './textures/2k_saturn.jpg',
    Uranus:  './textures/2k_uranus.jpg',
    Neptune: './textures/2k_neptune.jpg',
};

export const ATMOSPHERE_COLORS = {
    Earth:   0x4488FF,
    Venus:   0xFFCC88,
    Neptune: 0x2244BB
};
