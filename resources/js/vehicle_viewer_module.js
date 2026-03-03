/**
 * Reentry Vehicle Viewer Module
 *
 * A self-contained 3D vehicle visualization module for reentry simulation.
 * Renders spacecraft with plasma effects, bow shock, and thermal visualization.
 *
 * USAGE:
 *
 *   import { initializeVehicleViewer } from './vehicle_viewer_module.js';
 *
 *   // Create viewer in a container element
 *   const viewer = initializeVehicleViewer(document.getElementById('vehicle-pane'));
 *
 *   // Update state from parent simulation (call each frame)
 *   viewer.updateVehicleState({
 *       time: 120.5,           // Simulation time in seconds
 *       heatFlux: 350,         // Heat flux in kW/m²
 *       liftToDrag: 0.32,      // L/D ratio (determines vehicle)
 *       bankAngle: 45,         // Bank angle in degrees (absolute)
 *       flightPathAngle: -12   // Flight path angle in degrees (absolute)
 *   });
 *
 *   // Control playback
 *   viewer.setPlaybackState(true);  // true = rendering, false = frozen
 *
 *   // Clean up when done
 *   viewer.dispose();
 *
 * VEHICLE SELECTION BY L/D:
 *   0.00 - 0.05  : School Bus (tumbling, uncontrolled)
 *   0.05 - 0.175 : Stardust SRC
 *   0.175 - 0.30 : Mercury
 *   0.30 - 0.525 : Apollo CM
 *   0.525 - 0.75 : Dream Chaser
 *   0.75 - 0.925 : X-37B
 *   0.925+       : Shuttle Orbiter
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Initialize the vehicle viewer module
 * @param {HTMLElement} containerElement - DOM element to render into
 * @param {Object} config - Optional configuration object
 * @returns {Object} Viewer API object
 */
