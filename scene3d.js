/*
  3D flight view, built with three.js.

  This file only draws. Every number it uses comes from the Python backend:
  the trajectory points, the range, the maximum height, and the flight time.
  The velocity arrows are measured from those same points (see readVelocity),
  so the physics formulas are never repeated here.

  It is a module because three.js is imported straight from the CDN.
  When it finishes loading it publishes window.projectileScene, which
  script.js calls after a successful calculation.
*/

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.min.js";

// Same colors as style.css, written as hex numbers for three.js.
const COLOR = {
  path: 0x34d399,        // emerald: the flight path
  ball: 0xfbbf24,        // amber: the projectile
  horizontal: 0x38bdf8,  // cyan: horizontal velocity
  vertical: 0xa78bfa,    // violet: vertical velocity
  gravity: 0xf87171,     // red: gravity
  ground: 0x0e1730,
  grid: 0x243352,
  label: "#e8eeff",
};

// The scene is drawn in its own units. The longest real distance is stretched
// or shrunk to this many units, so a 5 m/s launch and a 200 m/s launch both fit.
const WORLD_SIZE = 40;

let renderer = null;
let scene = null;
let camera = null;
let clock = null;

// Everything about the launch currently on screen.
let flight = null;

// Camera position, stored as an angle pair plus a distance (like a globe).
const view = {
  yaw: -0.55,
  pitch: 0.28,
  distance: WORLD_SIZE * 1.9,
  target: new THREE.Vector3(),
  autoRotate: true,
};

/* ---------- Small helpers ---------- */

// Draw text onto a hidden 2D canvas and hang it in the scene as a flat label.
// A three.js Sprite always turns to face the camera, so labels stay readable.
function makeLabel(text, colorText) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;

  const pen = canvas.getContext("2d");
  pen.font = "600 58px Inter, 'Segoe UI', sans-serif";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  pen.fillStyle = colorText || COLOR.label;
  pen.fillText(text, canvas.width / 2, canvas.height / 2);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    })
  );

  const width = WORLD_SIZE * 0.3;
  sprite.scale.set(width, width / 4, 1);
  return sprite;
}

// A glowing solid color. Emissive means "gives off light" so it stays bright.
function glowMaterial(color, opacity) {
  return new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.55,
    roughness: 0.35,
    metalness: 0.1,
    transparent: opacity !== undefined,
    opacity: opacity === undefined ? 1 : opacity,
  });
}

// A straight bar between two heights, used for the height and range markers.
function makeBar(length, radius, color, opacity) {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 12);
  return new THREE.Mesh(geometry, glowMaterial(color, opacity));
}

/* ---------- Reading speeds back out of the Python points ---------- */

/*
  The backend sends evenly spaced points, so the speed between two neighbouring
  points is (change in position) / (change in time). That is the definition of
  velocity, and it lets the arrows react to the real data instead of a second
  copy of the formulas.
*/
function readVelocity(points, flightTime, index) {
  const steps = points.length - 1;
  const timeStep = flightTime / steps;

  // Near the end of the list there is no "next" point, so look backwards.
  const from = index < steps ? points[index] : points[index - 1];
  const to = index < steps ? points[index + 1] : points[index];

  return {
    horizontal: (to.x - from.x) / timeStep,
    vertical: (to.y - from.y) / timeStep,
  };
}

/* ---------- Building the scene ---------- */

function createRenderer(canvas) {
  const created = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true, // let the CSS gradient behind the canvas show through
  });
  created.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  created.outputColorSpace = THREE.SRGBColorSpace;
  return created;
}

