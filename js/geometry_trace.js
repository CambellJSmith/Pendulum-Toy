function get_world_joints(theta = links.map((link) => link.theta)) {
  const joints = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;

  for (let i = 0; i < links.length; i += 1) {
    x += links[i].length * Math.sin(theta[i]);
    y += links[i].length * Math.cos(theta[i]);
    joints.push({ x, y });
  }

  return joints;
}

function get_joint_velocities(theta, omega) {
  const velocities = [{ x: 0, y: 0 }];
  let vx = 0;
  let vy = 0;

  for (let i = 0; i < links.length; i += 1) {
    vx += links[i].length * Math.cos(theta[i]) * omega[i];
    vy -= links[i].length * Math.sin(theta[i]) * omega[i];
    velocities.push({ x: vx, y: vy });
  }

  return velocities;
}

function get_center_of_mass(theta) {
  if (links.length === 0) {
    return { x: 0, y: 0, mass: 0 };
  }

  const joints = get_world_joints(theta);
  let weighted_x = 0;
  let weighted_y = 0;
  let total_mass = 0;

  for (let i = 0; i < links.length; i += 1) {
    const rod_mass = links[i].density * links[i].length;
    const rod_center = {
      x: (joints[i].x + joints[i + 1].x) * 0.5,
      y: (joints[i].y + joints[i + 1].y) * 0.5
    };

    weighted_x += rod_center.x * rod_mass;
    weighted_y += rod_center.y * rod_mass;
    total_mass += rod_mass;

    weighted_x += joints[i + 1].x * links[i].bob_mass;
    weighted_y += joints[i + 1].y * links[i].bob_mass;
    total_mass += links[i].bob_mass;
  }

  return {
    x: weighted_x / Math.max(total_mass, 1e-12),
    y: weighted_y / Math.max(total_mass, 1e-12),
    mass: total_mass
  };
}

function world_to_screen(point) {
  return {
    x: anchor.x + point.x * pixels_per_meter,
    y: anchor.y + point.y * pixels_per_meter
  };
}

function screen_to_world(point) {
  return {
    x: (point.x - anchor.x) / pixels_per_meter,
    y: (point.y - anchor.y) / pixels_per_meter
  };
}

function current_tip_world(theta = links.map((link) => link.theta)) {
  const joints = get_world_joints(theta);
  return joints[joints.length - 1];
}

function get_display_state() {
  if (history_preview_index >= 0 && history[history_preview_index]) {
    return history[history_preview_index];
  }

  return {
    time: sim_time,
    theta: links.map((link) => link.theta),
    omega: links.map((link) => link.omega)
  };
}

function get_bounds(points) {
  if (points.length === 0) {
    return null;
  }

  let min_x = points[0].x;
  let max_x = points[0].x;
  let min_y = points[0].y;
  let max_y = points[0].y;

  for (let i = 1; i < points.length; i += 1) {
    min_x = Math.min(min_x, points[i].x);
    max_x = Math.max(max_x, points[i].x);
    min_y = Math.min(min_y, points[i].y);
    max_y = Math.max(max_y, points[i].y);
  }

  return { min_x, max_x, min_y, max_y };
}

function fit_bounds(bounds) {
  if (!bounds) {
    return;
  }

  const span_x = Math.max(0.08, bounds.max_x - bounds.min_x);
  const span_y = Math.max(0.08, bounds.max_y - bounds.min_y);
  const padding = 70;
  const available_width = Math.max(120, css_width - padding * 2);
  const available_height = Math.max(120, css_height - padding * 2);
  pixels_per_meter = clamp(
    Math.min(available_width / span_x, available_height / span_y),
    MIN_PIXELS_PER_METER,
    MAX_PIXELS_PER_METER
  );

  const center_x = (bounds.min_x + bounds.max_x) * 0.5;
  const center_y = (bounds.min_y + bounds.max_y) * 0.5;
  anchor.x = css_width * 0.5 - center_x * pixels_per_meter;
  anchor.y = css_height * 0.5 - center_y * pixels_per_meter;
  request_trail_redraw();
}

function fit_chain() {
  const state = get_display_state();
  fit_bounds(get_bounds(get_world_joints(state.theta)));
}

function fit_trace() {
  const cutoff = history_preview_index >= 0 ? history[history_preview_index].time : Infinity;
  const relevant = trace_dots.filter((dot) => dot.time <= cutoff);
  if (relevant.length === 0) {
    fit_chain();
    return;
  }

  fit_bounds(get_bounds(relevant));
}

function reset_trace_cursors() {
  trace_cursors.clear();
  const joints = get_world_joints();

  for (const source of trace_sources) {
    if (joints[source]) {
      trace_cursors.set(source, {
        position: { ...joints[source] },
        distance_since_dot: 0
      });
    }
  }
}

