import * as THREE from 'https://esm.sh/three@0.160.0';

// Module-level state
let asteroidMesh = null;
let asteroidOrbitData = null;
let asteroidSpriteGroup = null;
let _scene = null;

export async function createAsteroidBelt(scene) {
    _scene = scene;

    const loader = new THREE.TextureLoader();

    // Load textures internally
    const rockNormalTexture = await new Promise((resolve, reject) => {
        loader.load(
            './textures/asteroid_normal.png',
            (tex) => {
                tex.colorSpace = THREE.NoColorSpace;
                resolve(tex);
            },
            undefined,
            (err) => {
                console.error("NORMAL MAP FAILED", err);
                resolve(null);
            }
        );
    });

    const asteroidSpriteTexture = await new Promise((resolve, reject) => {
        loader.load(
            './textures/asteroid_sprite.png',
            (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.needsUpdate = true;
                resolve(tex);
            },
            undefined,
            (err) => {
                console.error("SPRITE FAILED", err);
                resolve(null);
            }
        );
    });

    _buildBelt(scene, rockNormalTexture, asteroidSpriteTexture);
}

function _buildBelt(scene, rockNormalTexture, asteroidSpriteTexture) {
    // Geometry with procedural displacement
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const pos = rockGeo.attributes.position;
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);

        const n =
            Math.sin(v.x * 3.1) *
            Math.sin(v.y * 2.7) *
            Math.sin(v.z * 3.7);

        const displacement = 0.18 * n;
        v.addScaledVector(v.clone().normalize(), displacement);

        pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    rockGeo.computeVertexNormals();

    // Material with normal map — high normalScale for dramatic surface detail
    const matOptions = {
        roughness: 0.82,
        metalness: 0.04,
        flatShading: false,
    };
    if (rockNormalTexture) {
        matOptions.normalMap = rockNormalTexture;
        matOptions.normalScale = new THREE.Vector2(4.5, 4.5);
    }
    const rockMat = new THREE.MeshStandardMaterial(matOptions);

    const count = 3500;
    const mesh = new THREE.InstancedMesh(rockGeo, rockMat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // instances span 220–340 units; don't cull by unit-sphere at origin

    mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 3),
        3
    );
    mesh.instanceColor.needsUpdate = true;

    scene.add(mesh);
    asteroidMesh = mesh;

    // Small fill light so asteroids aren't pitch black on their dark sides
    if (!scene.__asteroidAmbient) {
        const amb = new THREE.AmbientLight(0xffffff, 0.10);
        scene.add(amb);
        scene.__asteroidAmbient = amb;
    }

    // Sprite LOD group
    asteroidSpriteGroup = new THREE.Group();
    scene.add(asteroidSpriteGroup);

    // Build a tight dot sprite texture matching a given rock color.
    // Gradient radius 18 (out of 32) keeps it compact — distant asteroids should
    // read as small points, not glowing discs.
    function makeSpriteTexture(r, g, b) {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 18);
        grad.addColorStop(0.0,  `rgba(${r}, ${g}, ${b}, 1.0)`);
        grad.addColorStop(0.50, `rgba(${Math.round(r*0.72)}, ${Math.round(g*0.72)}, ${Math.round(b*0.72)}, 0.65)`);
        grad.addColorStop(0.85, `rgba(${Math.round(r*0.45)}, ${Math.round(g*0.45)}, ${Math.round(b*0.45)}, 0.20)`);
        grad.addColorStop(1.0,  `rgba(0, 0, 0, 0.0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
    }

    // Three variants matching the three 3D rock color groups (same thresholds as below).
    // Dark (75%): rocky gray-brown  Mid (17%): warmer brown  Light (8%): pale gray
    const spriteMats = [
        new THREE.SpriteMaterial({ map: makeSpriteTexture( 93,  85,  76), transparent: true, depthWrite: false }),
        new THREE.SpriteMaterial({ map: makeSpriteTexture(133, 117, 103), transparent: true, depthWrite: false }),
        new THREE.SpriteMaterial({ map: makeSpriteTexture(182, 172, 160), transparent: true, depthWrite: false }),
    ];

    // Kirkwood gaps at real AU resonance positions (×100 scale)
    // 4:1 @ 2.50 AU, 3:1 @ 2.82 AU, 5:2 @ 2.95 AU, 2:1 @ 3.27 AU
    const gaps = [
        [248, 254],
        [279, 285],
        [292, 298],
        [324, 330],
    ];

    function inGap(r) {
        return gaps.some(([lo, hi]) => r >= lo && r <= hi);
    }

    function triRand() { return Math.random() + Math.random(); }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    asteroidOrbitData = [];

    let i = 0;
    let attempts = 0;

    while (i < count && attempts < count * 12) {
        attempts++;

        // 2.2–3.4 AU range with triangular distribution peaked at 2.8 AU
        const r = 220 + triRand() * 60;
        if (inGap(r) && Math.random() < 0.92) continue;

        const ecc = (Math.random() - 0.5) * 5;
        const incl = (triRand() - 1) * 10;
        const angle = Math.random() * Math.PI * 2;

        const x = (r + ecc) * Math.cos(angle);
        const y = incl;
        const z = (r + ecc) * Math.sin(angle);

        dummy.position.set(x, y, z);

        const rx = Math.random() * Math.PI;
        const ry = Math.random() * Math.PI;
        const rz = Math.random() * Math.PI;
        dummy.rotation.set(rx, ry, rz);

        const s = 0.05 + Math.random() * 0.20;
        dummy.scale.set(s, s, s);

        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // Color variation — same thresholds drive both 3D rock color and sprite material
        const t = Math.random();
        let spriteMatIdx;
        if (t < 0.75) {
            color.setRGB(0.32 + Math.random() * 0.10, 0.30 + Math.random() * 0.08, 0.28 + Math.random() * 0.06);
            spriteMatIdx = 0;
        } else if (t < 0.92) {
            color.setRGB(0.45 + Math.random() * 0.15, 0.40 + Math.random() * 0.12, 0.36 + Math.random() * 0.10);
            spriteMatIdx = 1;
        } else {
            color.setRGB(0.65 + Math.random() * 0.15, 0.62 + Math.random() * 0.12, 0.60 + Math.random() * 0.10);
            spriteMatIdx = 2;
        }
        mesh.instanceColor.setXYZ(i, color.r, color.g, color.b);

        // Tumbling
        const tumbleAxis = new THREE.Vector3(
            Math.random() * 2 - 1,
            Math.random() * 2 - 1,
            Math.random() * 2 - 1
        ).normalize();

        // tumbleSpeed in rad/frame (no delta) — visibly spinning
        const tumbleSpeed = 0.004 + Math.random() * 0.010;
        const tumbleAngle = Math.random() * Math.PI * 2;

        asteroidOrbitData.push({
            radius: r + ecc,
            angle,
            // orbital speed in rad/frame — between Mars (0.0000532) and Jupiter (0.00000843)
            speed: 0.000010 + Math.random() * 0.000012,
            incl,
            s,
            tumbleAxis,
            tumbleSpeed,
            tumbleAngle,
            sprite: null,
            spriteMat: spriteMats[spriteMatIdx],
        });

        i++;
    }

    mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
}

export function updateAsteroids(cameraPosition) {
    if (!asteroidMesh || !asteroidOrbitData) return;

    const mesh = asteroidMesh;
    const orbitData = asteroidOrbitData;
    const dummy = new THREE.Object3D();
    const camPos = cameraPosition;

    // LOD thresholds — 3D rocks within 400 units, sprites beyond 700
    const nearCut = 400 * 400;
    const farCut  = 700 * 700;

    for (let i = 0; i < orbitData.length; i++) {
        const o = orbitData[i];

        o.angle += o.speed;  // rad/frame, consistent with planet orbit system

        const x = o.radius * Math.cos(o.angle);
        const z = o.radius * Math.sin(o.angle);
        const y = o.incl;

        const dist2 = camPos.distanceToSquared(new THREE.Vector3(x, y, z));

        // FAR -> SPRITE
        if (dist2 > farCut) {
            if (!o.sprite) {
                o.sprite = new THREE.Sprite(o.spriteMat);
                asteroidSpriteGroup.add(o.sprite);
            }

            o.sprite.visible = true;
            o.sprite.position.set(x, y, z);

            // Scale sprites to match apparent size of 3D rocks at the LOD boundary.
            // 3D rocks at farCut (~700 units) subtend ~s/700 radians; ×10 keeps
            // sprites roughly consistent in screen size without ballooning.
            o.sprite.scale.set(o.s * 10, o.s * 10, 1);

            // Hide instanced mesh
            dummy.position.set(0, -99999, 0);
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            continue;
        }

        // NEAR -> 3D ROCK
        if (o.sprite) o.sprite.visible = false;

        dummy.position.set(x, y, z);

        o.tumbleAngle += o.tumbleSpeed;  // rad/frame, no delta
        dummy.quaternion.setFromAxisAngle(o.tumbleAxis, o.tumbleAngle);

        dummy.scale.set(o.s, o.s, o.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
}