function buildScene(result) {
  const points = result.trajectory;

  // One scale factor for the whole scene, so the shape stays correct.
  const biggest = Math.max(result.range, result.max_height, 1);
  const worldScale = WORLD_SIZE / biggest;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070b18, WORLD_SIZE * 1.6, WORLD_SIZE * 4.5);

  scene.add(new THREE.AmbientLight(0xffffff, 1.6));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(WORLD_SIZE, WORLD_SIZE * 1.4, WORLD_SIZE * 0.9);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x7dd3fc, 1.1);
  fillLight.position.set(-WORLD_SIZE, WORLD_SIZE * 0.5, -WORLD_SIZE);
  scene.add(fillLight);

  // --- Ground ---
  const rangeUnits = result.range * worldScale;
  const groundSize = Math.max(rangeUnits * 1.25, WORLD_SIZE * 1.15);
  const middleOfFlight = rangeUnits / 2;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({
      color: COLOR.ground,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.85,
    })
  );
  ground.rotation.x = -Math.PI / 2; // lie flat
  ground.position.set(middleOfFlight, -0.02, 0);
  scene.add(ground);

  const grid = new THREE.GridHelper(groundSize, 24, COLOR.grid, COLOR.grid);
  grid.position.set(middleOfFlight, 0, 0);
  scene.add(grid);

  // --- Flight path, drawn as a glowing tube ---
  const curvePoints = points.map(function (point) {
    return new THREE.Vector3(point.x * worldScale, point.y * worldScale, 0);
  });
  const curve = new THREE.CatmullRomCurve3(curvePoints);
  const pathMesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 120, WORLD_SIZE * 0.007, 10, false),
    glowMaterial(COLOR.path)
  );
  scene.add(pathMesh);

  // --- Maximum height marker (violet bar plus label) ---
  const apex = curvePoints.reduce(function (highest, candidate) {
    return candidate.y > highest.y ? candidate : highest;
  }, curvePoints[0]);

  if (apex.y > 0.01) {
    // Nudged just off the flight plane so a straight-up launch does not hide it
    // inside the path tube.
    const heightBar = makeBar(apex.y, WORLD_SIZE * 0.004, COLOR.vertical, 0.75);
    heightBar.position.set(apex.x, apex.y / 2, WORLD_SIZE * 0.025);
    scene.add(heightBar);

    const heightLabel = makeLabel(result.max_height.toFixed(2) + " m high", "#c4b5fd");
    heightLabel.position.set(apex.x, apex.y + WORLD_SIZE * 0.14, 0);
    scene.add(heightLabel);
  }

  // --- Range marker along the ground (cyan bar plus label) ---
  if (rangeUnits > 0.01) {
    const rangeBar = makeBar(rangeUnits, WORLD_SIZE * 0.004, COLOR.horizontal, 0.9);
    rangeBar.rotation.z = Math.PI / 2; // stand the bar up sideways, along x
    rangeBar.position.set(middleOfFlight, 0.05, 0);
    scene.add(rangeBar);

    // Pulled toward the viewer so it does not cross the height bar.
    const rangeLabel = makeLabel(result.range.toFixed(2) + " m range", "#7dd3fc");
    rangeLabel.position.set(middleOfFlight, WORLD_SIZE * 0.04, WORLD_SIZE * 0.22);
    scene.add(rangeLabel);
  }

  // --- Launch angle arc ---
  const angleRadians = (result.angle * Math.PI) / 180;
  const arcRadius = WORLD_SIZE * 0.16;

  if (angleRadians > 0.01) {
    const arcPoints = new THREE.EllipseCurve(
      0, 0, arcRadius, arcRadius, 0, angleRadians, false, 0
    )
      .getPoints(40)
      .map(function (point) {
        return new THREE.Vector3(point.x, point.y, 0);
      });

    const arc = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(arcPoints),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
    );
    scene.add(arc);

    const angleLabel = makeLabel(result.angle + "\u00B0", "#e8eeff");
    angleLabel.scale.multiplyScalar(0.7);
    angleLabel.position.set(
      Math.cos(angleRadians / 2) * arcRadius * 1.5,
      Math.sin(angleRadians / 2) * arcRadius * 1.5,
      0
    );
    scene.add(angleLabel);
  }

  // --- Launch velocity arrow (points along the launch angle) ---
  const launchArrow = new THREE.ArrowHelper(
    new THREE.Vector3(Math.cos(angleRadians), Math.sin(angleRadians), 0),
    new THREE.Vector3(0, 0, 0),
    WORLD_SIZE * 0.34,
    0xffffff,
    WORLD_SIZE * 0.06,
    WORLD_SIZE * 0.035
  );
  scene.add(launchArrow);

  // Placed off to the side of the launch point, clear of the flight path and of
  // the arrows that start there.
  const launchLabel = makeLabel("v = " + result.velocity + " m/s", "#e8eeff");
  launchLabel.position.set(
    -WORLD_SIZE * 0.22,
    Math.sin(angleRadians) * WORLD_SIZE * 0.34 + WORLD_SIZE * 0.06,
    WORLD_SIZE * 0.1
  );
  scene.add(launchLabel);

  // --- The projectile, with three arrows that travel along with it ---
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(WORLD_SIZE * 0.022, 24, 16),
    glowMaterial(COLOR.ball)
  );
  scene.add(ball);

  // Arrow lengths are speeds, so they need their own scale.
  const startSpeed = readVelocity(points, result.flight_time, 0);
  const fastest = Math.max(
    Math.abs(startSpeed.horizontal),
    Math.abs(startSpeed.vertical),
    1
  );
  const speedScale = (WORLD_SIZE * 0.3) / fastest;

  function makeArrow(color) {
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      1,
      color,
      WORLD_SIZE * 0.045,
      WORLD_SIZE * 0.028
    );
    scene.add(arrow);
    return arrow;
  }

  flight = {
    points: curvePoints,
    result: result,
    worldScale: worldScale,
    speedScale: speedScale,
    ball: ball,
    horizontalArrow: makeArrow(COLOR.horizontal),
    verticalArrow: makeArrow(COLOR.vertical),
    gravityArrow: makeArrow(COLOR.gravity),
    // A very short flight would be over before you noticed it.
    duration: Math.max(result.flight_time, 1.2),
    startedAt: 0,
  };

  // Point the camera at the middle of the action.
  view.target.set(middleOfFlight, apex.y * 0.8, 0);
  view.distance = WORLD_SIZE * 1.75;
  view.yaw = -0.55;
  view.pitch = 0.28;
  view.autoRotate = true;
}

