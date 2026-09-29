# Projectile Motion Calculator — Frontend

The web page for a projectile motion calculator. You enter an initial velocity and a launch angle, and the page shows the horizontal range, the maximum height, the flight time, an interactive 3D flight view, and a 2D trajectory graph.

It is plain HTML, CSS, and vanilla JavaScript. There is no build step and nothing to install.

All the physics is calculated by a Flask API in a separate repository: [projectile-motion-backend](https://github.com/itsfarhanpk/projectile-motion-backend). **The page needs that backend running to produce results.**

## Features

- Inputs for initial velocity (m/s) and launch angle (degrees), with validation in the browser and again on the server
- Range, maximum height, and flight time, colour-matched to the shapes in the 3D scene
- **3D flight view**: rotate by dragging, zoom by scrolling, and watch the projectile fly in real time
- **Velocity arrows** that travel with the projectile and show what gravity actually does
- 2D trajectory graph: horizontal distance on the x-axis, height on the y-axis
- Friendly error messages for bad input, or when the backend is not running

## Files

```text
frontend/
    index.html      Page structure.
    style.css       Dark theme: colors, layout, spacing.
    script.js       Reads the form, calls the API, draws the 2D graph.
    scene3d.js      Builds the 3D flight view with three.js.
```

## How to run

First start the backend from the [backend repository](https://github.com/itsfarhanpk/projectile-motion-backend), so it is listening on `http://127.0.0.1:5000`.

Then serve this folder. Any small static server works; Python has one built in:

```bash
python -m http.server 5500
```

Open:

```text
http://127.0.0.1:5500
```

Use a local server rather than double-clicking `index.html`. `scene3d.js` is a JavaScript module, and browsers block modules on pages opened directly from the file system.

The page and the API are on different ports, which the browser treats as different origins. The backend allows the request with `flask-cors`.

## Pointing at a different backend

The address is one line near the top of `script.js`:

```js
const API_URL = "http://127.0.0.1:5000/calculate";
```

Change it if you run the backend on another port or deploy it somewhere.

## How to read the 3D view

Everything in the scene is drawn from the numbers the backend returned:

| What you see | What it means |
| --- | --- |
| Green tube | The flight path, drawn through the points from the backend |
| Amber ball | The projectile, moving in real time over the flight time |
| Cyan arrow | Horizontal velocity, `v cos θ`. It never changes length |
| Violet arrow | Vertical velocity, `v sin θ`. Zero at the top, then downward |
| Red arrow | Gravity, 9.81 m/s² downward, the only force in this model |
| Cyan ground line | The range |
| Violet upright bar | The maximum height |
| White arrow and arc | The launch velocity and the launch angle |

The point of the scene is the pair of arrows on the ball. The cyan one stays the same length for the whole flight, while the violet one shrinks, disappears at the apex, and grows downward. A constant sideways speed plus a steadily changing vertical speed is exactly what makes the path a parabola. Rotating the camera also shows that the object never leaves one vertical plane, because nothing pushes it sideways.

`scene3d.js` does not contain a second copy of the physics. It receives the path points from Python and measures the arrow lengths from them, by dividing the change in position by the change in time, which is the definition of velocity.

## Technologies

- HTML, CSS, vanilla JavaScript
- [Chart.js](https://www.chartjs.org/) from a CDN, for the 2D graph
- [three.js](https://threejs.org/) from a CDN, for the 3D flight view

Both libraries are loaded as plain `<script>` tags, so an internet connection is needed the first time a browser opens the page. Without it the results still work and the page explains what is missing.

## The physics behind the numbers

Calculated on the server, with `g = 9.81 m/s²`:

```text
Range          = (v² × sin(2θ)) / g
Maximum height = (v² × sin²(θ)) / (2g)
Flight time    = (2 × v × sin(θ)) / g
```

The drawn path is the position at many times `t`:

```text
x = v × cos(θ) × t
y = v × sin(θ) × t − (1/2) × g × t²
```

This is the ideal model: constant gravity, no air resistance, and a landing height equal to the launch height.

## Example

Entering `20` m/s at `45°` gives a range of `40.77 m`, a maximum height of `10.19 m`, and a flight time of `2.88 s`.

Try `30°` and then `60°` at the same speed: two different arcs that land at the same distance.

## Future improvements

- A slider to scrub through the flight instead of only replaying it
- Compare two launches on the same graph
- Unit choices, such as km/h or feet
- Show the ideal parabola next to a path with air resistance
