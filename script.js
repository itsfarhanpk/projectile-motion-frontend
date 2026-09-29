/*
  The page collects velocity and angle, sends them to the Flask API,
  then shows the three results, the 3D flight view, and the 2D graph.

  Physics lives in backend/physics.py. This file does not repeat the formulas.
  The 3D view is built in scene3d.js.
*/

// The deployed Flask backend, so the page works without running Python.
// To use a backend on your own computer instead, comment out the first line
// and use the second one. The address must match host and port in app.py.
const API_URL = "https://projectile-motion-backend.vercel.app/calculate";
// const API_URL = "http://127.0.0.1:5000/calculate";

// Colors reused from style.css so the graph matches the rest of the page.
const LINE_COLOR = "#34d399";
const TEXT_COLOR = "#9aa6c4";
const GRID_COLOR = "rgba(255, 255, 255, 0.08)";

// Chart.js object for the current graph. Replaced each time the user calculates.
let trajectoryChart = null;

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("calculator-form");
  form.addEventListener("submit", onSubmit);
});

// Make the graph follow the window size. Without this the canvas can keep the
// width it had when it was created, which makes the page scroll sideways on a
// narrower screen.
window.addEventListener("resize", function () {
  if (trajectoryChart) {
    trajectoryChart.resize();
  }
});

function onSubmit(event) {
  event.preventDefault();

  const velocityInput = document.getElementById("velocity");
  const angleInput = document.getElementById("angle");
  const velocityText = velocityInput.value.trim();
  const angleText = angleInput.value.trim();
  const message = validateInputs(velocityText, angleText);

  if (message) {
    showError(message);
    return;
  }

  // Number() turns the text box values into real numbers for JSON.
  const velocity = Number(velocityText);
  const angle = Number(angleText);
  requestCalculation(velocity, angle);
}

function validateInputs(velocityText, angleText) {
  if (velocityText === "" || angleText === "") {
    return "Please enter both velocity and angle.";
  }

  const velocity = Number(velocityText);
  const angle = Number(angleText);

  if (!Number.isFinite(velocity) || !Number.isFinite(angle)) {
    return "Velocity and angle must be numbers.";
  }

  if (velocity <= 0) {
    return "Velocity must be greater than 0.";
  }

  if (angle < 0 || angle > 90) {
    return "Angle must be between 0 and 90 degrees.";
  }

  return "";
}

async function requestCalculation(velocity, angle) {
  const button = document.getElementById("calculate-button");
  clearError();
  button.disabled = true;
  button.textContent = "Calculating...";

  try {
    // POST sends a JSON body. Flask reads it in app.py with request.get_json().
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        velocity: velocity,
        angle: angle,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.error || "The server could not calculate that launch.");
      return;
    }

    showResults(velocity, angle, data);
    drawTrajectory(data.trajectory || []);

    // The 3D view also needs the launch values, for the angle arc and the
    // "v = ..." label. Everything else it uses comes from the backend.
    show3dView({
      velocity: velocity,
      angle: angle,
      range: data.range,
      max_height: data.max_height,
      flight_time: data.flight_time,
      trajectory: data.trajectory || [],
    });
  } catch (networkError) {
    showError(
      "Could not reach the calculation server. Check your internet connection, " +
        "then try again."
    );
  } finally {
    button.disabled = false;
    button.textContent = "Calculate";
  }
}

function showResults(velocity, angle, data) {
  document.getElementById("result-summary").textContent =
    "Launched at " + velocity + " m/s, " + angle + "\u00B0 above the horizontal.";
  document.getElementById("range-result").textContent =
    Number(data.range).toFixed(2) + " m";
  document.getElementById("height-result").textContent =
    Number(data.max_height).toFixed(2) + " m";
  document.getElementById("time-result").textContent =
    Number(data.flight_time).toFixed(2) + " s";
}

// scene3d.js publishes window.projectileScene once three.js has loaded.
function show3dView(result) {
  const sceneMessage = document.getElementById("scene-message");

  if (!window.projectileScene) {
    sceneMessage.textContent =
      "The 3D view needs the three.js library from the internet. The results and " +
      "the 2D graph below still work without it.";
    sceneMessage.hidden = false;
    return;
  }

  window.projectileScene.show(result);
}

function drawTrajectory(points) {
  const message = document.getElementById("chart-message");
  const chartWrap = document.getElementById("chart-wrap");
  const canvas = document.getElementById("trajectory-chart");

  if (typeof Chart === "undefined") {
    message.hidden = false;
    message.textContent =
      "The graph library did not load. Check your internet connection and refresh the page.";
    chartWrap.hidden = true;
    return;
  }

  if (!points.length) {
    message.hidden = false;
    message.textContent = "No trajectory points were returned.";
    chartWrap.hidden = true;
    return;
  }

  message.hidden = true;
  chartWrap.hidden = false;

  if (trajectoryChart) {
    trajectoryChart.destroy();
  }

  const distances = points.map(function (point) {
    return point.x;
  });
  const heights = points.map(function (point) {
    return point.y;
  });
  const maxDistance = Math.max.apply(null, distances);
  const maxHeight = Math.max.apply(null, heights);

  trajectoryChart = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Projectile path",
          data: points,
          showLine: true,
          borderColor: LINE_COLOR,
          backgroundColor: "rgba(52, 211, 153, 0.16)",
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2.5,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: "rgba(7, 11, 24, 0.92)",
          borderColor: "rgba(255, 255, 255, 0.15)",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function (context) {
              const distance = context.parsed.x.toFixed(2);
              const height = context.parsed.y.toFixed(2);
              return "Distance: " + distance + " m, Height: " + height + " m";
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          // A straight-up launch has x = 0 for every point. Give that axis room.
          suggestedMax: maxDistance === 0 ? 1 : maxDistance * 1.05,
          title: {
            display: true,
            text: "Horizontal Distance (m)",
            color: TEXT_COLOR,
          },
          ticks: {
            color: TEXT_COLOR,
            maxTicksLimit: 8,
          },
          grid: {
            color: GRID_COLOR,
          },
        },
        y: {
          min: 0,
          suggestedMax: maxHeight === 0 ? 1 : maxHeight * 1.1,
          title: {
            display: true,
            text: "Height (m)",
            color: TEXT_COLOR,
          },
          ticks: {
            color: TEXT_COLOR,
          },
          grid: {
            color: GRID_COLOR,
          },
        },
      },
    },
  });
}

function showError(message) {
  const errorBox = document.getElementById("error-message");
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  const errorBox = document.getElementById("error-message");
  errorBox.textContent = "";
  errorBox.hidden = true;
}