/* ---------- Per-frame updates ---------- */

function moveProjectile(elapsedSeconds) {
  const points = flight.points;
  const total = points.length - 1;

  // Loop the flight, with a short pause on the ground before the next launch.
  const pause = 0.7;
  const cycle = flight.duration + pause;
  const timeInCycle = elapsedSeconds % cycle;
  const fraction = Math.min(timeInCycle / flight.duration, 1);

  // Walk along the list of points and smooth between the two nearest ones.
  const exact = fraction * total;
  const index = Math.min(Math.floor(exact), total);
  const nextIndex = Math.min(index + 1, total);
  const blend = exact - index;

  const position = points[index].clone().lerp(points[nextIndex], blend);
  flight.ball.position.copy(position);

  // Speeds measured from the backend points.
  const speed = readVelocity(flight.result.trajectory, flight.result.flight_time, index);
  const horizontalLength = Math.abs(speed.horizontal) * flight.speedScale;
  const verticalLength = Math.abs(speed.vertical) * flight.speedScale;
  const headLength = WORLD_SIZE * 0.045;
  const headWidth = WORLD_SIZE * 0.028;
  const minimum = WORLD_SIZE * 0.02;

  // Horizontal arrow: same length for the whole flight, because nothing
  // speeds the object up or slows it down sideways.
  flight.horizontalArrow.position.copy(position);
  flight.horizontalArrow.setDirection(new THREE.Vector3(1, 0, 0));
  flight.horizontalArrow.setLength(
    Math.max(horizontalLength, minimum),
    headLength,
    headWidth
  );
  flight.horizontalArrow.visible = horizontalLength > minimum;

  // Vertical arrow: long going up, zero at the top, long again coming down.
  flight.verticalArrow.position.copy(position);
  flight.verticalArrow.setDirection(
    new THREE.Vector3(0, speed.vertical >= 0 ? 1 : -1, 0)
  );
  flight.verticalArrow.setLength(
    Math.max(verticalLength, 0.001),
    headLength,
    headWidth
  );
  flight.verticalArrow.visible = verticalLength > minimum;

  // Gravity arrow: always the same, always downward. It is nudged sideways so
  // it does not sit exactly on top of the violet vertical arrow.
  flight.gravityArrow.position.copy(position);
  flight.gravityArrow.position.z += WORLD_SIZE * 0.05;
  flight.gravityArrow.setDirection(new THREE.Vector3(0, -1, 0));
  flight.gravityArrow.setLength(WORLD_SIZE * 0.16, headLength, headWidth);
}