function clear_trace() {
  trace_dots.length = 0;
  reset_trace_cursors();
  request_trail_redraw();
}

function effective_dot_spacing() {
  return dot_spacing;
}

function display_trace_radius(dot) {
  const requested_radius = trace_radius(dot);
  const separation_limited_radius = Math.max(0.22, dot_spacing * pixels_per_meter * 0.34);
  return Math.min(requested_radius, separation_limited_radius);
}

function trace_step(previous_joints, current_joints, current_velocities) {
  if (links.length === 0 || trace_sources.size === 0) {
    return;
  }

  const spacing = effective_dot_spacing();

  for (const source of trace_sources) {
    if (!previous_joints[source] || !current_joints[source]) {
      continue;
    }

    const previous = previous_joints[source];
    const current = current_joints[source];
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= 1e-12) {
      continue;
    }

    let cursor = trace_cursors.get(source);
    if (!cursor) {
      cursor = { position: { ...previous }, distance_since_dot: 0 };
      trace_cursors.set(source, cursor);
    }

    let travelled = 0;
    let distance_until_dot = spacing - cursor.distance_since_dot;

    while (distance - travelled >= distance_until_dot - 1e-12) {
      travelled += distance_until_dot;
      const t = clamp(travelled / distance, 0, 1);
      const point = {
        x: previous.x + dx * t,
        y: previous.y + dy * t
      };
      const velocity = current_velocities[source] ?? { x: 0, y: 0 };
      const speed = Math.hypot(velocity.x, velocity.y);
      emit_trace_dot(point, source, speed);
      cursor.distance_since_dot = 0;
      distance_until_dot = spacing;
    }

    cursor.distance_since_dot += distance - travelled;
    cursor.position = { ...current };
  }
}

function emit_trace_dot(point, joint, speed) {
  const dot = {
    x: point.x,
    y: point.y,
    joint,
    speed,
    time: sim_time
  };

  trace_dots.push(dot);
  if (history_preview_index < 0 && !trail_redraw_requested) {
    draw_trace_dot_on_view(trail_ctx, dot);
  }
}

function trace_color(dot) {
  const mode = color_mode_input.value;

  if (mode === "joint") {
    const hue = (dot.joint * 137.508) % 360;
    return `hsl(${hue.toFixed(1)} 72% 69%)`;
  }

  if (mode === "time") {
    const hue = (dot.time * 24) % 360;
    return `hsl(${hue.toFixed(1)} 78% 68%)`;
  }

  if (mode === "speed") {
    const normalized = clamp(dot.speed / 5, 0, 1);
    const hue = 220 - normalized * 220;
    return `hsl(${hue.toFixed(1)} 82% 67%)`;
  }

  return trace_color_input.value;
}

function trace_radius(dot, base_size = dot_size) {
  if (!velocity_size_input.checked) {
    return base_size;
  }

  return base_size * clamp(0.7 + dot.speed * 0.22, 0.7, 2.2);
}

function draw_dot_shape(ctx, x, y, radius, dot, scale_multiplier = 1) {
  const color = trace_color(dot);
  const style = dot_style_input.value;
  const r = radius * scale_multiplier;

  ctx.beginPath();
  if (style === "square") {
    ctx.fillStyle = color;
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fill();
    return;
  }

  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (style === "hollow") {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.75, r * 0.55);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function draw_trace_dot_on_view(ctx, dot) {
  const screen = world_to_screen(dot);
  const radius = display_trace_radius(dot);

  if (screen.x < -radius * 3 || screen.x > css_width + radius * 3 || screen.y < -radius * 3 || screen.y > css_height + radius * 3) {
    return;
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw_dot_shape(ctx, screen.x, screen.y, radius, dot);
  ctx.restore();
}

function request_trail_redraw() {
  trail_redraw_requested = true;
}

function redraw_trail() {
  trail_ctx.setTransform(1, 0, 0, 1, 0, 0);
  trail_ctx.clearRect(0, 0, trail_canvas.width, trail_canvas.height);
  trail_ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cutoff = history_preview_index >= 0 && history[history_preview_index]
    ? history[history_preview_index].time
    : Infinity;

  for (const dot of trace_dots) {
    if (dot.time > cutoff) {
      continue;
    }

    const screen = world_to_screen(dot);
    const radius = display_trace_radius(dot);
    if (screen.x < -radius * 3 || screen.x > css_width + radius * 3 || screen.y < -radius * 3 || screen.y > css_height + radius * 3) {
      continue;
    }

    draw_dot_shape(trail_ctx, screen.x, screen.y, radius, dot);
  }

  trail_ctx.setTransform(1, 0, 0, 1, 0, 0);
  trail_redraw_requested = false;
}