export function initializeVehicleViewer(containerElement, config = {}) {
    // ================================================================
    // SCENE SETUP
    // ================================================================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Camera
    const camera = new THREE.PerspectiveCamera(60, containerElement.clientWidth / containerElement.clientHeight, 0.1, 1000);
    camera.position.set(5, 3, 8);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerElement.clientWidth, containerElement.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    containerElement.appendChild(renderer.domElement);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0x4488ff, 0.3);
    backLight.position.set(-5, 5, -5);
    scene.add(backLight);

    // Heat glow light (dynamic)
    const heatLight = new THREE.PointLight(0xff4400, 0, 20);
    heatLight.position.set(0, -2, 0);
    scene.add(heatLight);

    // ================================================================
    // VEHICLE DEFINITIONS
    // ================================================================
    const vehicles = {
        1: { name: 'Apollo CM', filename: 'Apollo_CM_heatshield.glb', heatShieldMeshes: ['Cube', 'heat-shield'], realSize: 3.9, fillPercent: 0.70, axesScale: 1.0 },
        2: { name: 'Dream Chaser', filename: 'DreamChaser_heatshield.glb', heatShieldMeshes: ['heatshield', 'heat-shield', 'thermal'], realSize: 14.0, fillPercent: 0.70, axesScale: 0.75 },
        3: { name: 'X-37B', filename: 'x-37b.glb', heatShieldMeshes: ['heatshield', 'heat-shield', 'thermal', 'bottom'], realSize: 8.9, fillPercent: 0.70, axesScale: 0.75 },
        4: { name: 'Stardust SRC', filename: 'stardust_capsule.glb', heatShieldMeshes: ['HeatShield', 'heat-shield', 'heatshield'], realSize: 0.81, fillPercent: 0.70, axesScale: 1.25 },
        5: { name: 'Mercury', filename: 'mercury_capsule.glb', heatShieldMeshes: ['HeatShield', 'heat-shield', 'heatshield'], realSize: 2.9, fillPercent: 0.70, axesScale: 1.0 },
        6: { name: 'School Bus', filename: 'school_bus.glb', heatShieldMeshes: [], isTumbling: true, dynamicHeatShield: true, realSize: 18.0, fillPercent: 0.70, axesScale: 0.5 },
        7: { name: 'Shuttle Orbiter', filename: 'shuttle_orbiter.glb', heatShieldMeshes: ['HeatShield', 'heat-shield', 'heatshield', 'BellyTiles'], realSize: 56.0, fillPercent: 0.95, useModelOrigin: true, axesScale: 0.375 }
    };

    // Default fill percentage (used if not specified per vehicle)
    const DEFAULT_FILL_PERCENT = 0.70;
    const CAMERA_FOV = 60; // degrees (must match PerspectiveCamera FOV)

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    let currentVehicle = null;
    let currentVehicleConfig = null;
    let heatShieldMeshes = [];
    let heatShieldVertices = [];
    let cachedWorldVerts = [];
    let originalMaterials = new Map();
    let heatFlux = 0;
    let trailLengthMultiplier = 1.5;

    // Playback state
    let isPlaying = true;
    const clock = new THREE.Clock();

    // External state (set by updateVehicleState)
    let externalState = {
        time: 0,
        heatFlux: 0,
        liftToDrag: 0.40,
        bankAngle: 0,
        flightPathAngle: 0
    };
    let previousSimTime = 0; // Track previous simulation time for computing sim dt

    // Body axes for visualization
    let bodyAxes = null;

    // Heat color constants
    const COLOR_COLD = new THREE.Color(0x1a1a1a);
    const COLOR_DARK_RED = new THREE.Color(0x4a0000);
    const COLOR_RED = new THREE.Color(0xff1100);
    const COLOR_ORANGE = new THREE.Color(0xff5500);
    const COLOR_YELLOW = new THREE.Color(0xffdd00);
    const COLOR_WHITE = new THREE.Color(0xffffff);

    // Neutral atmospheric grey for smoke transition
    const SMOKE_GREY = new THREE.Color(160/255, 160/255, 165/255);

    // Plasma color transition stages (ionization colors)
    const PLASMA_PINK = new THREE.Color(1.0, 0.4, 0.6);
    const PLASMA_VIOLET = new THREE.Color(0.6, 0.3, 0.8);
    const PLASMA_BLUE = new THREE.Color(0.4, 0.5, 0.9);

    // Soot layer colors
    const SOOT_BURNT_ORANGE = new THREE.Color(0.6, 0.3, 0.1);
    const SOOT_BROWN = new THREE.Color(0.3, 0.2, 0.15);
    const SOOT_DARK_GREY = new THREE.Color(0.15, 0.15, 0.15);

    const PEAK_HEAT_FLUX = 4000;
    const SPAWN_HEAT_THRESHOLD = 200;

    // Cached heat shield color for particle spawning
    let cachedHeatShieldColor = new THREE.Color(0x1a1a1a);

    // ================================================================
    // TUMBLING REENTRY SYSTEM
    // ================================================================
    let tumbleCurrentQuat = new THREE.Quaternion();
    let tumbleTargetQuat = new THREE.Quaternion();
    let tumbleAngularVelocity = 0;
    let tumbleTargetVelocity = 0;
    let tumbleAxis = new THREE.Vector3(1, 0, 0);

    let phaseTimer = 0;
    let phaseDuration = 0;
    let isResting = false;

    let oscillationTime = 0;
    let oscillationFreqX = 0;
    let oscillationFreqY = 0;
    let oscillationFreqZ = 0;
    let oscillationAmpX = 0;
    let oscillationAmpY = 0;
    let oscillationAmpZ = 0;
    let oscillationPhaseX = 0;
    let oscillationPhaseY = 0;
    let oscillationPhaseZ = 0;
    let oscillationAmplitudeScale = 1.0;
    let targetOscAmplitude = 1.0;

    let windAxes = null;
    let allVehicleMeshes = [];
    let dynamicHeatMaterials = new Map();
    let cachedWindwardVertices = [];

    // ================================================================
    // BOW SHOCK SYSTEM
    // ================================================================
    let shieldCenter = new THREE.Vector3();
    let shieldNormal = new THREE.Vector3(-1, 0, 0);
    let maxShieldRadius = 2.0;

    let smoothedShieldCenter = new THREE.Vector3();
    let smoothedShieldNormal = new THREE.Vector3(-1, 0, 0);
    let smoothedRadius = 2.0;

    const THETA_SEGMENTS = 48;
    const PHI_SEGMENTS = 24;

    const SHOCK_PARAMS = {
        apollo: {
            standoffDistance: 0.30,
            spillFactor: 0.20,
            curvature: 0.85,
            trailingLength: 0.4
        },
        dreamchaser: {
            standoffDistance: 0.04,
            spillFactor: 0.35,
            curvature: 0.3,
            trailingLength: 0.8
        },
        x37b: {
            standoffDistance: 0.04,
            spillFactor: 0.35,
            curvature: 0.3,
            trailingLength: 0.8
        },
        stardust: {
            standoffDistance: 0.25,
            spillFactor: 0.20,
            curvature: 0.85,
            trailingLength: 0.4
        },
        mercury: {
            standoffDistance: 0.30,
            spillFactor: 0.20,
            curvature: 0.85,
            trailingLength: 0.4
        },
        schoolbus: {
            standoffDistance: 0.08,
            spillFactor: 0.25,
            curvature: 0.4,
            trailingLength: 0.6
        },
        shuttle: {
            standoffDistance: 0.05,
            spillFactor: 0.30,
            curvature: 0.35,
            trailingLength: 0.7
        }
    };

    let shockHalo = null;
    let shockHaloMaterial = null;
    let shockHaloGeometry = null;

    // ================================================================
    // L/D RATIO MAPPING
    // ================================================================
    let currentLDValue = 0.40;
    let lastLoadedVehicle = -1;

    function getVehicleFromLD(ldValue) {
        if (ldValue < 0.05) return 6;  // School Bus
        if (ldValue < 0.175) return 4; // Stardust
        if (ldValue < 0.30) return 5;  // Mercury
        if (ldValue < 0.525) return 1; // Apollo
        if (ldValue < 0.75) return 2;  // Dream Chaser
        if (ldValue < 0.925) return 3; // X-37B
        return 7; // Shuttle
    }

    function getVehicleNameFromLD(ldValue) {
        if (ldValue < 0.05) return 'School Bus';
        if (ldValue < 0.175) return 'Stardust SRC';
        if (ldValue < 0.30) return 'Mercury';
        if (ldValue < 0.525) return 'Apollo CM';
        if (ldValue < 0.75) return 'Dream Chaser';
        if (ldValue < 0.925) return 'X-37B';
        return 'Shuttle Orbiter';
    }

    // ================================================================
    // HELPER FUNCTIONS
    // ================================================================
    function getVehicleType() {
        if (!currentVehicleConfig) return 'apollo';
        const name = currentVehicleConfig.name.toLowerCase();
        if (name.includes('dream')) return 'dreamchaser';
        if (name.includes('x-37') || name.includes('x37')) return 'x37b';
        if (name.includes('stardust')) return 'stardust';
        if (name.includes('mercury')) return 'mercury';
        if (name.includes('bus') || name.includes('school')) return 'schoolbus';
        if (name.includes('shuttle') || name.includes('orbiter')) return 'shuttle';
        return 'apollo';
    }

    function smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    function getHeatColor(flux) {
        const c = new THREE.Color();
        if (flux < 400) c.lerpColors(COLOR_COLD, COLOR_DARK_RED, flux / 400);
        else if (flux < 1000) c.lerpColors(COLOR_DARK_RED, COLOR_RED, (flux - 400) / 600);
        else if (flux < 1800) c.lerpColors(COLOR_RED, COLOR_ORANGE, (flux - 1000) / 800);
        else if (flux < 2600) c.lerpColors(COLOR_ORANGE, COLOR_YELLOW, (flux - 1800) / 800);
        else c.lerpColors(COLOR_YELLOW, COLOR_WHITE, Math.min((flux - 2600) / 1400, 1));
        return c;
    }

    // ================================================================
    // HEAT SHIELD VERTEX EXTRACTION
    // ================================================================
    function extractHeatShieldVerticesWorld(mesh) {
        const geometry = mesh.geometry;
        const positions = geometry.attributes.position;
        const vertexCount = positions.count;

        mesh.updateWorldMatrix(true, false);
        const worldMatrix = mesh.matrixWorld;

        const worldVerts = [];
        for (let i = 0; i < vertexCount; i++) {
            const v = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            v.applyMatrix4(worldMatrix);
            worldVerts.push(v);
        }

        return worldVerts;
    }

    function computeShieldPlane(worldVerts, velocityVector) {
        shieldCenter.set(0, 0, 0);
        for (const v of worldVerts) {
            shieldCenter.add(v);
        }
        shieldCenter.divideScalar(worldVerts.length);

        let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
        for (const v of worldVerts) {
            const dx = v.x - shieldCenter.x;
            const dy = v.y - shieldCenter.y;
            const dz = v.z - shieldCenter.z;
            xx += dx * dx;
            xy += dx * dy;
            xz += dx * dz;
            yy += dy * dy;
            yz += dy * dz;
            zz += dz * dz;
        }

        const det_x = yy * zz - yz * yz;
        const det_y = xx * zz - xz * xz;
        const det_z = xx * yy - xy * xy;

        const dir1 = new THREE.Vector3(det_x, xy * zz - yz * xz, xy * yz - yy * xz);
        const dir2 = new THREE.Vector3(xz * yz - xy * zz, det_y, xy * xz - xx * yz);
        const dir3 = new THREE.Vector3(xy * yz - xz * yy, xy * xz - xx * yz, det_z);

        const mag1 = dir1.lengthSq();
        const mag2 = dir2.lengthSq();
        const mag3 = dir3.lengthSq();

        if (mag1 >= mag2 && mag1 >= mag3) {
            shieldNormal.copy(dir1);
        } else if (mag2 >= mag1 && mag2 >= mag3) {
            shieldNormal.copy(dir2);
        } else {
            shieldNormal.copy(dir3);
        }

        if (shieldNormal.lengthSq() > 0.0001) {
            shieldNormal.normalize();
        } else {
            shieldNormal.set(1, 0, 0);
        }

        if (shieldNormal.dot(velocityVector) > 0) {
            shieldNormal.negate();
        }

        if (shieldNormal.x > 0) {
            shieldNormal.negate();
        }
    }

    function computeShieldRadialProfile(worldVerts) {
        maxShieldRadius = 0;

        const up = Math.abs(shieldNormal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const localTangentU = new THREE.Vector3().crossVectors(shieldNormal, up).normalize();
        const localTangentV = new THREE.Vector3().crossVectors(shieldNormal, localTangentU).normalize();

        for (const v of worldVerts) {
            const toVertex = new THREE.Vector3().subVectors(v, shieldCenter);
            const u = toVertex.dot(localTangentU);
            const w = toVertex.dot(localTangentV);
            const r = Math.sqrt(u * u + w * w);

            if (r > maxShieldRadius) {
                maxShieldRadius = r;
            }
        }

        return maxShieldRadius;
    }

    // ================================================================
    // CONFORMAL SHOCK GEOMETRY
    // ================================================================
    function generateConformalShockGeometry(vehicleType, params) {
        const mesh = heatShieldMeshes[0];
        if (!mesh || !mesh.geometry) return null;

        const geometry = mesh.geometry;
        const posAttr = geometry.attributes.position;
        const normalAttr = geometry.attributes.normal;
        const indexAttr = geometry.index;

        if (!posAttr) return null;

        mesh.updateMatrixWorld(true);
        const worldMatrix = mesh.matrixWorld;
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);

        const standoffDistance = params.standoffDistance || 0.05;

        const vertices = [];
        const normals = [];
        const uvs = [];

        for (let i = 0; i < posAttr.count; i++) {
            const localPos = new THREE.Vector3(
                posAttr.getX(i),
                posAttr.getY(i),
                posAttr.getZ(i)
            );

            const worldPos = localPos.applyMatrix4(worldMatrix);

            let worldNormal = new THREE.Vector3(1, 0, 0);
            if (normalAttr) {
                const localNormal = new THREE.Vector3(
                    normalAttr.getX(i),
                    normalAttr.getY(i),
                    normalAttr.getZ(i)
                );
                worldNormal = localNormal.applyMatrix3(normalMatrix).normalize();
            }

            worldPos.x += worldNormal.x * standoffDistance;
            worldPos.y += worldNormal.y * standoffDistance;
            worldPos.z += worldNormal.z * standoffDistance;

            vertices.push(worldPos.x, worldPos.y, worldPos.z);
            normals.push(worldNormal.x, worldNormal.y, worldNormal.z);

            const uvAttr = geometry.attributes.uv;
            if (uvAttr) {
                uvs.push(uvAttr.getX(i), uvAttr.getY(i));
            } else {
                uvs.push(i / posAttr.count, 0.5);
            }
        }

        const indices = [];
        if (indexAttr) {
            for (let i = 0; i < indexAttr.count; i++) {
                indices.push(indexAttr.getX(i));
            }
        } else {
            for (let i = 0; i < posAttr.count; i++) {
                indices.push(i);
            }
        }

        return {
            vertices: new Float32Array(vertices),
            normals: new Float32Array(normals),
            uvs: new Float32Array(uvs),
            indices: indices.length > 65535
                ? new Uint32Array(indices)
                : new Uint16Array(indices)
        };
    }

    // ================================================================
    // WINDWARD SHOCK GEOMETRY (for tumbling objects)
    // ================================================================
    function generateWindwardShockGeometry(params) {
        if (allVehicleMeshes.length === 0) return null;

        const velocityDir = new THREE.Vector3(1, 0, 0);
        const standoffDistance = 0.05;
        const spillStrength = 0.08;

        const vertices = [];
        const normals = [];
        const uvs = [];
        const indices = [];

        const tempPos = new THREE.Vector3();
        const tempNormal = new THREE.Vector3();
        const faceNormal = new THREE.Vector3();
        const v0 = new THREE.Vector3();
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        const n0 = new THREE.Vector3();
        const n1 = new THREE.Vector3();
        const n2 = new THREE.Vector3();
        const edge1 = new THREE.Vector3();
        const edge2 = new THREE.Vector3();

        let vertexIndex = 0;
        let centerX = 0, centerY = 0, centerZ = 0;
        let vertCount = 0;

        allVehicleMeshes.forEach(mesh => {
            if (!mesh.geometry) return;

            const posAttr = mesh.geometry.attributes.position;
            const normAttr = mesh.geometry.attributes.normal;
            const indexAttr = mesh.geometry.index;
            if (!posAttr) return;

            mesh.updateMatrixWorld(true);
            const worldMatrix = mesh.matrixWorld;
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);

            const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

            for (let tri = 0; tri < triCount; tri++) {
                let i0, i1, i2;
                if (indexAttr) {
                    i0 = indexAttr.getX(tri * 3);
                    i1 = indexAttr.getX(tri * 3 + 1);
                    i2 = indexAttr.getX(tri * 3 + 2);
                } else {
                    i0 = tri * 3;
                    i1 = tri * 3 + 1;
                    i2 = tri * 3 + 2;
                }

                v0.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0)).applyMatrix4(worldMatrix);
                v1.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1)).applyMatrix4(worldMatrix);
                v2.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2)).applyMatrix4(worldMatrix);

                edge1.subVectors(v1, v0);
                edge2.subVectors(v2, v0);
                faceNormal.crossVectors(edge1, edge2).normalize();

                const windwardDot = faceNormal.dot(velocityDir);
                if (windwardDot < 0.05) continue;

                if (normAttr) {
                    n0.set(normAttr.getX(i0), normAttr.getY(i0), normAttr.getZ(i0)).applyMatrix3(normalMatrix).normalize();
                    n1.set(normAttr.getX(i1), normAttr.getY(i1), normAttr.getZ(i1)).applyMatrix3(normalMatrix).normalize();
                    n2.set(normAttr.getX(i2), normAttr.getY(i2), normAttr.getZ(i2)).applyMatrix3(normalMatrix).normalize();
                } else {
                    n0.copy(faceNormal);
                    n1.copy(faceNormal);
                    n2.copy(faceNormal);
                }

                const offset0 = standoffDistance + spillStrength * (1 - n0.dot(velocityDir));
                const offset1 = standoffDistance + spillStrength * (1 - n1.dot(velocityDir));
                const offset2 = standoffDistance + spillStrength * (1 - n2.dot(velocityDir));

                vertices.push(v0.x + offset0, v0.y, v0.z);
                vertices.push(v1.x + offset1, v1.y, v1.z);
                vertices.push(v2.x + offset2, v2.y, v2.z);

                normals.push(n0.x, n0.y, n0.z);
                normals.push(n1.x, n1.y, n1.z);
                normals.push(n2.x, n2.y, n2.z);

                uvs.push(windwardDot, 0.5);
                uvs.push(windwardDot, 0.5);
                uvs.push(windwardDot, 0.5);

                indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
                vertexIndex += 3;

                centerX += (v0.x + v1.x + v2.x) / 3;
                centerY += (v0.y + v1.y + v2.y) / 3;
                centerZ += (v0.z + v1.z + v2.z) / 3;
                vertCount++;
            }
        });

        if (vertCount > 0) {
            smoothedShieldCenter.set(centerX / vertCount, centerY / vertCount, centerZ / vertCount);
            smoothedShieldNormal.set(1, 0, 0);
        }

        if (vertices.length === 0) return null;

        return {
            vertices: new Float32Array(vertices),
            normals: new Float32Array(normals),
            uvs: new Float32Array(uvs),
            indices: indices.length > 65535
                ? new Uint32Array(indices)
                : new Uint16Array(indices)
        };
    }

    // ================================================================
    // PARAMETRIC SHOCK SURFACE GEOMETRY
    // ================================================================
    function generateShockSurfaceGeometry(vehicleType) {
        const params = SHOCK_PARAMS[vehicleType] || SHOCK_PARAMS.apollo;
        const R = smoothedRadius;

        if (vehicleType === 'schoolbus' && allVehicleMeshes.length > 0) {
            return generateWindwardShockGeometry(params);
        }

        if ((vehicleType === 'dreamchaser' || vehicleType === 'x37b' || vehicleType === 'shuttle') && heatShieldMeshes.length > 0) {
            return generateConformalShockGeometry(vehicleType, params);
        }

        // Parametric dome shock for capsules
        const shockAxis = smoothedShieldNormal.clone().negate();
        shockAxis.y = -shockAxis.y;

        const up = Math.abs(shockAxis.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const tangentU = new THREE.Vector3().crossVectors(shockAxis, up).normalize();
        const tangentV = new THREE.Vector3().crossVectors(shockAxis, tangentU).normalize();

        const shockStandoffDistance = R * 0.1;
        const shockCenterOffset = new THREE.Vector3(
            shockStandoffDistance,
            -shockStandoffDistance * 0.3,
            0
        );
        const shockCenter = smoothedShieldCenter.clone().add(shockCenterOffset);

        const standoff = R * params.standoffDistance;
        const spill = R * params.spillFactor;
        const trailing = standoff * params.trailingLength;

        const vertices = [];
        const normals = [];
        const uvs = [];

        for (let j = 0; j <= PHI_SEGMENTS; j++) {
            const phi = j / PHI_SEGMENTS;

            const rimExpansion = 1.15;
            const radialDist = R * rimExpansion * Math.sin(phi * Math.PI * 0.5);
            const forwardOffset = standoff * Math.cos(phi * Math.PI * 0.5);
            const spillOffset = spill * Math.pow(phi, 2);

            for (let i = 0; i <= THETA_SEGMENTS; i++) {
                const theta = (i / THETA_SEGMENTS) * Math.PI * 2;

                const u = Math.cos(theta) * radialDist;
                const w = Math.sin(theta) * radialDist;

                const pos = new THREE.Vector3();
                pos.copy(shockCenter);
                pos.addScaledVector(tangentU, u);
                pos.addScaledVector(tangentV, w);
                pos.addScaledVector(shockAxis, forwardOffset);
                pos.addScaledVector(shockAxis, -spillOffset);

                vertices.push(pos.x, pos.y, pos.z);

                const normalDir = new THREE.Vector3();
                normalDir.copy(shockAxis).multiplyScalar(1 - phi * 0.5);
                normalDir.addScaledVector(tangentU, Math.cos(theta) * phi * 0.5);
                normalDir.addScaledVector(tangentV, Math.sin(theta) * phi * 0.5);
                normalDir.normalize();

                normals.push(normalDir.x, normalDir.y, normalDir.z);
                uvs.push(i / THETA_SEGMENTS, phi);
            }
        }

        const indices = [];
        for (let j = 0; j < PHI_SEGMENTS; j++) {
            for (let i = 0; i < THETA_SEGMENTS; i++) {
                const a = j * (THETA_SEGMENTS + 1) + i;
                const b = a + THETA_SEGMENTS + 1;
                const c = a + 1;
                const d = b + 1;

                indices.push(a, b, c);
                indices.push(c, b, d);
            }
        }

        if (trailing > 0) {
            const baseRingStart = PHI_SEGMENTS * (THETA_SEGMENTS + 1);
            const trailStart = vertices.length / 3;

            for (let i = 0; i <= THETA_SEGMENTS; i++) {
                const theta = (i / THETA_SEGMENTS) * Math.PI * 2;

                const rimIdx = baseRingStart + i;
                const rimX = vertices[rimIdx * 3];
                const rimY = vertices[rimIdx * 3 + 1];
                const rimZ = vertices[rimIdx * 3 + 2];

                const trailPos = new THREE.Vector3(rimX, rimY, rimZ);
                trailPos.addScaledVector(shockAxis, trailing);

                vertices.push(trailPos.x, trailPos.y, trailPos.z);

                const trailNormal = new THREE.Vector3();
                trailNormal.addScaledVector(tangentU, Math.cos(theta));
                trailNormal.addScaledVector(tangentV, Math.sin(theta));
                trailNormal.normalize();
                normals.push(trailNormal.x, trailNormal.y, trailNormal.z);

                uvs.push(i / THETA_SEGMENTS, 1.2);
            }

            for (let i = 0; i < THETA_SEGMENTS; i++) {
                const rimA = baseRingStart + i;
                const rimB = rimA + 1;
                const trailA = trailStart + i;
                const trailB = trailA + 1;

                indices.push(rimA, trailA, rimB);
                indices.push(rimB, trailA, trailB);
            }
        }

        return {
            vertices: new Float32Array(vertices),
            normals: new Float32Array(normals),
            uvs: new Float32Array(uvs),
            indices: new Uint16Array(indices)
        };
    }

    // ================================================================
    // BOW SHOCK MATERIAL
    // ================================================================
    function createBowShockMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                intensity: { value: 0 },
                energyLevel: { value: 0 },
                noiseScale: { value: 3.0 },
                shieldCenter: { value: new THREE.Vector3() },
                shieldNormal: { value: new THREE.Vector3(-1, 0, 0) },
                shieldRadius: { value: 2.0 },
                flowSpeed: { value: 11.0 }  // 11 km/s hypersonic
            },
            vertexShader: `
                uniform vec3 shieldCenter;
                uniform vec3 shieldNormal;
                uniform float shieldRadius;
                uniform float time;
                uniform float energyLevel;

                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying vec3 vWorldPosition;
                varying vec3 vOriginalPosition;
                varying float vApexFactor;
                varying float vEdgeFactor;
                varying vec2 vUv;

                // Fast hash for vertex displacement
                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                // FBM for multi-scale turbulence
                float fbm(vec3 p) {
                    float value = 0.0;
                    float amplitude = 0.5;
                    for (int i = 0; i < 4; i++) {
                        value += amplitude * noise(p);
                        p *= 2.0;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                void main() {
                    vUv = uv;
                    vOriginalPosition = position;

                    // =====================================================
                    // 1. ANIMATED VERTEX DISPLACEMENT - Hypersonic ripples
                    // =====================================================
                    vec3 displacedPos = position;

                    // Only displace if there's heat
                    if (energyLevel > 0.05) {
                        // Hypersonic flow speed - extremely fast downstream motion
                        float flowTime = time * 15.0;  // Very fast flow

                        // Multiple wave frequencies for turbulent appearance
                        vec3 noiseCoord = position * 0.3 + vec3(flowTime * 0.5, flowTime * 0.3, flowTime * 0.4);

                        // Displacement along normal - rippling surface
                        float ripple = fbm(noiseCoord) * 2.0 - 1.0;

                        // Add high-frequency flutter
                        float flutter = sin(position.x * 8.0 + time * 40.0) *
                                      cos(position.y * 6.0 + time * 35.0) * 0.3;

                        // Displacement strength based on edge factor and energy
                        float edgeFactor = uv.y;
                        float displacementStrength = energyLevel * 0.15 * (0.3 + edgeFactor * 0.7);

                        // Apply displacement along normal
                        displacedPos += normal * (ripple + flutter) * displacementStrength * shieldRadius;
                    }

                    vec4 worldPos = modelMatrix * vec4(displacedPos, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vNormal = normalize(normalMatrix * normal);

                    // Compute factors for shading
                    vec3 toVertex = worldPos.xyz - shieldCenter;
                    float forwardDist = dot(toVertex, shieldNormal);
                    vApexFactor = clamp(forwardDist / (shieldRadius * 0.5), 0.0, 1.0);
                    vEdgeFactor = uv.y;

                    vec4 mvPosition = modelViewMatrix * vec4(displacedPos, 1.0);
                    vViewPosition = -mvPosition.xyz;

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float intensity;
                uniform float energyLevel;
                uniform float noiseScale;
                uniform float flowSpeed;

                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying vec3 vWorldPosition;
                varying vec3 vOriginalPosition;
                varying float vApexFactor;
                varying float vEdgeFactor;
                varying vec2 vUv;

                // =====================================================
                // NOISE FUNCTIONS FOR HYPERSONIC TURBULENCE
                // =====================================================
                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                // 2. ENHANCED FLOWING NOISE - Multi-octave FBM
                float fbm(vec3 p, int octaves) {
                    float value = 0.0;
                    float amplitude = 0.5;
                    float frequency = 1.0;
                    for (int i = 0; i < 6; i++) {
                        if (i >= octaves) break;
                        value += amplitude * noise(p * frequency);
                        frequency *= 2.0;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                // Advected noise - flows downstream rapidly
                float flowingNoise(vec3 p, float flowTime) {
                    // Primary flow direction (downstream)
                    vec3 flow1 = p + vec3(flowTime * 2.0, flowTime * 0.3, flowTime * 0.5);
                    // Secondary turbulent flow
                    vec3 flow2 = p + vec3(flowTime * 1.5, -flowTime * 0.5, flowTime * 0.8);
                    // Combine for turbulent advection
                    return fbm(flow1, 4) * 0.6 + fbm(flow2 * 1.5, 3) * 0.4;
                }

                void main() {
                    // Hypersonic time scales - everything moves FAST
                    float hyperTime = time * flowSpeed;

                    // =====================================================
                    // 5. EDGE FLICKERING/PULSING - Animated Fresnel
                    // =====================================================
                    vec3 viewDir = normalize(vViewPosition);
                    float baseFresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.5);

                    // Rapid edge flickering - plasma instability
                    float flicker = sin(time * 60.0 + vOriginalPosition.x * 10.0) * 0.5 + 0.5;
                    float flicker2 = sin(time * 45.0 + vOriginalPosition.y * 8.0) * 0.5 + 0.5;
                    float flickerMix = flicker * flicker2;

                    // Pulsing fresnel with high-frequency variation
                    float pulseFreq = sin(time * 25.0) * 0.3 + 0.7;
                    float fresnel = baseFresnel * (0.7 + flickerMix * 0.6) * pulseFreq;

                    // Apex fade
                    float apexFade = smoothstep(1.2, 0.0, vEdgeFactor);

                    // =====================================================
                    // 2. ENHANCED FLOWING NOISE - Hypersonic turbulence
                    // =====================================================
                    vec3 noisePos = vWorldPosition * noiseScale * 0.5;

                    // Multi-layer flowing turbulence at hypersonic speeds
                    float turb1 = flowingNoise(noisePos, hyperTime * 0.8);
                    float turb2 = flowingNoise(noisePos * 2.0, hyperTime * 1.2);
                    float turb3 = flowingNoise(noisePos * 4.0, hyperTime * 1.8);

                    // Combine turbulence layers
                    float turbulence = turb1 * 0.5 + turb2 * 0.3 + turb3 * 0.2;

                    // High-frequency shimmer for that "roaring plasma" look
                    float shimmer = turbulence * 0.4 + 0.8;
                    shimmer += sin(hyperTime * 3.0 + vUv.x * 20.0) * 0.1;

                    // =====================================================
                    // PHYSICALLY-INSPIRED INTENSITY GROWTH MODEL
                    // =====================================================
                    float H_norm = clamp(energyLevel, 0.0, 1.0);
                    float GrowthExponent = 1.2;
                    float GrowthValue = pow(H_norm, GrowthExponent);
                    float SaturationSteepness = 8.0;
                    float SaturationCenter = 0.25;
                    float SaturationValue = 1.0 / (1.0 + exp(-SaturationSteepness * (GrowthValue - SaturationCenter)));
                    float earlyGlow = H_norm * 0.15;
                    float FinalIntensity = clamp(max(SaturationValue, earlyGlow), 0.0, 1.0);

                    // =====================================================
                    // COLOR EVOLUTION with turbulence variation
                    // =====================================================
                    vec3 color0 = vec3(0.45, 0.45, 0.45);
                    vec3 color1 = vec3(0.52, 0.48, 0.48);
                    vec3 color2 = vec3(0.72, 0.52, 0.58);
                    vec3 color3 = vec3(0.88, 0.48, 0.68);
                    vec3 color4 = vec3(0.88, 0.38, 0.88);
                    vec3 color5 = vec3(0.88, 0.32, 0.98);
                    vec3 color6 = vec3(0.95, 0.40, 1.00);

                    // Add turbulence to color selection for swirling effect
                    float colorIntensity = FinalIntensity + (turbulence - 0.5) * 0.15 * FinalIntensity;
                    colorIntensity = clamp(colorIntensity, 0.0, 1.0);

                    vec3 PlasmaColor;
                    if (colorIntensity < 0.15) {
                        PlasmaColor = mix(color0, color1, colorIntensity / 0.15);
                    } else if (colorIntensity < 0.30) {
                        PlasmaColor = mix(color1, color2, (colorIntensity - 0.15) / 0.15);
                    } else if (colorIntensity < 0.50) {
                        PlasmaColor = mix(color2, color3, (colorIntensity - 0.30) / 0.20);
                    } else if (colorIntensity < 0.70) {
                        PlasmaColor = mix(color3, color4, (colorIntensity - 0.50) / 0.20);
                    } else if (colorIntensity < 0.85) {
                        PlasmaColor = mix(color4, color5, (colorIntensity - 0.70) / 0.15);
                    } else {
                        PlasmaColor = mix(color5, color6, (colorIntensity - 0.85) / 0.15);
                    }

                    // =====================================================
                    // 4. LAYERED SURFACES - Simulated depth layers
                    // =====================================================
                    // Create illusion of multiple plasma layers at different depths
                    float layer1 = flowingNoise(noisePos * 1.0, hyperTime * 0.6);
                    float layer2 = flowingNoise(noisePos * 1.5 + vec3(0.5), hyperTime * 0.9);
                    float layer3 = flowingNoise(noisePos * 2.0 + vec3(1.0), hyperTime * 1.2);

                    // Each layer has different opacity and color shift
                    float layerMix = layer1 * 0.4 + layer2 * 0.35 + layer3 * 0.25;

                    // Depth-based color variation (deeper = more violet)
                    vec3 depthColor = mix(PlasmaColor, color5, layerMix * 0.3 * FinalIntensity);

                    // =====================================================
                    // EMISSIVE BOOST with flickering
                    // =====================================================
                    float EmissiveStrength = pow(FinalIntensity, 1.2);
                    // Add rapid emissive flicker
                    EmissiveStrength *= (0.85 + flickerMix * 0.3);

                    // Apply all effects
                    vec3 shockColor = depthColor * shimmer * (1.0 + EmissiveStrength * 0.6);

                    // =====================================================
                    // FINAL ALPHA with layer depth
                    // =====================================================
                    float surfaceAlpha = 0.3 * FinalIntensity;
                    float edgeAlpha = fresnel * 0.6 * FinalIntensity;

                    // Layer-based alpha variation for depth
                    float layerAlpha = (0.8 + layerMix * 0.4);

                    float alpha = (surfaceAlpha + edgeAlpha) * apexFade * layerAlpha;

                    // Minimum alpha threshold with flicker
                    float alphaThreshold = 0.01 + flickerMix * 0.005;
                    if (alpha < alphaThreshold) discard;

                    gl_FragColor = vec4(shockColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });
    }

    // ================================================================
    // BOW SHOCK CREATION AND UPDATE
    // ================================================================
    function createShockHalo() {
        // Create initial geometry (will be rebuilt each frame)
        shockHaloGeometry = new THREE.BufferGeometry();

        // Create material
        shockHaloMaterial = createBowShockMaterial();

        shockHalo = new THREE.Mesh(shockHaloGeometry, shockHaloMaterial);
        shockHalo.visible = false;
        shockHalo.frustumCulled = false;
        scene.add(shockHalo);
    }

    function rebuildBowShockGeometry(vehicleType) {
        const surfaceData = generateShockSurfaceGeometry(vehicleType);

        // Handle null return (no valid geometry)
        if (!surfaceData || !surfaceData.vertices || surfaceData.vertices.length === 0) {
            return;
        }

        // Dispose old geometry buffers
        if (shockHaloGeometry) {
            shockHaloGeometry.dispose();
        }

        shockHaloGeometry = new THREE.BufferGeometry();

        shockHaloGeometry.setAttribute('position',
            new THREE.BufferAttribute(surfaceData.vertices, 3));
        shockHaloGeometry.setAttribute('normal',
            new THREE.BufferAttribute(surfaceData.normals, 3));
        shockHaloGeometry.setAttribute('uv',
            new THREE.BufferAttribute(surfaceData.uvs, 2));
        shockHaloGeometry.setIndex(
            new THREE.BufferAttribute(surfaceData.indices, 1));

        // Recompute normals for smooth shading
        shockHaloGeometry.computeVertexNormals();

        // Update mesh reference
        shockHalo.geometry = shockHaloGeometry;
    }

    function updateShockHalo(flux, dt) {
        if (!shockHalo || !shockHaloMaterial) return;

        const energyLevel = Math.max(0, (flux - 300) / (PEAK_HEAT_FLUX - 300));

        shockHalo.visible = flux > 300;

        const hasMeshes = heatShieldMeshes.length > 0 || allVehicleMeshes.length > 0;

        if (shockHalo.visible && hasMeshes) {
            shockHaloMaterial.uniforms.time.value += dt;
            shockHaloMaterial.uniforms.intensity.value = 0.6 + energyLevel * 0.7;
            shockHaloMaterial.uniforms.energyLevel.value = energyLevel;

            const velocityVector = new THREE.Vector3(1, 0, 0);
            const vehicleType = getVehicleType();

            if (vehicleType === 'schoolbus' && allVehicleMeshes.length > 0) {
                if (smoothedShieldCenter.lengthSq() < 0.001) {
                    if (currentVehicle) {
                        const box = new THREE.Box3().setFromObject(currentVehicle);
                        box.getCenter(smoothedShieldCenter);
                        smoothedRadius = box.getSize(new THREE.Vector3()).length() / 2;
                    }
                }
            } else if (heatShieldMeshes.length > 0) {
                const worldVerts = extractHeatShieldVerticesWorld(heatShieldMeshes[0]);
                cachedWorldVerts = worldVerts;

                computeShieldPlane(worldVerts, velocityVector);
                computeShieldRadialProfile(worldVerts);
            }

            if (smoothedShieldCenter.lengthSq() < 0.001) {
                smoothedShieldCenter.copy(shieldCenter);
                smoothedShieldNormal.copy(shieldNormal);
                smoothedRadius = maxShieldRadius;
            } else {
                const smoothingFactor = 1.0 - Math.exp(-8.0 * dt);
                smoothedShieldCenter.lerp(shieldCenter, smoothingFactor);
                smoothedShieldNormal.lerp(shieldNormal, smoothingFactor).normalize();
                smoothedRadius += (maxShieldRadius - smoothedRadius) * smoothingFactor;
            }

            rebuildBowShockGeometry(vehicleType);

            shockHaloMaterial.uniforms.shieldCenter.value.copy(smoothedShieldCenter);
            shockHaloMaterial.uniforms.shieldNormal.value.copy(smoothedShieldNormal);
            shockHaloMaterial.uniforms.shieldRadius.value = smoothedRadius;
        }
    }

    // Initialize bow shock
    createShockHalo();

    // ================================================================
    // PLASMA PARTICLE SYSTEM
    // ================================================================
    class PlasmaParticle {
        constructor() {
            this.position = new THREE.Vector3();
            this.velocity = new THREE.Vector3();
            this.initialVelocity = new THREE.Vector3();
            this.age = 0;
            this.maxAge = 0;
            this.color = new THREE.Color();
            this.spawnColor = new THREE.Color();
            this.baseSize = 0;
            this.currentSize = 0;
            this.alpha = 0;
            this.brightness = 1.0;
            this.stretch = 1.0;
            this.active = false;
            this.noisePhase = 0;
        }

        reset(position, velocity, maxAge, color, baseSize) {
            this.position.copy(position);
            this.velocity.copy(velocity);
            this.initialVelocity.copy(velocity);
            this.age = 0;
            this.maxAge = maxAge;
            this.color.copy(color);
            this.spawnColor.copy(color);
            this.baseSize = baseSize;
            this.currentSize = baseSize;
            this.alpha = 0;
            this.brightness = 8.0;
            this.stretch = 3.0;
            this.active = true;
            this.noisePhase = Math.random() * 100;
        }

        update(dt) {
            this.age += dt;
            if (this.age >= this.maxAge) {
                this.active = false;
                return;
            }

            const t = this.age / this.maxAge;

            const decayRate = 2.5;
            const velocityFactor = Math.exp(-decayRate * t);
            this.velocity.copy(this.initialVelocity).multiplyScalar(velocityFactor);

            this.noisePhase += dt * 2.0;
            const noiseAmp = smoothstep(0.3, 0.7, t) * 0.8;
            const noiseY = Math.sin(this.noisePhase * 1.7) * noiseAmp * dt;
            const noiseZ = Math.cos(this.noisePhase * 1.1) * noiseAmp * dt;
            this.position.y += noiseY;
            this.position.z += noiseZ;

            this.position.addScaledVector(this.velocity, dt);

            if (t < 0.20) {
                this.brightness = 8.0;
            } else if (t < 0.50) {
                const stageT = (t - 0.20) / 0.30;
                this.brightness = 8.0 - stageT * 5.5;
            } else if (t < 0.80) {
                const stageT = (t - 0.50) / 0.30;
                this.brightness = 2.5 - stageT * 1.5;
            } else {
                this.brightness = 1.0;
            }

            if (t < 0.15) {
                this.color.setRGB(1.0, 0.95, 0.8);
            } else if (t < 0.30) {
                const ct = (t - 0.15) / 0.15;
                this.color.lerpColors(new THREE.Color(1.0, 0.95, 0.8), PLASMA_PINK, ct);
            } else if (t < 0.45) {
                const ct = (t - 0.30) / 0.15;
                this.color.copy(PLASMA_PINK).lerp(PLASMA_VIOLET, ct);
            } else if (t < 0.60) {
                const ct = (t - 0.45) / 0.15;
                this.color.copy(PLASMA_VIOLET).lerp(PLASMA_BLUE, ct);
            } else if (t < 0.80) {
                const ct = (t - 0.60) / 0.20;
                this.color.copy(PLASMA_BLUE).lerp(new THREE.Color(0.25, 0.25, 0.35), ct);
            } else {
                this.color.setRGB(0.2, 0.2, 0.25);
            }

            if (t < 0.08) {
                this.alpha = (t / 0.08) * 0.98;
            } else if (t < 0.60) {
                this.alpha = 0.98;
            } else {
                const fadeT = (t - 0.60) / 0.40;
                this.alpha = 0.98 * Math.exp(-2.5 * fadeT);
            }

            if (t < 0.20) {
                this.stretch = 3.0;
            } else if (t < 0.50) {
                const st = (t - 0.20) / 0.30;
                this.stretch = 3.0 - st * 1.2;
            } else {
                const st = (t - 0.50) / 0.50;
                this.stretch = 1.8 - st * 0.6;
            }

            this.currentSize = this.baseSize * (1.0 + t * 1.5);

            if (this.alpha < 0.01) this.active = false;
        }
    }

    class PlasmaEmitter {
        constructor(maxParticles = 3000) {
            this.maxParticles = maxParticles;
            this.particles = [];
            this.accumulator = 0;

            for (let i = 0; i < maxParticles; i++) {
                this.particles.push(new PlasmaParticle());
            }

            this.createGeometry();
        }

        createGeometry() {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(this.maxParticles * 3);
            const colors = new Float32Array(this.maxParticles * 3);
            const sizes = new Float32Array(this.maxParticles);
            const alphas = new Float32Array(this.maxParticles);
            const stretches = new Float32Array(this.maxParticles);

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
            geometry.setAttribute('stretch', new THREE.BufferAttribute(stretches, 1));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    pointTexture: { value: this.createPlasmaTexture() }
                },
                vertexShader: `
                    attribute float size;
                    attribute float alpha;
                    attribute float stretch;
                    attribute vec3 color;

                    varying vec3 vColor;
                    varying float vAlpha;
                    varying float vStretch;

                    void main() {
                        vColor = color;
                        vAlpha = alpha;
                        vStretch = stretch;

                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = size * stretch * (320.0 / -mvPosition.z);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D pointTexture;
                    varying vec3 vColor;
                    varying float vAlpha;
                    varying float vStretch;

                    void main() {
                        vec2 uv = gl_PointCoord;
                        uv.x = (uv.x - 0.5) / max(vStretch * 0.4, 0.4) + 0.5;
                        if (uv.x < 0.0 || uv.x > 1.0) discard;

                        vec4 tex = texture2D(pointTexture, uv);
                        gl_FragColor = vec4(vColor, vAlpha * tex.a);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: true
            });

            this.mesh = new THREE.Points(geometry, material);
            scene.add(this.mesh);
        }

        createPlasmaTexture() {
            const canvas = document.createElement('canvas');
            const size = 128;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
            gradient.addColorStop(0.1, 'rgba(255, 255, 255, 0.95)');
            gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
            gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);

            return new THREE.CanvasTexture(canvas);
        }

        emit(flux) {
            const hasDynamicHeating = currentVehicleConfig && currentVehicleConfig.dynamicHeatShield;
            const hasSpawnPoints = heatShieldVertices.length > 0 ||
                (hasDynamicHeating && cachedWindwardVertices.length > 0);

            if (flux < 800 || !hasSpawnPoints) return;

            let particle = null;
            for (let i = 0; i < this.maxParticles; i++) {
                if (!this.particles[i].active) {
                    particle = this.particles[i];
                    break;
                }
            }
            if (!particle) return;

            let spawnPos;
            if (hasDynamicHeating && cachedWindwardVertices.length > 0) {
                const windwardVert = cachedWindwardVertices[
                    Math.floor(Math.random() * cachedWindwardVertices.length)
                ];
                spawnPos = windwardVert.position.clone();
            } else {
                const vertexLocal = heatShieldVertices[
                    Math.floor(Math.random() * heatShieldVertices.length)
                ].clone();
                if (heatShieldMeshes.length > 0) {
                    vertexLocal.applyMatrix4(heatShieldMeshes[0].matrixWorld);
                }
                spawnPos = vertexLocal;
            }

            spawnPos.x += (Math.random() - 0.5) * 0.05;
            spawnPos.y += (Math.random() - 0.5) * 0.05;
            spawnPos.z += (Math.random() - 0.5) * 0.05;

            const speed = 35 + Math.random() * 15;
            const velocity = new THREE.Vector3(
                -speed,
                (Math.random() - 0.5) * 0.3,
                (Math.random() - 0.5) * 0.3
            );

            const baseSize = 0.3 + Math.random() * 0.15;
            const maxAge = (1.5 + Math.random() * 1.0) * trailLengthMultiplier;

            particle.reset(spawnPos, velocity, maxAge, cachedHeatShieldColor, baseSize);
        }

        update(dt, flux) {
            let spawnRate = 0;
            if (flux >= 800) {
                const normalized = (flux - 800) / (PEAK_HEAT_FLUX - 800);
                spawnRate = 100 + normalized * 400;
            }

            this.accumulator += spawnRate * dt;
            while (this.accumulator >= 1) {
                this.emit(flux);
                this.accumulator -= 1;
            }

            let activeCount = 0;
            for (let i = 0; i < this.maxParticles; i++) {
                if (this.particles[i].active) {
                    this.particles[i].update(dt);
                    activeCount++;
                }
            }

            this.updateBuffers();
            return activeCount;
        }

        updateBuffers() {
            const geo = this.mesh.geometry;
            const positions = geo.attributes.position.array;
            const colors = geo.attributes.color.array;
            const sizes = geo.attributes.size.array;
            const alphas = geo.attributes.alpha.array;
            const stretches = geo.attributes.stretch.array;

            let idx = 0;
            for (let i = 0; i < this.maxParticles; i++) {
                const p = this.particles[i];
                if (p.active) {
                    positions[idx * 3] = p.position.x;
                    positions[idx * 3 + 1] = p.position.y;
                    positions[idx * 3 + 2] = p.position.z;

                    colors[idx * 3] = p.color.r * p.brightness;
                    colors[idx * 3 + 1] = p.color.g * p.brightness;
                    colors[idx * 3 + 2] = p.color.b * p.brightness;

                    sizes[idx] = p.currentSize;
                    alphas[idx] = p.alpha;
                    stretches[idx] = p.stretch;
                    idx++;
                }
            }

            for (let i = idx; i < this.maxParticles; i++) {
                sizes[i] = 0;
                alphas[i] = 0;
            }

            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
            geo.attributes.size.needsUpdate = true;
            geo.attributes.alpha.needsUpdate = true;
            geo.attributes.stretch.needsUpdate = true;
        }

        clear() {
            for (let i = 0; i < this.maxParticles; i++) {
                this.particles[i].active = false;
            }
            this.updateBuffers();
        }

        dispose() {
            scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }

    const plasmaEmitter = new PlasmaEmitter(3000);

    // ================================================================
    // SOOT/SMOKE PARTICLE SYSTEM
    // ================================================================
    class SootParticle {
        constructor() {
            this.position = new THREE.Vector3();
            this.velocity = new THREE.Vector3();
            this.initialVelocity = new THREE.Vector3();
            this.age = 0;
            this.maxAge = 0;
            this.color = new THREE.Color();
            this.spawnColor = new THREE.Color();
            this.baseSize = 0;
            this.currentSize = 0;
            this.alpha = 0;
            this.active = false;
            this.noisePhase = 0;
        }

        reset(position, velocity, maxAge, color, baseSize) {
            this.position.copy(position);
            this.velocity.copy(velocity);
            this.initialVelocity.copy(velocity);
            this.age = 0;
            this.maxAge = maxAge;
            this.color.copy(color);
            this.spawnColor.copy(color);
            this.baseSize = baseSize;
            this.currentSize = baseSize;
            this.alpha = 0;
            this.active = true;
            this.noisePhase = Math.random() * 100;
        }

        update(dt) {
            this.age += dt;
            if (this.age >= this.maxAge) {
                this.active = false;
                return;
            }

            const t = this.age / this.maxAge;

            const decayRate = 1.8;
            const velocityFactor = Math.exp(-decayRate * t);
            this.velocity.copy(this.initialVelocity).multiplyScalar(velocityFactor);

            this.noisePhase += dt * 1.5;
            const noiseAmp = smoothstep(0.2, 0.6, t) * 1.2;
            const noiseY = Math.sin(this.noisePhase * 1.3) * noiseAmp * dt;
            const noiseZ = Math.cos(this.noisePhase * 0.9) * noiseAmp * dt;
            this.position.y += noiseY;
            this.position.z += noiseZ;

            this.position.addScaledVector(this.velocity, dt);

            if (t < 0.15) {
                const ct = t / 0.15;
                this.color.copy(this.spawnColor).lerp(SOOT_BURNT_ORANGE, ct);
            } else if (t < 0.35) {
                const ct = (t - 0.15) / 0.20;
                this.color.copy(SOOT_BURNT_ORANGE).lerp(SOOT_BROWN, ct);
            } else if (t < 0.60) {
                const ct = (t - 0.35) / 0.25;
                this.color.copy(SOOT_BROWN).lerp(SOOT_DARK_GREY, ct);
            } else {
                const ct = (t - 0.60) / 0.40;
                this.color.copy(SOOT_DARK_GREY).lerp(SMOKE_GREY, ct * 0.5);
            }

            if (t < 0.10) {
                this.alpha = (t / 0.10) * 0.7;
            } else if (t < 0.50) {
                this.alpha = 0.7;
            } else {
                const fadeT = (t - 0.50) / 0.50;
                this.alpha = 0.7 * Math.exp(-2.0 * fadeT);
            }

            this.currentSize = this.baseSize * (1.0 + t * 2.5);

            if (this.alpha < 0.01) this.active = false;
        }
    }

    class SootEmitter {
        constructor(maxParticles = 5000) {
            this.maxParticles = maxParticles;
            this.particles = [];
            this.accumulator = 0;

            for (let i = 0; i < maxParticles; i++) {
                this.particles.push(new SootParticle());
            }

            this.createGeometry();
        }

        createGeometry() {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(this.maxParticles * 3);
            const colors = new Float32Array(this.maxParticles * 3);
            const sizes = new Float32Array(this.maxParticles);
            const alphas = new Float32Array(this.maxParticles);

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    pointTexture: { value: this.createSootTexture() }
                },
                vertexShader: `
                    attribute float size;
                    attribute float alpha;
                    attribute vec3 color;

                    varying vec3 vColor;
                    varying float vAlpha;

                    void main() {
                        vColor = color;
                        vAlpha = alpha;

                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = size * (280.0 / -mvPosition.z);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D pointTexture;
                    varying vec3 vColor;
                    varying float vAlpha;

                    void main() {
                        vec4 tex = texture2D(pointTexture, gl_PointCoord);
                        gl_FragColor = vec4(vColor, vAlpha * tex.a);
                    }
                `,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                depthTest: true
            });

            this.mesh = new THREE.Points(geometry, material);
            scene.add(this.mesh);
        }

        createSootTexture() {
            const canvas = document.createElement('canvas');
            const size = 64;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
            gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);

            return new THREE.CanvasTexture(canvas);
        }

        emit(flux) {
            const hasDynamicHeating = currentVehicleConfig && currentVehicleConfig.dynamicHeatShield;
            const hasSpawnPoints = heatShieldVertices.length > 0 ||
                (hasDynamicHeating && cachedWindwardVertices.length > 0);

            if (flux < SPAWN_HEAT_THRESHOLD || !hasSpawnPoints) return;

            let particle = null;
            for (let i = 0; i < this.maxParticles; i++) {
                if (!this.particles[i].active) {
                    particle = this.particles[i];
                    break;
                }
            }
            if (!particle) return;

            let spawnPos;
            if (hasDynamicHeating && cachedWindwardVertices.length > 0) {
                const windwardVert = cachedWindwardVertices[
                    Math.floor(Math.random() * cachedWindwardVertices.length)
                ];
                spawnPos = windwardVert.position.clone();
            } else {
                const vertexLocal = heatShieldVertices[
                    Math.floor(Math.random() * heatShieldVertices.length)
                ].clone();
                if (heatShieldMeshes.length > 0) {
                    vertexLocal.applyMatrix4(heatShieldMeshes[0].matrixWorld);
                }
                spawnPos = vertexLocal;
            }

            spawnPos.x += (Math.random() - 0.5) * 0.1;
            spawnPos.y += (Math.random() - 0.5) * 0.1;
            spawnPos.z += (Math.random() - 0.5) * 0.1;

            const speed = 15 + Math.random() * 10;
            const velocity = new THREE.Vector3(
                -speed,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            );

            const baseSize = 0.4 + Math.random() * 0.2;
            const maxAge = (2.5 + Math.random() * 1.5) * trailLengthMultiplier;

            particle.reset(spawnPos, velocity, maxAge, cachedHeatShieldColor, baseSize);
        }

        update(dt, flux) {
            let spawnRate = 0;
            if (flux >= SPAWN_HEAT_THRESHOLD) {
                const normalized = (flux - SPAWN_HEAT_THRESHOLD) / (PEAK_HEAT_FLUX - SPAWN_HEAT_THRESHOLD);
                spawnRate = 50 + normalized * 200;
            }

            this.accumulator += spawnRate * dt;
            while (this.accumulator >= 1) {
                this.emit(flux);
                this.accumulator -= 1;
            }

            let activeCount = 0;
            for (let i = 0; i < this.maxParticles; i++) {
                if (this.particles[i].active) {
                    this.particles[i].update(dt);
                    activeCount++;
                }
            }

            this.updateBuffers();
            return activeCount;
        }

        updateBuffers() {
            const geo = this.mesh.geometry;
            const positions = geo.attributes.position.array;
            const colors = geo.attributes.color.array;
            const sizes = geo.attributes.size.array;
            const alphas = geo.attributes.alpha.array;

            let idx = 0;
            for (let i = 0; i < this.maxParticles; i++) {
                const p = this.particles[i];
                if (p.active) {
                    positions[idx * 3] = p.position.x;
                    positions[idx * 3 + 1] = p.position.y;
                    positions[idx * 3 + 2] = p.position.z;

                    colors[idx * 3] = p.color.r;
                    colors[idx * 3 + 1] = p.color.g;
                    colors[idx * 3 + 2] = p.color.b;

                    sizes[idx] = p.currentSize;
                    alphas[idx] = p.alpha;
                    idx++;
                }
            }

            for (let i = idx; i < this.maxParticles; i++) {
                sizes[i] = 0;
                alphas[i] = 0;
            }

            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
            geo.attributes.size.needsUpdate = true;
            geo.attributes.alpha.needsUpdate = true;
        }

        clear() {
            for (let i = 0; i < this.maxParticles; i++) {
                this.particles[i].active = false;
            }
            this.updateBuffers();
        }

        dispose() {
            scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }

    const sootEmitter = new SootEmitter(5000);

    // ================================================================
    // HEAT SHIELD MATERIAL
    // ================================================================
    let heatShieldTime = 0;

    function createHeatShieldMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                heatFlux: { value: 0 },
                maxHeatFlux: { value: 4000.0 },
                baseColor: { value: new THREE.Color(0x2a2a2a) },
                charColor: { value: new THREE.Color(0x1a1a1a) },
                emberColor: { value: new THREE.Color(0xff4400) },
                glowColor: { value: new THREE.Color(0xff2200) },
                ambientLight: { value: new THREE.Color(0x404040) },
                lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
                lightColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying vec2 vUv;
                varying vec3 vViewDir;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vUv = uv;

                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewDir = -mvPosition.xyz;

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float heatFlux;
                uniform float maxHeatFlux;
                uniform vec3 baseColor;
                uniform vec3 charColor;
                uniform vec3 emberColor;
                uniform vec3 glowColor;
                uniform vec3 ambientLight;
                uniform vec3 lightDir;
                uniform vec3 lightColor;

                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying vec2 vUv;
                varying vec3 vViewDir;

                // Noise functions for procedural patterns
                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                // FBM for multi-scale char patterns
                float fbm(vec3 p) {
                    float value = 0.0;
                    float amplitude = 0.5;
                    for (int i = 0; i < 5; i++) {
                        value += amplitude * noise(p);
                        p *= 2.0;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                // Cellular/Voronoi-like pattern for char cracks
                float cellPattern(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    float minDist = 1.0;
                    for (int x = -1; x <= 1; x++) {
                        for (int y = -1; y <= 1; y++) {
                            for (int z = -1; z <= 1; z++) {
                                vec3 neighbor = vec3(float(x), float(y), float(z));
                                vec3 point = neighbor + hash(i + neighbor) - f;
                                float dist = length(point);
                                minDist = min(minDist, dist);
                            }
                        }
                    }
                    return minDist;
                }

                void main() {
                    float heatLevel = clamp(heatFlux / maxHeatFlux, 0.0, 1.0);

                    // =====================================================
                    // 3. PROCEDURAL CHAR PATTERNS
                    // =====================================================
                    vec3 noiseCoord = vWorldPosition * 0.15;

                    // Multi-scale char pattern
                    float charPattern = fbm(noiseCoord * 2.0);

                    // Add cellular cracks at higher heat
                    float cracks = cellPattern(noiseCoord * 3.0);
                    float crackIntensity = smoothstep(0.0, 0.15, cracks);

                    // Streaky ablation pattern (flowing downstream in X direction)
                    float streaks = fbm(vec3(noiseCoord.x * 0.5, noiseCoord.y * 2.0, noiseCoord.z * 2.0));

                    // Combine patterns
                    float combinedPattern = charPattern * 0.6 + streaks * 0.4;

                    // =====================================================
                    // 1. PROGRESSIVE COLOR DARKENING (Light Application)
                    // =====================================================
                    float charAmount = heatLevel * 0.3 * combinedPattern;
                    charAmount = clamp(charAmount, 0.0, 0.4);

                    vec3 surfaceColor = mix(baseColor, charColor, charAmount);

                    // =====================================================
                    // 2. GLOWING EMBERS THROUGH CHAR
                    // =====================================================
                    float emberThreshold = 0.3;
                    float emberStrength = smoothstep(emberThreshold, 0.8, heatLevel);

                    float emberPattern = (1.0 - crackIntensity) * combinedPattern;
                    emberPattern += noise(noiseCoord * 8.0 + time * 2.0) * 0.3;

                    float pulse = sin(time * 8.0 + vWorldPosition.x * 3.0) * 0.15 + 0.85;
                    float emberGlow = emberStrength * emberPattern * pulse;
                    emberGlow = clamp(emberGlow, 0.0, 1.0);

                    vec3 emberFinal = mix(glowColor, emberColor, emberGlow * 0.5);

                    // =====================================================
                    // 3. INTENSE THERMAL RADIATION (white-hot at peak)
                    // =====================================================
                    float thermalStart = 0.05;
                    float thermalIntensity = smoothstep(thermalStart, 1.0, heatLevel);

                    float earlyGlow = sqrt(thermalIntensity) * 1.5;
                    float peakGlow = pow(thermalIntensity, 2.0) * 4.0;
                    float intensityCurve = earlyGlow + peakGlow;

                    // Define thermal color stages (blackbody-inspired)
                    vec3 dullRed = vec3(0.5, 0.08, 0.03);
                    vec3 cherryRed = vec3(0.85, 0.18, 0.06);
                    vec3 brightOrange = vec3(1.0, 0.45, 0.12);
                    vec3 yellowHot = vec3(1.0, 0.78, 0.35);
                    vec3 whiteHot = vec3(1.0, 0.95, 0.88);

                    // 5-stage color progression
                    vec3 thermalColor;
                    if (heatLevel < 0.12) {
                        float t = smoothstep(thermalStart, 0.12, heatLevel);
                        thermalColor = mix(dullRed * 0.5, dullRed, t);
                    } else if (heatLevel < 0.30) {
                        float t = (heatLevel - 0.12) / 0.18;
                        thermalColor = mix(dullRed, cherryRed, t);
                    } else if (heatLevel < 0.50) {
                        float t = (heatLevel - 0.30) / 0.20;
                        thermalColor = mix(cherryRed, brightOrange, t);
                    } else if (heatLevel < 0.70) {
                        float t = (heatLevel - 0.50) / 0.20;
                        thermalColor = mix(brightOrange, yellowHot, t);
                    } else {
                        float t = (heatLevel - 0.70) / 0.30;
                        thermalColor = mix(yellowHot, whiteHot, t);
                    }

                    float peakBoost = smoothstep(0.7, 1.0, heatLevel) * 4.0;
                    float totalIntensity = intensityCurve * (1.0 + peakBoost);

                    // =====================================================
                    // CHAR MODULATION OF THERMAL GLOW
                    // =====================================================
                    float peakCharBoost = smoothstep(0.7, 1.0, heatLevel);
                    float charDepth = 0.3 + peakCharBoost * 0.7;

                    float charModulation = 1.0 - (combinedPattern * charDepth * 1.5);

                    float darkPatches = fbm(noiseCoord * 1.2 + 0.5);
                    float darkStreaks = fbm(vec3(noiseCoord.x * 0.3, noiseCoord.y * 2.5, noiseCoord.z * 2.5));
                    float combinedDark = max(darkPatches, darkStreaks) * peakCharBoost * 0.6;
                    charModulation -= combinedDark;

                    float crackGlow = (1.0 - crackIntensity) * peakCharBoost * 0.5;
                    charModulation += crackGlow;

                    charModulation = clamp(charModulation, 0.1, 1.4);

                    float flicker = 1.0;
                    if (heatLevel > 0.5) {
                        flicker = 0.92 + noise(noiseCoord * 5.0 + time * 15.0) * 0.16;
                    }

                    // =====================================================
                    // BASIC LIGHTING
                    // =====================================================
                    vec3 normal = normalize(vNormal);
                    float diffuse = max(dot(normal, lightDir), 0.0);

                    float lightFade = 1.0 - smoothstep(0.3, 0.8, heatLevel);
                    vec3 litColor = surfaceColor * (ambientLight + lightColor * diffuse * 0.6) * lightFade;

                    // =====================================================
                    // COMBINE: Surface + Ember Glow + Thermal Radiation
                    // =====================================================
                    vec3 finalColor = litColor;

                    float emberContrib = emberGlow * (1.0 - smoothstep(0.6, 0.9, heatLevel));
                    finalColor += emberFinal * emberContrib * 1.5;

                    finalColor += thermalColor * totalIntensity * flicker;

                    if (heatLevel > 0.8) {
                        float bloom = (heatLevel - 0.8) / 0.2;
                        finalColor += vec3(1.0, 0.98, 0.95) * bloom * bloom * 2.0;
                    }

                    // =====================================================
                    // OVERLAY CHAR PATTERNS ON TOP (subtractive)
                    // =====================================================
                    float peakCharOverlay = smoothstep(0.5, 0.9, heatLevel);

                    float charOverlay = combinedPattern * 0.7 + darkPatches * 0.6;
                    float largeSplotches = fbm(noiseCoord * 0.6) * 0.6;
                    charOverlay += largeSplotches;

                    float ablationStreaks = fbm(vec3(noiseCoord.x * 0.15, noiseCoord.y * 4.0, noiseCoord.z * 4.0));
                    charOverlay += ablationStreaks * 0.5;

                    float deepCracks = (1.0 - crackIntensity) * 0.4;
                    charOverlay += deepCracks;

                    float brightness = (finalColor.r + finalColor.g + finalColor.b) / 3.0;
                    float darkenAmount = charOverlay * peakCharOverlay * min(brightness * 0.6, 1.2);

                    float peakBoostChar = smoothstep(0.85, 1.0, heatLevel) * 0.4;
                    darkenAmount *= (1.0 + peakBoostChar);

                    vec3 charDarkening = vec3(darkenAmount * 1.0, darkenAmount * 0.9, darkenAmount * 0.75);
                    finalColor -= charDarkening;

                    finalColor = max(finalColor, vec3(0.0));

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            lights: false
        });
    }

    // ================================================================
    // DYNAMIC HEATING (for tumbling vehicles)
    // ================================================================
    function createDynamicHeatMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                heatFlux: { value: 0 },
                maxHeatFlux: { value: 4000.0 },
                velocityDir: { value: new THREE.Vector3(1, 0, 0) },
                baseColor: { value: new THREE.Color(0xccaa00) },  // School bus yellow
                charColor: { value: new THREE.Color(0x1a1a1a) },
                ambientLight: { value: new THREE.Color(0x404040) },
                lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
                lightColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;
                varying vec2 vUv;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vUv = uv;

                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float heatFlux;
                uniform float maxHeatFlux;
                uniform vec3 velocityDir;
                uniform vec3 baseColor;
                uniform vec3 charColor;
                uniform vec3 ambientLight;
                uniform vec3 lightDir;
                uniform vec3 lightColor;

                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;
                varying vec2 vUv;

                // Noise functions
                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                float fbm(vec3 p) {
                    float value = 0.0;
                    float amplitude = 0.5;
                    for (int i = 0; i < 4; i++) {
                        value += amplitude * noise(p);
                        p *= 2.0;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                void main() {
                    float heatLevel = clamp(heatFlux / maxHeatFlux, 0.0, 1.0);

                    // Calculate windward factor
                    float windwardDot = dot(vWorldNormal, velocityDir);
                    float windwardFactor = clamp(windwardDot, 0.0, 1.0);

                    // Stagnation point heating
                    float stagnationFactor = pow(windwardFactor, 1.5);

                    // Effective heat level for this surface
                    float surfaceHeat = heatLevel * stagnationFactor;

                    // Thermal color progression
                    vec3 dullRed = vec3(0.5, 0.08, 0.03);
                    vec3 cherryRed = vec3(0.85, 0.18, 0.06);
                    vec3 brightOrange = vec3(1.0, 0.45, 0.12);
                    vec3 yellowHot = vec3(1.0, 0.78, 0.35);
                    vec3 whiteHot = vec3(1.0, 0.95, 0.88);

                    vec3 thermalColor;
                    float thermalStart = 0.05;

                    if (surfaceHeat < 0.12) {
                        float t = smoothstep(thermalStart, 0.12, surfaceHeat);
                        thermalColor = mix(dullRed * 0.5, dullRed, t);
                    } else if (surfaceHeat < 0.30) {
                        float t = (surfaceHeat - 0.12) / 0.18;
                        thermalColor = mix(dullRed, cherryRed, t);
                    } else if (surfaceHeat < 0.50) {
                        float t = (surfaceHeat - 0.30) / 0.20;
                        thermalColor = mix(cherryRed, brightOrange, t);
                    } else if (surfaceHeat < 0.70) {
                        float t = (surfaceHeat - 0.50) / 0.20;
                        thermalColor = mix(brightOrange, yellowHot, t);
                    } else {
                        float t = (surfaceHeat - 0.70) / 0.30;
                        thermalColor = mix(yellowHot, whiteHot, t);
                    }

                    // Intensity calculation
                    float thermalIntensity = smoothstep(thermalStart, 1.0, surfaceHeat);
                    float earlyGlow = sqrt(thermalIntensity) * 1.5;
                    float peakGlow = pow(thermalIntensity, 2.0) * 4.0;
                    float totalIntensity = earlyGlow + peakGlow;

                    // Charring effect on heated surfaces
                    vec3 noiseCoord = vWorldPosition * 0.1;
                    float charPattern = fbm(noiseCoord * 2.0);
                    float charAmount = surfaceHeat * 0.5 * charPattern;
                    charAmount = clamp(charAmount, 0.0, 0.6);

                    // Base surface color with charring
                    vec3 surfaceColor = mix(baseColor, charColor, charAmount);

                    // Basic lighting
                    vec3 normal = normalize(vNormal);
                    float diffuse = max(dot(normal, lightDir), 0.0);
                    float lightFade = 1.0 - smoothstep(0.2, 0.7, surfaceHeat);
                    vec3 litColor = surfaceColor * (ambientLight + lightColor * diffuse * 0.6) * lightFade;

                    // Add thermal glow
                    vec3 finalColor = litColor;
                    if (surfaceHeat > thermalStart) {
                        // Flickering
                        float flicker = 0.92 + noise(noiseCoord * 5.0 + time * 15.0) * 0.16;
                        finalColor += thermalColor * totalIntensity * flicker;

                        // Bloom at high heat
                        if (surfaceHeat > 0.7) {
                            float bloom = (surfaceHeat - 0.7) / 0.3;
                            finalColor += vec3(1.0, 0.98, 0.95) * bloom * bloom * 1.5;
                        }
                    }

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            lights: false
        });
    }

    function setupDynamicHeating() {
        if (!currentVehicle || !currentVehicleConfig || !currentVehicleConfig.dynamicHeatShield) return;

        allVehicleMeshes = [];
        dynamicHeatMaterials.clear();

        // Find all meshes in the vehicle
        currentVehicle.traverse((child) => {
            if (child.isMesh && child.geometry) {
                allVehicleMeshes.push(child);

                // Store original material
                if (!originalMaterials.has(child)) {
                    originalMaterials.set(child, child.material.clone());
                }

                // Create dynamic heat material for this mesh
                const heatMat = createDynamicHeatMaterial();

                // Try to preserve original base color
                const origMat = originalMaterials.get(child);
                if (origMat && origMat.color) {
                    heatMat.uniforms.baseColor.value.copy(origMat.color);
                }

                dynamicHeatMaterials.set(child, heatMat);
                child.material = heatMat;
            }
        });

        // For dynamic heat shields, use all meshes as "heat shield" for bow shock generation
        heatShieldMeshes = allVehicleMeshes;
    }

    function updateDynamicHeating(flux, dt) {
        cachedWindwardVertices = [];

        const velocityDir = new THREE.Vector3(1, 0, 0);

        dynamicHeatMaterials.forEach((material, mesh) => {
            material.uniforms.time.value += dt;
            material.uniforms.heatFlux.value = flux;
            material.uniforms.velocityDir.value.copy(velocityDir);

            if (flux > SPAWN_HEAT_THRESHOLD && mesh.geometry) {
                const posAttr = mesh.geometry.attributes.position;
                const normAttr = mesh.geometry.attributes.normal;

                if (posAttr && normAttr) {
                    mesh.updateMatrixWorld(true);
                    const worldMatrix = mesh.matrixWorld;
                    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);

                    for (let i = 0; i < posAttr.count; i += 3) {
                        const localNormal = new THREE.Vector3(
                            normAttr.getX(i),
                            normAttr.getY(i),
                            normAttr.getZ(i)
                        );
                        const worldNormal = localNormal.applyMatrix3(normalMatrix).normalize();

                        const windwardFactor = Math.max(worldNormal.dot(velocityDir), 0);

                        if (windwardFactor > 0.3) {
                            const localPos = new THREE.Vector3(
                                posAttr.getX(i),
                                posAttr.getY(i),
                                posAttr.getZ(i)
                            );
                            const worldPos = localPos.applyMatrix4(worldMatrix);

                            cachedWindwardVertices.push({
                                position: worldPos,
                                normal: worldNormal,
                                windward: windwardFactor
                            });
                        }
                    }
                }
            }
        });

        if (cachedWindwardVertices.length > 0 && flux > SPAWN_HEAT_THRESHOLD) {
            cachedHeatShieldColor.copy(getHeatColor(flux));
        }
    }

    // ================================================================
    // HEAT SHIELD UPDATE
    // ================================================================
    function updateHeatShield(flux, dt = 0) {
        // Update shader time
        if (dt) heatShieldTime += dt;

        const color = getHeatColor(flux);
        const intensity = flux < 200 ? 0 : Math.pow(flux / PEAK_HEAT_FLUX, 1.2) * 3;

        heatShieldMeshes.forEach(mesh => {
            // Update shader uniforms if using custom shader
            if (mesh.material.uniforms) {
                mesh.material.uniforms.time.value = heatShieldTime;
                mesh.material.uniforms.heatFlux.value = flux;
            }
            // Fallback for standard materials
            else if (mesh.material.emissive) {
                mesh.material.emissive.copy(color);
                mesh.material.emissiveIntensity = intensity;

                if (flux > 1500) {
                    mesh.material.emissiveIntensity *= 1 + (Math.random() - 0.5) * 0.15;
                }
            }
        });

        // Cache the heat shield color for particle emission
        cachedHeatShieldColor.copy(color);

        // Update heat glow light
        heatLight.color.copy(color);
        heatLight.intensity = intensity * 0.5;
    }

    // ================================================================
    // TUMBLING SYSTEM
    // ================================================================
    function initTumbleState() {
        tumbleCurrentQuat.set(0, 0, 0, 1);
        tumbleTargetQuat.set(0, 0, 0, 1);
        tumbleAngularVelocity = 0;
        tumbleTargetVelocity = 0.5 + Math.random() * 0.5;

        tumbleAxis.set(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();

        oscillationFreqX = 0.8 + Math.random() * 0.4;
        oscillationFreqY = 0.6 + Math.random() * 0.3;
        oscillationFreqZ = 0.7 + Math.random() * 0.35;

        oscillationAmpX = 0.03 + Math.random() * 0.02;
        oscillationAmpY = 0.025 + Math.random() * 0.015;
        oscillationAmpZ = 0.02 + Math.random() * 0.01;

        oscillationPhaseX = Math.random() * Math.PI * 2;
        oscillationPhaseY = Math.random() * Math.PI * 2;
        oscillationPhaseZ = Math.random() * Math.PI * 2;

        phaseTimer = 0;
        phaseDuration = 3 + Math.random() * 4;
        isResting = false;
    }

    function updateTumble(dt) {
        if (!currentVehicle || !currentVehicleConfig || !currentVehicleConfig.isTumbling) return;

        phaseTimer += dt;

        if (phaseTimer >= phaseDuration) {
            phaseTimer = 0;
            isResting = !isResting;

            if (isResting) {
                phaseDuration = 2 + Math.random() * 3;
                tumbleTargetVelocity = 0;
                targetOscAmplitude = 1.5;
            } else {
                phaseDuration = 3 + Math.random() * 4;

                tumbleAxis.set(
                    Math.random() - 0.5,
                    Math.random() - 0.5,
                    Math.random() - 0.5
                ).normalize();

                tumbleTargetVelocity = 0.3 + Math.random() * 0.7;
                targetOscAmplitude = 0.3;
            }
        }

        const velocityLerp = isResting ? 2.0 : 1.5;
        tumbleAngularVelocity += (tumbleTargetVelocity - tumbleAngularVelocity) * velocityLerp * dt;

        const ampLerp = 1.0;
        oscillationAmplitudeScale += (targetOscAmplitude - oscillationAmplitudeScale) * ampLerp * dt;

        if (tumbleAngularVelocity > 0.01) {
            const angle = tumbleAngularVelocity * dt;
            const rotQuat = new THREE.Quaternion();
            rotQuat.setFromAxisAngle(tumbleAxis, angle);
            tumbleCurrentQuat.premultiply(rotQuat);
            tumbleCurrentQuat.normalize();
        }

        oscillationTime += dt;
        const oscX = Math.sin(oscillationTime * oscillationFreqX + oscillationPhaseX) * oscillationAmpX * oscillationAmplitudeScale;
        const oscY = Math.sin(oscillationTime * oscillationFreqY + oscillationPhaseY) * oscillationAmpY * oscillationAmplitudeScale;
        const oscZ = Math.sin(oscillationTime * oscillationFreqZ + oscillationPhaseZ) * oscillationAmpZ * oscillationAmplitudeScale;

        const oscillationQuat = new THREE.Quaternion();
        oscillationQuat.setFromEuler(new THREE.Euler(oscX, oscY, oscZ));

        const finalQuat = tumbleCurrentQuat.clone();
        finalQuat.multiply(oscillationQuat);

        currentVehicle.quaternion.copy(finalQuat);

        // Sync body axes rotation with vehicle (axes are in scene, not parented to vehicle)
        if (bodyAxes) {
            bodyAxes.quaternion.copy(finalQuat);
        }
    }

    // ================================================================
    // DEBRIS SHEDDING SYSTEM (School Bus Only)
    // ================================================================
    // As heat flux increases, pieces of the bus break off and fly in -X direction
    // Progressive structural failure from small paint flakes to large chunks
    // Marks damage on bus surface where pieces "tear off"

    const debrisState = {
        active: [],                    // Active debris objects
        spawnTimer: 0,                 // Time accumulator for spawning
        nextSpawnInterval: 2.0,        // Time until next spawn
        maxDebris: 150,                // Performance cap
        busMeshes: [],                 // Cached bus mesh references for sampling
        initialized: false,
        // Damage tracking
        totalDamage: 0,                // 0-1, percentage of bus damaged
        maxDamage: 0.70,               // Cap at 70% damage - only 30% of bus remains
        vertexDamage: new Map(),       // Map of mesh -> Float32Array of per-vertex damage
        originalColors: new Map(),     // Map of mesh -> original vertex colors
        damageRadius: 0.5              // World units - radius of damage around spawn point
    };

    // Debris timing parameters
    const DEBRIS_MIN_INTERVAL = 0.3;   // Seconds between spawns at max heat
    const DEBRIS_MAX_INTERVAL = 1.2;   // Seconds between spawns at lower heat

    // Debris size parameters
    const DEBRIS_MIN_SCALE = 1.0;      // Large panel pieces
    const DEBRIS_MAX_SCALE = 4.0;      // Massive structural chunks (entire sections)

    // Debris velocity parameters
    const DEBRIS_MIN_VELOCITY = 0.5;   // m/s at low heat (slow drift)
    const DEBRIS_MAX_VELOCITY = 8.0;   // m/s at high heat (visible separation)

    // Debris lifetime parameters
    const DEBRIS_MIN_LIFETIME = 8.0;   // Seconds at high heat
    const DEBRIS_MAX_LIFETIME = 20.0;  // Seconds at low heat (stay visible longer)

    // Damage colors (burnt/scorched progression)
    const DAMAGE_COLOR_LIGHT = new THREE.Color(0x8B4513);  // Saddle brown (light burn)
    const DAMAGE_COLOR_MEDIUM = new THREE.Color(0x3D2314); // Dark brown (medium burn)
    const DAMAGE_COLOR_HEAVY = new THREE.Color(0x1a1a1a);  // Near black (heavy char)

    // ================================================================
    // BREAKAWAY PIECES SYSTEM (slices bus into detachable chunks)
    // ================================================================
    const breakawayState = {
        pieces: [],           // Array of {mesh, isCore, hasDetached, velocity, angularVel}
        corePiece: null,      // The center piece that survives
        initialized: false,
        detachTimer: 0,
        nextDetachTime: 1.0,
        totalDetached: 0,
        maxDetachable: 0,     // Set when sliced
        heatAccumulator: 0    // Track heat exposure
    };

    const BREAKAWAY_CONFIG = {
        numSlices: 8,         // Radial slices (like pizza)
        numRings: 2,          // Concentric rings (core + outer)
        coreRadius: 0.35,     // 35% radius is the surviving core
        detachInterval: [0.8, 2.5], // Seconds between detachments at max/min heat
        detachVelocity: [1.0, 6.0], // m/s velocity range
        heatThreshold: 500    // kW/m² to start breaking
    };

    /**
     * Initialize debris system when school bus is loaded
     */
    function initDebrisSystem() {
        // Clear any existing debris
        debrisState.active.forEach(d => {
            if (d.mesh) scene.remove(d.mesh);
            if (d.mesh && d.mesh.geometry) d.mesh.geometry.dispose();
            if (d.mesh && d.mesh.material) d.mesh.material.dispose();
        });
        debrisState.active = [];
        debrisState.spawnTimer = 0;
        debrisState.nextSpawnInterval = 0.1; // Start spawning quickly
        debrisState.busMeshes = [];
        debrisState.vertexDamage.clear();
        debrisState.originalColors.clear();
        debrisState.totalDamage = 0;
        debrisState.initialized = false;

        // Only initialize for school bus
        if (!currentVehicleConfig || currentVehicleConfig.name !== 'School Bus') {
            return;
        }

        // Cache meshes from the bus for vertex sampling and damage tracking
        if (currentVehicle) {
            currentVehicle.traverse((child) => {
                if (child.isMesh && child.geometry) {
                    debrisState.busMeshes.push(child);

                    const geometry = child.geometry;
                    const vertexCount = geometry.attributes.position.count;

                    // Initialize damage tracking array for this mesh
                    debrisState.vertexDamage.set(child, new Float32Array(vertexCount));

                    // Store original vertex positions for potential reset
                    debrisState.originalColors.set(child, geometry.attributes.position.array.slice());
                }
            });
        }

        debrisState.initialized = debrisState.busMeshes.length > 0;
        if (debrisState.initialized) {
            console.log('[Debris System] Initialized for School Bus with', debrisState.busMeshes.length, 'meshes');

            // Also initialize breakaway system
            initBreakawaySystem();
        }
    }

    /**
     * Initialize the breakaway pieces system - slices bus into detachable chunks
     */
    function initBreakawaySystem() {
        // Clear any existing pieces
        breakawayState.pieces.forEach(p => {
            if (p.mesh && p.mesh.parent) {
                p.mesh.parent.remove(p.mesh);
            }
        });
        breakawayState.pieces = [];
        breakawayState.corePiece = null;
        breakawayState.initialized = false;
        breakawayState.detachTimer = 0;
        breakawayState.nextDetachTime = 1.0;
        breakawayState.totalDetached = 0;
        breakawayState.heatAccumulator = 0;

        if (!currentVehicle || debrisState.busMeshes.length === 0) {
            return;
        }

        console.log('[Breakaway] Slicing bus into pieces...');

        // Calculate overall bounding box center
        const overallBox = new THREE.Box3().setFromObject(currentVehicle);
        const center = overallBox.getCenter(new THREE.Vector3());
        const size = overallBox.getSize(new THREE.Vector3());
        const maxRadius = Math.max(size.x, size.y, size.z) / 2;

        // For each mesh in the bus, create slice copies
        debrisState.busMeshes.forEach((originalMesh, meshIndex) => {
            const geometry = originalMesh.geometry;
            const positions = geometry.attributes.position;
            const indices = geometry.index ? geometry.index.array : null;

            if (!positions || positions.count < 3) return;

            // Get mesh's world transform
            originalMesh.updateMatrixWorld(true);
            const worldMatrix = originalMesh.matrixWorld.clone();

            // Group triangles by their slice region
            const numSlices = BREAKAWAY_CONFIG.numSlices;
            const sliceTriangles = {}; // sliceId -> array of triangle indices

            // Initialize slice buckets
            for (let s = 0; s < numSlices; s++) {
                sliceTriangles[`outer_${s}`] = [];
                sliceTriangles['core'] = [];
            }

            // Process each triangle
            const triCount = indices ? indices.length / 3 : positions.count / 3;

            for (let t = 0; t < triCount; t++) {
                // Get triangle vertex indices
                let i0, i1, i2;
                if (indices) {
                    i0 = indices[t * 3];
                    i1 = indices[t * 3 + 1];
                    i2 = indices[t * 3 + 2];
                } else {
                    i0 = t * 3;
                    i1 = t * 3 + 1;
                    i2 = t * 3 + 2;
                }

                // Get triangle centroid in world space
                const v0 = new THREE.Vector3(positions.getX(i0), positions.getY(i0), positions.getZ(i0));
                const v1 = new THREE.Vector3(positions.getX(i1), positions.getY(i1), positions.getZ(i1));
                const v2 = new THREE.Vector3(positions.getX(i2), positions.getY(i2), positions.getZ(i2));

                v0.applyMatrix4(worldMatrix);
                v1.applyMatrix4(worldMatrix);
                v2.applyMatrix4(worldMatrix);

                const centroid = new THREE.Vector3().addVectors(v0, v1).add(v2).divideScalar(3);

                // Calculate distance from center (in XZ plane for radial slices)
                const dx = centroid.x - center.x;
                const dz = centroid.z - center.z;
                const distFromCenter = Math.sqrt(dx * dx + dz * dz);
                const normalizedDist = distFromCenter / maxRadius;

                // Determine slice based on angle and distance
                const angle = Math.atan2(dz, dx) + Math.PI; // 0 to 2PI
                const sliceIndex = Math.floor((angle / (2 * Math.PI)) * numSlices) % numSlices;

                if (normalizedDist < BREAKAWAY_CONFIG.coreRadius) {
                    // Core piece - stays attached
                    sliceTriangles['core'].push(t);
                } else {
                    // Outer piece - can break away
                    sliceTriangles[`outer_${sliceIndex}`].push(t);
                }
            }

            // Create separate meshes for each slice with triangles
            Object.keys(sliceTriangles).forEach(sliceId => {
                const triangleList = sliceTriangles[sliceId];
                if (triangleList.length === 0) return;

                // Create new geometry with only these triangles
                const newPositions = [];
                const newNormals = [];
                const newUvs = [];

                const origNormals = geometry.attributes.normal;
                const origUvs = geometry.attributes.uv;

                triangleList.forEach(t => {
                    let i0, i1, i2;
                    if (indices) {
                        i0 = indices[t * 3];
                        i1 = indices[t * 3 + 1];
                        i2 = indices[t * 3 + 2];
                    } else {
                        i0 = t * 3;
                        i1 = t * 3 + 1;
                        i2 = t * 3 + 2;
                    }

                    // Add vertices
                    newPositions.push(positions.getX(i0), positions.getY(i0), positions.getZ(i0));
                    newPositions.push(positions.getX(i1), positions.getY(i1), positions.getZ(i1));
                    newPositions.push(positions.getX(i2), positions.getY(i2), positions.getZ(i2));

                    // Add normals
                    if (origNormals) {
                        newNormals.push(origNormals.getX(i0), origNormals.getY(i0), origNormals.getZ(i0));
                        newNormals.push(origNormals.getX(i1), origNormals.getY(i1), origNormals.getZ(i1));
                        newNormals.push(origNormals.getX(i2), origNormals.getY(i2), origNormals.getZ(i2));
                    }

                    // Add UVs
                    if (origUvs) {
                        newUvs.push(origUvs.getX(i0), origUvs.getY(i0));
                        newUvs.push(origUvs.getX(i1), origUvs.getY(i1));
                        newUvs.push(origUvs.getX(i2), origUvs.getY(i2));
                    }
                });

                // Create new geometry
                const newGeometry = new THREE.BufferGeometry();
                newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
                if (newNormals.length > 0) {
                    newGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
                } else {
                    newGeometry.computeVertexNormals();
                }
                if (newUvs.length > 0) {
                    newGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
                }

                // Clone material
                const newMaterial = originalMesh.material.clone();

                // Create mesh
                const pieceMesh = new THREE.Mesh(newGeometry, newMaterial);

                // Copy transform from original
                pieceMesh.position.copy(originalMesh.position);
                pieceMesh.rotation.copy(originalMesh.rotation);
                pieceMesh.scale.copy(originalMesh.scale);

                // Calculate piece center for physics
                newGeometry.computeBoundingBox();
                const pieceCenter = newGeometry.boundingBox.getCenter(new THREE.Vector3());
                pieceCenter.applyMatrix4(pieceMesh.matrixWorld);

                const isCore = sliceId === 'core';

                breakawayState.pieces.push({
                    mesh: pieceMesh,
                    isCore: isCore,
                    hasDetached: false,
                    center: pieceCenter,
                    velocity: new THREE.Vector3(),
                    angularVelocity: new THREE.Vector3(
                        randomRange(-2, 2),
                        randomRange(-2, 2),
                        randomRange(-2, 2)
                    ),
                    originalParent: currentVehicle,
                    sliceId: sliceId,
                    meshIndex: meshIndex
                });

                // Add to vehicle
                currentVehicle.add(pieceMesh);

                if (isCore) {
                    breakawayState.corePiece = pieceMesh;
                }
            });

            // Hide original mesh
            originalMesh.visible = false;
        });

        // Count detachable pieces
        breakawayState.maxDetachable = breakawayState.pieces.filter(p => !p.isCore).length;
        breakawayState.initialized = breakawayState.maxDetachable > 0;

        console.log(`[Breakaway] Created ${breakawayState.pieces.length} pieces (${breakawayState.maxDetachable} detachable, core preserved)`);
    }

    /**
     * Update breakaway system - detach pieces based on heat flux
     */
    function updateBreakaway(dt, simDt, heatFlux) {
        if (!breakawayState.initialized) return;

        // Only process if above heat threshold
        if (heatFlux < BREAKAWAY_CONFIG.heatThreshold) return;

        // Accumulate heat exposure
        breakawayState.heatAccumulator += heatFlux * simDt;

        // Update detach timer with simulation time
        breakawayState.detachTimer += simDt;

        // Normalized heat (0-1) for interpolation
        const normalizedHeat = clamp((heatFlux - BREAKAWAY_CONFIG.heatThreshold) / 3500, 0, 1);

        // Check if it's time to detach a piece
        if (breakawayState.detachTimer >= breakawayState.nextDetachTime) {
            // Find a piece to detach (random from remaining attached outer pieces)
            const attachedPieces = breakawayState.pieces.filter(p => !p.isCore && !p.hasDetached);

            if (attachedPieces.length > 0) {
                // Pick random piece
                const pieceToDetach = attachedPieces[Math.floor(Math.random() * attachedPieces.length)];

                // Detach it
                detachPiece(pieceToDetach, normalizedHeat);

                breakawayState.totalDetached++;
                console.log(`[Breakaway] Detached piece ${pieceToDetach.sliceId}! (${breakawayState.totalDetached}/${breakawayState.maxDetachable})`);
            }

            // Reset timer with randomized interval
            breakawayState.detachTimer = 0;
            const [minInterval, maxInterval] = BREAKAWAY_CONFIG.detachInterval;
            breakawayState.nextDetachTime = lerp(minInterval, maxInterval, 1 - normalizedHeat) * randomRange(0.7, 1.3);
        }

        // Update physics for detached pieces
        breakawayState.pieces.forEach(piece => {
            if (!piece.hasDetached) return;

            // Update position
            piece.mesh.position.x += piece.velocity.x * dt;
            piece.mesh.position.y += piece.velocity.y * dt;
            piece.mesh.position.z += piece.velocity.z * dt;

            // Update rotation (tumbling)
            piece.mesh.rotation.x += piece.angularVelocity.x * dt;
            piece.mesh.rotation.y += piece.angularVelocity.y * dt;
            piece.mesh.rotation.z += piece.angularVelocity.z * dt;

            // Fade out over time
            piece.age = (piece.age || 0) + dt;
            if (piece.age > 10) {
                const fadeAmount = (piece.age - 10) / 10; // Fade over 10 seconds
                if (piece.mesh.material.opacity !== undefined) {
                    piece.mesh.material.transparent = true;
                    piece.mesh.material.opacity = Math.max(0, 1 - fadeAmount);
                }
            }

            // Remove if too old
            if (piece.age > 20) {
                piece.mesh.visible = false;
            }
        });
    }

    /**
     * Detach a piece from the bus
     */
    function detachPiece(piece, normalizedHeat) {
        piece.hasDetached = true;
        piece.age = 0;

        // Calculate ejection velocity (away from center, backward)
        const [minVel, maxVel] = BREAKAWAY_CONFIG.detachVelocity;
        const speed = lerp(minVel, maxVel, normalizedHeat) * randomRange(0.8, 1.2);

        // Direction: mostly backward (-X) with some outward scatter
        const outwardDir = piece.center.clone().normalize();
        piece.velocity.set(
            -speed * randomRange(0.8, 1.2),           // Backward
            outwardDir.y * speed * 0.3 + randomRange(-0.5, 0.5),  // Slight Y
            outwardDir.z * speed * 0.3 + randomRange(-0.5, 0.5)   // Slight Z
        );

        // Randomize angular velocity for tumbling
        piece.angularVelocity.set(
            randomRange(-3, 3),
            randomRange(-3, 3),
            randomRange(-3, 3)
        );

        // Char the material
        if (piece.mesh.material.color) {
            piece.mesh.material.color.lerp(new THREE.Color(0x332211), 0.5 + normalizedHeat * 0.3);
        }
        if (piece.mesh.material.emissive) {
            piece.mesh.material.emissive.setRGB(0.3, 0.1, 0);
        }

        // Move piece from vehicle to scene (so it's no longer transformed with vehicle)
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        piece.mesh.getWorldPosition(worldPos);
        piece.mesh.getWorldQuaternion(worldQuat);
        piece.mesh.getWorldScale(worldScale);

        currentVehicle.remove(piece.mesh);
        scene.add(piece.mesh);

        piece.mesh.position.copy(worldPos);
        piece.mesh.quaternion.copy(worldQuat);
        piece.mesh.scale.copy(worldScale);
    }

    /**
     * Helper: Linear interpolation
     */
    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /**
     * Helper: Random float in range
     */
    function randomRange(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * Helper: Clamp value to range
     */
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Create a debris chunk geometry (irregular tetrahedron-like)
     */
    function createDebrisGeometry(scale) {
        // Create irregular shard/chunk geometry (like torn metal pieces)
        // Randomly choose between different chunk shapes
        const shapeType = Math.random();
        let geometry;

        if (shapeType < 0.4) {
            // Irregular twisted panel
            const width = scale * randomRange(1.0, 2.0);
            const height = scale * randomRange(0.8, 1.5);
            const depth = scale * randomRange(0.1, 0.4);
            geometry = new THREE.BoxGeometry(width, height, depth, 2, 2, 1);
        } else if (shapeType < 0.7) {
            // Triangular shard
            const s = scale;
            const verts = new Float32Array([
                -s * randomRange(0.8, 1.5), -s * randomRange(0.5, 1.0), -s * randomRange(0.1, 0.3),
                 s * randomRange(0.8, 1.5), -s * randomRange(0.3, 0.8),  s * randomRange(0.1, 0.3),
                 s * randomRange(0.2, 0.6),  s * randomRange(0.8, 1.5),  0,
                -s * randomRange(0.3, 0.6), -s * randomRange(0.2, 0.5),  s * randomRange(0.3, 0.6),
            ]);
            geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
            geometry.setIndex([0,1,2, 0,1,3, 1,2,3, 2,0,3]);
            geometry.computeVertexNormals();
            return geometry;
        } else {
            // Chunky block (structural piece)
            const width = scale * randomRange(0.6, 1.2);
            const height = scale * randomRange(0.6, 1.2);
            const depth = scale * randomRange(0.4, 0.8);
            geometry = new THREE.BoxGeometry(width, height, depth);
        }

        // Heavily distort vertices for torn/damaged look
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            positions.setX(i, positions.getX(i) + randomRange(-0.2, 0.2) * scale);
            positions.setY(i, positions.getY(i) + randomRange(-0.2, 0.2) * scale);
            positions.setZ(i, positions.getZ(i) + randomRange(-0.15, 0.15) * scale);
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();

        return geometry;
    }

    /**
     * Sample a random point from the bus surface
     * Returns object with worldPos, mesh, vertexIndex, and localPos
     */
    function sampleBusSurfacePoint() {
        if (debrisState.busMeshes.length === 0) {
            return { worldPos: new THREE.Vector3(0, 0, 0), mesh: null, vertexIndex: -1, localPos: null };
        }

        // Pick a random mesh
        const mesh = debrisState.busMeshes[Math.floor(Math.random() * debrisState.busMeshes.length)];
        const geometry = mesh.geometry;
        const positions = geometry.attributes.position;

        if (!positions || positions.count < 3) {
            return { worldPos: new THREE.Vector3(0, 0, 0), mesh: null, vertexIndex: -1, localPos: null };
        }

        // Calculate bounding box and center
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxExtent = Math.max(size.x, size.y, size.z) * 0.5;

        // Find vertices near edges/corners (far from center)
        // Weight vertices by their distance from center - corners have highest weight
        const edgeVertices = [];
        const edgeThreshold = maxExtent * 0.5; // Vertices in outer 50% of mesh

        for (let i = 0; i < positions.count; i++) {
            const vx = positions.getX(i);
            const vy = positions.getY(i);
            const vz = positions.getZ(i);

            // Distance from center
            const dx = vx - center.x;
            const dy = vy - center.y;
            const dz = vz - center.z;
            const distFromCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // Check if vertex is near edges (outer region)
            if (distFromCenter > edgeThreshold) {
                // Weight by distance - corners get higher weight
                const weight = Math.pow(distFromCenter / maxExtent, 2);
                edgeVertices.push({ index: i, weight: weight });
            }
        }

        // Select vertex with randomization
        let vertexIndex;

        // 30% chance to pick completely random vertex for variety
        if (Math.random() < 0.3 || edgeVertices.length === 0) {
            vertexIndex = Math.floor(Math.random() * positions.count);
        } else {
            // Weighted random selection - prefer vertices furthest from center
            const totalWeight = edgeVertices.reduce((sum, v) => sum + v.weight, 0);
            let randomWeight = Math.random() * totalWeight;
            for (const v of edgeVertices) {
                randomWeight -= v.weight;
                if (randomWeight <= 0) {
                    vertexIndex = v.index;
                    break;
                }
            }
            if (vertexIndex === undefined) {
                vertexIndex = edgeVertices[Math.floor(Math.random() * edgeVertices.length)].index;
            }
        }

        const localPos = new THREE.Vector3(
            positions.getX(vertexIndex),
            positions.getY(vertexIndex),
            positions.getZ(vertexIndex)
        );

        // Add random offset to make each spawn unique (jitter within mesh bounds)
        const jitterAmount = maxExtent * 0.15;
        localPos.x += randomRange(-jitterAmount, jitterAmount);
        localPos.y += randomRange(-jitterAmount, jitterAmount);
        localPos.z += randomRange(-jitterAmount, jitterAmount);

        // Transform to world space
        const worldPos = localPos.clone();
        mesh.localToWorld(worldPos);

        return { worldPos, mesh, vertexIndex, localPos };
    }

    /**
     * Mark damage on bus surface at given point
     * Collapses vertices inward to create visible "holes" where debris tore off
     */
    function markDamageAtPoint(mesh, localPos, damageIntensity, damageRadius) {
        if (!mesh || !mesh.geometry) return;

        const geometry = mesh.geometry;
        const positions = geometry.attributes.position;
        const vertexDamageArray = debrisState.vertexDamage.get(mesh);
        const originalPositions = debrisState.originalColors.get(mesh); // Reusing this map for original positions

        if (!positions || !vertexDamageArray) return;

        // Store original positions if not already stored
        if (!originalPositions) {
            debrisState.originalColors.set(mesh, positions.array.slice());
        }

        const vertexCount = positions.count;
        let damageApplied = 0;

        // Calculate mesh center for collapse direction
        let centerX = 0, centerY = 0, centerZ = 0;
        for (let i = 0; i < vertexCount; i++) {
            centerX += positions.getX(i);
            centerY += positions.getY(i);
            centerZ += positions.getZ(i);
        }
        centerX /= vertexCount;
        centerY /= vertexCount;
        centerZ /= vertexCount;

        // Find all vertices within damage radius and collapse them inward
        for (let i = 0; i < vertexCount; i++) {
            const vx = positions.getX(i);
            const vy = positions.getY(i);
            const vz = positions.getZ(i);

            // Distance from damage point in local space
            const dx = vx - localPos.x;
            const dy = vy - localPos.y;
            const dz = vz - localPos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < damageRadius) {
                // Calculate damage falloff (more damage closer to center)
                const falloff = 1 - (dist / damageRadius);
                const damageAmount = damageIntensity * falloff; // Linear falloff for wider damage

                // Accumulate damage for this vertex (capped at 1.0)
                const currentDamage = vertexDamageArray[i];
                const newDamage = Math.min(1.0, currentDamage + damageAmount);
                vertexDamageArray[i] = newDamage;

                // AGGRESSIVE collapse - fully damaged vertices move completely to center
                // This effectively "removes" the geometry by collapsing it
                if (newDamage > 0.3) {
                    // Collapse factor: vertices above 30% damage start collapsing hard
                    const collapseStrength = Math.pow((newDamage - 0.3) / 0.7, 0.5); // 0 to 1

                    // Move vertex toward mesh center (effectively removing it)
                    const newX = vx + (centerX - vx) * collapseStrength;
                    const newY = vy + (centerY - vy) * collapseStrength;
                    const newZ = vz + (centerZ - vz) * collapseStrength;

                    positions.setXYZ(i, newX, newY, newZ);
                }

                damageApplied += damageAmount * 0.15; // More damage per vertex for faster destruction
            }
        }

        positions.needsUpdate = true;
        geometry.computeVertexNormals(); // Recalculate normals for proper lighting

        // Update total damage
        const prevDamage = debrisState.totalDamage;
        debrisState.totalDamage = Math.min(debrisState.maxDamage, debrisState.totalDamage + damageApplied);

        // Darken/char the bus material based on total damage
        if (mesh.material) {
            const charLevel = debrisState.totalDamage;
            const baseColor = new THREE.Color(0x888888); // Original gray
            const charColor = new THREE.Color(0x222211); // Charred dark
            const currentColor = baseColor.clone().lerp(charColor, charLevel);

            if (mesh.material.color) {
                mesh.material.color.copy(currentColor);
            }
            if (mesh.material.emissive) {
                // Add slight red glow at high damage (glowing hot)
                mesh.material.emissive.setRGB(charLevel * 0.3, charLevel * 0.1, 0);
            }
        }

        // Log progress at 10% increments
        if (Math.floor(debrisState.totalDamage * 10) > Math.floor(prevDamage * 10)) {
            console.log(`[DEBRIS] Total damage: ${(debrisState.totalDamage * 100).toFixed(1)}%`);
        }
    }

    /**
     * Get debris color based on bus material (burnt/charred look)
     */
    function getDebrisColor(normalizedHeat) {
        // Keep debris mostly yellow so it's clearly from the bus
        // Only slight darkening at extreme heat
        const baseColor = new THREE.Color(0xffcc00); // Bus yellow
        const heatedColor = new THREE.Color(0xdd8800); // Darker orange-yellow when hot

        return baseColor.clone().lerp(heatedColor, normalizedHeat * 0.6);
    }

    /**
     * Spawn a new debris chunk
     */
    function spawnDebris(normalizedHeat) {
        // Check if we've exceeded maximum damage - preserve the main chunk
        if (debrisState.totalDamage >= debrisState.maxDamage) {
            return; // Stop spawning to keep solid main chunk
        }

        if (debrisState.active.length >= debrisState.maxDebris) {
            // Remove oldest debris to make room
            const oldest = debrisState.active.shift();
            if (oldest && oldest.mesh) {
                scene.remove(oldest.mesh);
                oldest.mesh.geometry.dispose();
                oldest.mesh.material.dispose();
            }
        }

        // Calculate chunk scale with high randomization for variety
        const heatPower = Math.pow(normalizedHeat, 1.5); // Less steep = larger chunks earlier
        let chunkScale = lerp(DEBRIS_MIN_SCALE, DEBRIS_MAX_SCALE, heatPower);
        chunkScale *= randomRange(0.5, 1.8); // Wide random range for varied chunk sizes

        // Sample surface point (returns mesh and vertex info for damage marking)
        const spawnData = sampleBusSurfacePoint();
        if (!spawnData.mesh) return;

        // Mark MASSIVE damage on the bus at spawn location
        // Large radius to cut off big chunks
        const damageIntensity = lerp(0.8, 2.0, normalizedHeat) * randomRange(0.9, 1.3);
        const damageRadius = lerp(1.5, 4.0, heatPower) * chunkScale; // Much larger damage area
        markDamageAtPoint(spawnData.mesh, spawnData.localPos, damageIntensity, damageRadius);

        // Create debris geometry and material
        const geometry = createDebrisGeometry(chunkScale);
        const color = getDebrisColor(normalizedHeat);

        // Calculate emissive glow based on heat (hot debris glows orange/red)
        const emissiveIntensity = Math.pow(normalizedHeat, 1.5) * 0.8;
        const emissiveColor = new THREE.Color().lerpColors(
            new THREE.Color(0x331100), // Dark red at low heat
            new THREE.Color(0xff6600), // Bright orange at high heat
            normalizedHeat
        );

        const material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: emissiveColor,
            emissiveIntensity: emissiveIntensity,
            roughness: 0.9,
            metalness: 0.1,
            transparent: true,
            opacity: 1.0
        });

        const mesh = new THREE.Mesh(geometry, material);

        // Position at sampled surface point
        mesh.position.copy(spawnData.worldPos);

        // Random initial rotation for variety
        mesh.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );

        // Calculate ejection velocity (always -X dominant)
        const velocityPower = Math.pow(normalizedHeat, 2);
        const baseVelocity = lerp(DEBRIS_MIN_VELOCITY, DEBRIS_MAX_VELOCITY, velocityPower);

        const velocity = new THREE.Vector3(
            -baseVelocity * randomRange(0.6, 1.4),           // Rearward (-X) with variation
            randomRange(-0.5, 0.5) * baseVelocity * 0.4,     // Y scatter
            randomRange(-0.5, 0.5) * baseVelocity * 0.4      // Z scatter
        );

        // Calculate angular velocity for tumbling
        const angularSpeed = lerp(0.5, 10.0, velocityPower) * randomRange(0.5, 1.5);
        const angularAxis = new THREE.Vector3(
            randomRange(-1, 1),
            randomRange(-1, 1),
            randomRange(-1, 1)
        ).normalize();
        const angularVelocity = angularAxis.multiplyScalar(angularSpeed);

        // Calculate lifetime (shorter at high heat - burns up faster)
        const lifetime = lerp(DEBRIS_MAX_LIFETIME, DEBRIS_MIN_LIFETIME, normalizedHeat);

        // Add to scene
        scene.add(mesh);

        console.log(`[DEBRIS] Created panel at (${mesh.position.x.toFixed(2)}, ${mesh.position.y.toFixed(2)}, ${mesh.position.z.toFixed(2)}), scale: ${chunkScale.toFixed(2)}, velocity: ${baseVelocity.toFixed(1)} m/s`);

        // Store debris data
        debrisState.active.push({
            mesh: mesh,
            velocity: velocity,
            angularVelocity: angularVelocity,
            age: 0,
            lifetime: lifetime,
            initialOpacity: 1.0
        });
    }

    /**
     * Update all active debris
     * @param {number} dt - Real-time delta for smooth physics
     * @param {number} simDt - Simulation time delta (scales with fast forward)
     * @param {number} heatFlux - Current heat flux in kW/m²
     */
    function updateDebris(dt, simDt, heatFlux) {
        // Only active for school bus
        if (!debrisState.initialized || !currentVehicleConfig ||
            currentVehicleConfig.name !== 'School Bus') {
            return;
        }

        // Normalize heat flux (0-4000 kW/m² range)
        const normalizedHeat = clamp(heatFlux / 4000, 0, 1);

        // Only spawn debris if heat flux exceeds 500 kW/m²
        if (heatFlux > 500 && simDt > 0) {
            // Update spawn timer using SIMULATION time (scales with fast forward)
            debrisState.spawnTimer += simDt;

            // Debug: Log heat flux periodically
            if (Math.random() < 0.01) {
                console.log(`[DEBRIS] HeatFlux: ${heatFlux.toFixed(0)} kW/m², SimDt: ${simDt.toFixed(3)}s, Timer: ${debrisState.spawnTimer.toFixed(2)}s, NextSpawn: ${debrisState.nextSpawnInterval.toFixed(2)}s, Damage: ${(debrisState.totalDamage * 100).toFixed(1)}%`);
            }

            // Check if it's time to spawn - may spawn multiple if fast forwarding
            while (debrisState.spawnTimer >= debrisState.nextSpawnInterval && debrisState.totalDamage < debrisState.maxDamage) {
                spawnDebris(normalizedHeat);
                debrisState.spawnTimer -= debrisState.nextSpawnInterval;

                // Calculate next spawn interval with MORE randomization
                const heatPower = Math.pow(normalizedHeat, 1.2);
                const baseInterval = lerp(DEBRIS_MAX_INTERVAL, DEBRIS_MIN_INTERVAL, heatPower);
                debrisState.nextSpawnInterval = baseInterval * randomRange(0.4, 1.6); // Wider random range

                console.log(`[DEBRIS] Spawned! Active: ${debrisState.active.length}, Heat: ${(normalizedHeat * 100).toFixed(0)}%, NextInterval: ${debrisState.nextSpawnInterval.toFixed(2)}s, Damage: ${(debrisState.totalDamage * 100).toFixed(1)}%`);
            }
        }

        // Update each debris piece
        for (let i = debrisState.active.length - 1; i >= 0; i--) {
            const debris = debrisState.active[i];

            // Update age
            debris.age += dt;

            // Check if expired
            if (debris.age >= debris.lifetime) {
                scene.remove(debris.mesh);
                debris.mesh.geometry.dispose();
                debris.mesh.material.dispose();
                debrisState.active.splice(i, 1);
                continue;
            }

            // Update position
            debris.mesh.position.x += debris.velocity.x * dt;
            debris.mesh.position.y += debris.velocity.y * dt;
            debris.mesh.position.z += debris.velocity.z * dt;

            // Apply tumbling rotation
            const rotationQuat = new THREE.Quaternion();
            const angle = debris.angularVelocity.length() * dt;
            if (angle > 0) {
                const axis = debris.angularVelocity.clone().normalize();
                rotationQuat.setFromAxisAngle(axis, angle);
                debris.mesh.quaternion.premultiply(rotationQuat);
            }

            // Fade out near end of life (last 20% of lifetime)
            const fadeStartRatio = 0.8;
            const lifeRatio = debris.age / debris.lifetime;
            if (lifeRatio > fadeStartRatio) {
                const fadeProgress = (lifeRatio - fadeStartRatio) / (1 - fadeStartRatio);
                debris.mesh.material.opacity = debris.initialOpacity * (1 - fadeProgress);
            }

            // Add slight gravity effect
            debris.velocity.y -= 0.5 * dt;
        }
    }

    /**
     * Cleanup debris system
     */
    function disposeDebrisSystem() {
        debrisState.active.forEach(d => {
            if (d.mesh) {
                scene.remove(d.mesh);
                if (d.mesh.geometry) d.mesh.geometry.dispose();
                if (d.mesh.material) d.mesh.material.dispose();
            }
        });
        debrisState.active = [];
        debrisState.busMeshes = [];
        debrisState.vertexDamage.clear();
        debrisState.originalColors.clear();
        debrisState.totalDamage = 0;
        debrisState.initialized = false;

        // Also dispose breakaway system
        breakawayState.pieces.forEach(p => {
            if (p.mesh) {
                if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
                scene.remove(p.mesh);
                if (p.mesh.geometry) p.mesh.geometry.dispose();
                if (p.mesh.material) p.mesh.material.dispose();
            }
        });
        breakawayState.pieces = [];
        breakawayState.corePiece = null;
        breakawayState.initialized = false;
        breakawayState.totalDetached = 0;
        breakawayState.heatAccumulator = 0;
    }

    // ================================================================
    // COORDINATE AXES
    // ================================================================
    function createBodyAxes(size = 3) {
        const group = new THREE.Group();

        const xMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const yMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const zMat = new THREE.MeshBasicMaterial({ color: 0x0088ff });

        const shaftRadius = size * 0.015;
        const shaftLength = size * 0.85;
        const coneRadius = size * 0.04;
        const coneLength = size * 0.15;

        const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 8);
        const coneGeo = new THREE.ConeGeometry(coneRadius, coneLength, 8);

        // X axis (red)
        const xShaft = new THREE.Mesh(shaftGeo, xMat);
        xShaft.rotation.z = -Math.PI / 2;
        xShaft.position.x = shaftLength / 2;
        group.add(xShaft);

        const xCone = new THREE.Mesh(coneGeo, xMat);
        xCone.rotation.z = -Math.PI / 2;
        xCone.position.x = shaftLength + coneLength / 2;
        group.add(xCone);

        // Y axis (green)
        const yShaft = new THREE.Mesh(shaftGeo, yMat);
        yShaft.position.y = shaftLength / 2;
        group.add(yShaft);

        const yCone = new THREE.Mesh(coneGeo, yMat);
        yCone.position.y = shaftLength + coneLength / 2;
        group.add(yCone);

        // Z axis (blue)
        const zShaft = new THREE.Mesh(shaftGeo, zMat);
        zShaft.rotation.x = Math.PI / 2;
        zShaft.position.z = shaftLength / 2;
        group.add(zShaft);

        const zCone = new THREE.Mesh(coneGeo, zMat);
        zCone.rotation.x = Math.PI / 2;
        zCone.position.z = shaftLength + coneLength / 2;
        group.add(zCone);

        return group;
    }

    function createWindAxes(size = 3) {
        const group = new THREE.Group();

        const xMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.6 });
        const yMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.6 });
        const zMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.6 });

        const shaftRadius = size * 0.02;
        const shaftLength = size * 0.85;
        const coneRadius = size * 0.05;
        const coneLength = size * 0.15;

        const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 8);
        const coneGeo = new THREE.ConeGeometry(coneRadius, coneLength, 8);

        // X axis (velocity direction - red)
        const xShaft = new THREE.Mesh(shaftGeo, xMat);
        xShaft.rotation.z = -Math.PI / 2;
        xShaft.position.x = shaftLength / 2;
        group.add(xShaft);

        const xCone = new THREE.Mesh(coneGeo, xMat);
        xCone.rotation.z = -Math.PI / 2;
        xCone.position.x = shaftLength + coneLength / 2;
        group.add(xCone);

        // Y axis (up - green)
        const yShaft = new THREE.Mesh(shaftGeo, yMat);
        yShaft.position.y = shaftLength / 2;
        group.add(yShaft);

        const yCone = new THREE.Mesh(coneGeo, yMat);
        yCone.position.y = shaftLength + coneLength / 2;
        group.add(yCone);

        // Z axis (lateral - blue)
        const zShaft = new THREE.Mesh(shaftGeo, zMat);
        zShaft.rotation.x = Math.PI / 2;
        zShaft.position.z = shaftLength / 2;
        group.add(zShaft);

        const zCone = new THREE.Mesh(coneGeo, zMat);
        zCone.rotation.x = Math.PI / 2;
        zCone.position.z = shaftLength + coneLength / 2;
        group.add(zCone);

        return group;
    }

    // ================================================================
    // VEHICLE LOADING
    // ================================================================
    function isHeatShieldMesh(meshName, config) {
        const nameLower = meshName.toLowerCase();

        for (const hsName of config.heatShieldMeshes) {
            if (nameLower.includes(hsName.toLowerCase())) {
                return true;
            }
        }

        return nameLower.includes('heat') ||
               nameLower.includes('shield') ||
               nameLower.includes('thermal') ||
               nameLower.includes('ablat');
    }

    const loader = new GLTFLoader();

    function loadVehicle(vehicleNum) {
        console.log('[Vehicle Viewer] loadVehicle called with:', vehicleNum);
        const vehicleConfig = vehicles[vehicleNum];
        if (!vehicleConfig) {
            console.error('[Vehicle Viewer] No config for vehicle:', vehicleNum);
            return;
        }
        console.log('[Vehicle Viewer] Loading:', vehicleConfig.name, 'file:', vehicleConfig.filename);

        currentVehicleConfig = vehicleConfig;

        // Clear existing vehicle
        if (currentVehicle) {
            scene.remove(currentVehicle);
            currentVehicle.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }

        // Clear debris when switching vehicles
        disposeDebrisSystem();

        heatShieldMeshes = [];
        heatShieldVertices = [];
        cachedWorldVerts = [];
        originalMaterials.clear();
        allVehicleMeshes = [];
        dynamicHeatMaterials.clear();

        // Reset smoothed values
        smoothedShieldCenter.set(0, 0, 0);
        smoothedShieldNormal.set(-1, 0, 0);
        smoothedRadius = 2.0;

        loader.load(
            '../models/' + vehicleConfig.filename,
            (gltf) => {
                currentVehicle = gltf.scene;

                // Update world matrices before computing bounding box
                currentVehicle.updateMatrixWorld(true);

                // Compute tight bounding box from visible meshes only
                // (excludes invisible helpers, empty groups, etc.)
                const box = new THREE.Box3();
                currentVehicle.traverse((child) => {
                    if (child.isMesh && child.geometry) {
                        child.geometry.computeBoundingBox();
                        const meshBox = child.geometry.boundingBox.clone();
                        meshBox.applyMatrix4(child.matrixWorld);
                        box.union(meshBox);
                    }
                });

                // Fallback if no meshes found
                if (box.isEmpty()) {
                    box.setFromObject(currentVehicle);
                }

                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);

                // Normalize vehicle to standard size (max dimension = 10 units)
                const TARGET_SIZE = 10;
                const scale = TARGET_SIZE / maxDim;

                currentVehicle.scale.multiplyScalar(scale);

                // Center vehicle at origin, unless useModelOrigin is set
                // useModelOrigin keeps the model's original origin (for correct axis placement)
                let cameraLookAt = new THREE.Vector3(0, 0, 0);
                if (vehicleConfig.useModelOrigin) {
                    // Don't re-center - keep model's origin at world origin
                    // Camera looks at the scaled center of the bounding box
                    cameraLookAt.copy(center.multiplyScalar(scale));
                } else {
                    // Re-center vehicle so bounding box center is at origin
                    currentVehicle.position.sub(center.multiplyScalar(scale));
                }

                // Calculate camera distance so vehicle fills the configured percentage of the frame
                // For a bounding sphere of radius r to fill fillPercent of vertical FOV:
                // distance = r / (fillPercent * tan(FOV/2))
                const fillPercent = vehicleConfig.fillPercent || DEFAULT_FILL_PERCENT;
                const boundingSphereRadius = TARGET_SIZE / 2; // half of max dimension
                const fovRadians = (CAMERA_FOV * Math.PI) / 180;
                const cameraDistance = boundingSphereRadius / (fillPercent * Math.tan(fovRadians / 2));

                // Position camera at calculated distance with slight offset for nice viewing angle
                camera.position.set(
                    cameraLookAt.x + cameraDistance * 0.7,
                    cameraLookAt.y + cameraDistance * 0.4,
                    cameraLookAt.z + cameraDistance * 0.7
                );
                camera.lookAt(cameraLookAt);
                controls.target.copy(cameraLookAt);
                controls.update();

                // Find heat shield meshes
                currentVehicle.traverse((child) => {
                    if (child.isMesh) {
                        const isHeatShield = isHeatShieldMesh(child.name, vehicleConfig);

                        originalMaterials.set(child, child.material.clone());

                        if (isHeatShield) {
                            const heatMat = createHeatShieldMaterial();
                            child.material = heatMat;
                            heatShieldMeshes.push(child);

                            const positions = child.geometry.attributes.position;
                            for (let i = 0; i < positions.count; i++) {
                                heatShieldVertices.push(new THREE.Vector3(
                                    positions.getX(i),
                                    positions.getY(i),
                                    positions.getZ(i)
                                ));
                            }
                        }
                    }
                });

                scene.add(currentVehicle);

                // Remove old coordinate axes
                if (bodyAxes) {
                    scene.remove(bodyAxes);
                    bodyAxes = null;
                }
                if (windAxes) {
                    scene.remove(windAxes);
                    windAxes = null;
                }

                // Axes size: slightly larger than vehicle so they just protrude
                // Add axes to SCENE (not vehicle) to avoid scale inheritance, sync rotation in animation loop
                const baseAxesSize = TARGET_SIZE * 0.55;  // 55% of vehicle size = axes protrude just past vehicle
                const axesScale = vehicleConfig.axesScale || 1.0;
                const axesSize = baseAxesSize * axesScale;

                if (vehicleConfig.isTumbling) {
                    // Tumbling vehicles: only wind axes, no body-fixed axes
                    const worldAxisLength = TARGET_SIZE * 0.5 * axesScale;
                    windAxes = createWindAxes(worldAxisLength);
                    windAxes.position.set(0, 0, 0);
                    scene.add(windAxes);
                    // No bodyAxes for tumbling vehicles
                } else {
                    bodyAxes = createBodyAxes(axesSize);
                    // Position axes at the SAME location as the vehicle's local origin
                    // This ensures they share the same pivot point when rotating
                    bodyAxes.position.copy(currentVehicle.position);
                    scene.add(bodyAxes);
                }

                // Ensure bow shock is in scene
                if (shockHalo && !scene.children.includes(shockHalo)) {
                    scene.add(shockHalo);
                }

                // Setup dynamic heating
                if (vehicleConfig.dynamicHeatShield) {
                    setupDynamicHeating();
                }

                // Initialize tumbling
                if (vehicleConfig.isTumbling) {
                    initTumbleState();
                }

                // Initialize debris system (School Bus only)
                initDebrisSystem();

                // Apply current heat flux
                updateHeatShield(heatFlux);
                if (vehicleConfig.dynamicHeatShield) {
                    updateDynamicHeating(heatFlux, 0);
                }
            },
            undefined,
            (error) => {
                console.error('Error loading vehicle:', error);
            }
        );
    }

    // ================================================================
    // RESIZE HANDLER
    // ================================================================
    function handleResize() {
        const width = containerElement.clientWidth;
        const height = containerElement.clientHeight;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }

    // Create resize observer
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerElement);

    // ================================================================
    // ANIMATION LOOP
    // ================================================================
    let animationFrameId = null;

    function animate() {
        animationFrameId = requestAnimationFrame(animate);

        // Use real-time delta for smooth particle physics (like original)
        const dt = Math.min(clock.getDelta(), 0.1);

        // Compute simulation dt (accounts for fast forward)
        const simDt = Math.max(0, externalState.time - previousSimTime);
        previousSimTime = externalState.time;

        // Update L/D and vehicle if changed (always check, even when paused)
        if (externalState.liftToDrag !== currentLDValue) {
            console.log('[Vehicle Viewer] L/D changed:', currentLDValue, '->', externalState.liftToDrag);
            currentLDValue = externalState.liftToDrag;
            const newVehicle = getVehicleFromLD(currentLDValue);
            console.log('[Vehicle Viewer] New vehicle from L/D:', newVehicle, '(last was:', lastLoadedVehicle, ')');
            if (newVehicle !== lastLoadedVehicle) {
                console.log('[Vehicle Viewer] Loading vehicle:', newVehicle);
                lastLoadedVehicle = newVehicle;
                loadVehicle(newVehicle);
            }
        }

        if (!isPlaying) {
            // When paused, just render without updating animations
            controls.update();
            renderer.render(scene, camera);
            return;
        }

        // Use external heat flux
        heatFlux = externalState.heatFlux;

        // Apply absolute bank and flight path angles (for controlled vehicles)
        if (currentVehicle && currentVehicleConfig && !currentVehicleConfig.isTumbling) {
            // Convert degrees to radians
            // Negate bank angle to match simulation convention (positive bank = blue Z-axis rotates down)
            const bankRad = -externalState.bankAngle * Math.PI / 180;
            const fpaRad = externalState.flightPathAngle * Math.PI / 180;

            // FPA: pitch nose up/down from local horizon (rotation around Y-axis)
            // Positive FPA = nose above horizon, negative FPA = nose below horizon
            // Bank: roll around velocity vector (X-axis)
            const fpaQuat = new THREE.Quaternion();
            fpaQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), fpaRad);  // Pitch in X-Y plane

            const bankQuat = new THREE.Quaternion();
            bankQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), bankRad);  // Roll around velocity

            // Apply: first bank (around original X), then FPA (pitches the banked vehicle)
            // This ensures velocity vector (X-axis) is only affected by FPA, not bank
            const finalQuat = new THREE.Quaternion();
            finalQuat.multiplyQuaternions(fpaQuat, bankQuat);

            currentVehicle.quaternion.copy(finalQuat);

            // Sync body axes rotation with vehicle (axes are in scene, not parented to vehicle)
            if (bodyAxes) {
                bodyAxes.quaternion.copy(finalQuat);
            }
        }

        // Update tumbling motion (for uncontrolled reentry)
        updateTumble(dt);

        // Update heat shield
        updateHeatShield(heatFlux, dt);

        // Update dynamic heating
        if (currentVehicleConfig && currentVehicleConfig.dynamicHeatShield) {
            updateDynamicHeating(heatFlux, dt);
        }

        // Update bow shock
        updateShockHalo(heatFlux, dt);

        // Update particle systems
        plasmaEmitter.update(dt, heatFlux);
        sootEmitter.update(dt, heatFlux);

        // DISABLED: Yellow debris panels - replaced with breakaway system
        // updateDebris(dt, simDt, heatFlux);

        // Update breakaway pieces (School Bus only) - actual chunks breaking off
        updateBreakaway(dt, simDt, heatFlux);

        controls.update();
        renderer.render(scene, camera);
    }

    // ================================================================
    // PUBLIC API
    // ================================================================

    /**
     * Update vehicle state from external simulation
     * @param {Object} state - State object
     * @param {number} state.time - Simulation time in seconds
     * @param {number} state.heatFlux - Heat flux in kW/m²
     * @param {number} state.liftToDrag - Lift-to-drag ratio (determines vehicle)
     * @param {number} state.bankAngle - Bank angle in degrees (absolute)
     * @param {number} state.flightPathAngle - Flight path angle in degrees (absolute)
     */
    function updateVehicleState(state) {
        if (state.time !== undefined) externalState.time = state.time;
        if (state.heatFlux !== undefined) externalState.heatFlux = state.heatFlux;
        if (state.liftToDrag !== undefined) externalState.liftToDrag = state.liftToDrag;
        if (state.bankAngle !== undefined) externalState.bankAngle = state.bankAngle;
        if (state.flightPathAngle !== undefined) externalState.flightPathAngle = state.flightPathAngle;
    }

    /**
     * Set playback state
     * @param {boolean} playing - true = render updates, false = freeze
     */
    function setPlaybackState(playing) {
        if (playing && !isPlaying) {
            // Resuming from pause - reset clock to avoid large dt jump
            clock.getDelta();
        }
        isPlaying = playing;
    }

    /**
     * Dispose of all resources
     */
    function dispose() {
        // Stop animation loop
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        // Disconnect resize observer
        resizeObserver.disconnect();

        // Dispose particle systems
        plasmaEmitter.dispose();
        sootEmitter.dispose();

        // Dispose bow shock
        if (shockHalo) {
            scene.remove(shockHalo);
            if (shockHaloGeometry) shockHaloGeometry.dispose();
            if (shockHaloMaterial) shockHaloMaterial.dispose();
        }

        // Dispose debris system
        disposeDebrisSystem();

        // Dispose vehicle
        if (currentVehicle) {
            scene.remove(currentVehicle);
            currentVehicle.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }

        // Dispose axes
        if (bodyAxes) {
            scene.remove(bodyAxes);
        }
        if (windAxes) {
            scene.remove(windAxes);
        }

        // Dispose lights
        scene.remove(ambientLight);
        scene.remove(directionalLight);
        scene.remove(backLight);
        scene.remove(heatLight);

        // Dispose renderer
        renderer.dispose();
        containerElement.removeChild(renderer.domElement);

        // Dispose controls
        controls.dispose();
    }

    // ================================================================
    // INITIALIZATION
    // ================================================================

    // Load initial vehicle based on default L/D
    lastLoadedVehicle = getVehicleFromLD(currentLDValue);
    loadVehicle(lastLoadedVehicle);

    // Start animation loop
    animate();

    // Return public API
    return {
        updateVehicleState,
        setPlaybackState,
        dispose,
        // Expose for debugging/advanced use
        getVehicleName: () => getVehicleNameFromLD(currentLDValue),
        getScene: () => scene,
        getCamera: () => camera,
        getRenderer: () => renderer
    };
}