function placeCamera() {
  // Turn the two angles and the distance into an x, y, z position.
  const flat = Math.cos(view.pitch) * view.distance;
  camera.position.set(
    view.target.x + Math.sin(view.yaw) * flat,
    view.target.y + Math.sin(view.pitch) * view.distance,
    view.target.z + Math.cos(view.yaw) * flat
  );
  camera.lookAt(view.target);
}

function renderFrame() {
  requestAnimationFrame(renderFrame);

  if (!flight || !renderer) {
    return;
  }

  const elapsed = clock.getElapsedTime() - flight.startedAt;

  // Gentle turntable spin until the user drags the view themselves.
  if (view.autoRotate) {
    view.yaw += 0.0015;
  }

  moveProjectile(elapsed);
  placeCamera();
  renderer.render(scene, camera);
}

/* ---------- Mouse, touch, and resize ---------- */

function connectControls(wrap) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  wrap.addEventListener("pointerdown", function (event) {
    dragging = true;
    view.autoRotate = false; // the user is steering now
    lastX = event.clientX;
    lastY = event.clientY;
    wrap.setPointerCapture(event.pointerId);
  });

  wrap.addEventListener("pointermove", function (event) {
    if (!dragging) {
      return;
    }
    view.yaw -= (event.clientX - lastX) * 0.007;
    view.pitch += (event.clientY - lastY) * 0.005;

    // Stop the camera from flipping over the top or under the floor.
    view.pitch = Math.max(0.03, Math.min(1.3, view.pitch));
    lastX = event.clientX;
    lastY = event.clientY;
  });

  function stopDragging(event) {
    dragging = false;
    if (event.pointerId !== undefined && wrap.hasPointerCapture(event.pointerId)) {
      wrap.releasePointerCapture(event.pointerId);
    }
  }

  wrap.addEventListener("pointerup", stopDragging);
  wrap.addEventListener("pointercancel", stopDragging);

  wrap.addEventListener(
    "wheel",
    function (event) {
      event.preventDefault();
      view.distance += event.deltaY * 0.05;
      view.distance = Math.max(WORLD_SIZE * 0.7, Math.min(WORLD_SIZE * 4, view.distance));
    },
    { passive: false }
  );
}

function resize(wrap) {
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;

  if (!renderer || width === 0 || height === 0) {
    return;
  }

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

/* ---------- Start up ---------- */

const wrap = document.getElementById("scene-wrap");
const canvas = document.getElementById("scene-canvas");
const message = document.getElementById("scene-message");
const replayButton = document.getElementById("replay-button");

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
  wrap.hidden = true;
  replayButton.hidden = true;
}

try {
  renderer = createRenderer(canvas);
  camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, WORLD_SIZE * 12);
  clock = new THREE.Clock();

  connectControls(wrap);
  new ResizeObserver(function () {
    resize(wrap);
  }).observe(wrap);

  replayButton.addEventListener("click", function () {
    if (flight) {
      flight.startedAt = clock.getElapsedTime();
    }
  });

  renderFrame();

  // script.js calls this after every successful calculation.
  window.projectileScene = {
    show: function (result) {
      // A flat 0 degree launch never leaves the ground, so there is no flight.
      if (result.trajectory.length < 2 || result.flight_time <= 0) {
        flight = null;
        showMessage(
          "A 0\u00B0 launch points along the ground, so the object never leaves it. " +
            "Try an angle between 1\u00B0 and 90\u00B0 to see the 3D flight."
        );
        return;
      }

      buildScene(result);
      flight.startedAt = clock.getElapsedTime();

      message.hidden = true;
      wrap.hidden = false;
      replayButton.hidden = false;
      resize(wrap);
    },
  };
} catch (error) {
  // Most likely no WebGL support. The rest of the page still works.
  showMessage(
    "The 3D view could not start in this browser, but the results and the 2D graph still work."
  );
}
