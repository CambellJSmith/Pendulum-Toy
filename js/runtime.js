function download_blob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function save_project() {
  const project = {
    version: 2,
    simulation: {
      gravity,
      time_scale,
      bearing_friction,
      air_drag,
      energy_lock: energy_lock_input.checked,
      sim_time
    },
    defaults: {
      density: default_density,
      bob_mass: default_bob_mass,
      length: Number(length_input.value)
    },
    links: links.map((link) => ({ ...link })),
    trace: {
      spacing: dot_spacing,
      size: dot_size,
      style: dot_style_input.value,
      color_mode: color_mode_input.value,
      color: trace_color_input.value,
      size_by_velocity: velocity_size_input.checked,
      sources: Array.from(trace_sources),
      dots: trace_dots.map((dot) => ({ ...dot }))
    }
  };

  const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
  download_blob(blob, "pendulum_project.json");
}

async function load_project_file(file) {
  const text = await file.text();
  const project = JSON.parse(text);

  if (!project || !Array.isArray(project.links)) {
    throw new Error("invalid pendulum project");
  }

  links.length = 0;
  for (const raw of project.links.slice(0, MAX_LINKS)) {
    links.push({
      length: clamp(Number(raw.length) || 0.45, MIN_LINK_LENGTH, MAX_LINK_LENGTH),
      density: clamp(Number(raw.density) || 0.35, 0.001, 10),
      bob_mass: clamp(Number(raw.bob_mass) || 0.18, 0.001, 10),
      theta: Number(raw.theta) || 0,
      omega: Number(raw.omega) || 0,
      initial_theta: Number(raw.initial_theta) || 0,
      initial_omega: Number(raw.initial_omega) || 0
    });
  }

  gravity = Number(project.simulation?.gravity) || 9.80665;
  time_scale = Number(project.simulation?.time_scale) || 1;
  bearing_friction = Math.max(0, Number(project.simulation?.bearing_friction) || 0);
  air_drag = Math.max(0, Number(project.simulation?.air_drag) || 0);
  sim_time = Math.max(0, Number(project.simulation?.sim_time) || 0);
  energy_lock_input.checked = project.simulation?.energy_lock !== false;

  default_density = Number(project.defaults?.density) || 0.35;
  default_bob_mass = Number(project.defaults?.bob_mass) || 0.18;
  length_input.value = String(project.defaults?.length || 0.45);

  dot_spacing = Number(project.trace?.spacing) || 0.014;
  dot_size = Number(project.trace?.size) || 1.25;
  dot_style_input.value = project.trace?.style || "round";
  color_mode_input.value = project.trace?.color_mode || "single";
  trace_color_input.value = project.trace?.color || "#e6e9ec";
  velocity_size_input.checked = Boolean(project.trace?.size_by_velocity);

  trace_sources.clear();
  for (const source of project.trace?.sources || []) {
    const joint = Number(source);
    if (joint >= 1 && joint <= links.length) {
      trace_sources.add(joint);
    }
  }
  sanitize_trace_sources();

  trace_dots.length = 0;
  for (const raw_dot of project.trace?.dots || []) {
    if (Number.isFinite(Number(raw_dot.x)) && Number.isFinite(Number(raw_dot.y))) {
      trace_dots.push({
        x: Number(raw_dot.x),
        y: Number(raw_dot.y),
        joint: clamp(Number(raw_dot.joint) || 1, 1, Math.max(1, links.length)),
        speed: Math.max(0, Number(raw_dot.speed) || 0),
        time: Math.max(0, Number(raw_dot.time) || 0)
      });
    }
  }

  gravity_input.value = String(gravity);
  time_scale_input.value = String(time_scale);
  bearing_friction_input.value = String(bearing_friction);
  air_drag_input.value = String(air_drag);
  density_input.value = String(default_density);
  bob_mass_input.value = String(default_bob_mass);
  dot_spacing_input.value = String(dot_spacing);
  dot_size_input.value = String(dot_size);

  selected_link_index = links.length > 0 ? 0 : -1;
  model_cache = null;
  accumulator = 0;
  clear_history();
  reset_energy_reference();
  reset_trace_cursors();
  record_history(true);
  rebuild_trace_source_list();
  sync_selected_link_panel();
  sync_control_outputs();
  fit_chain();
  request_trail_redraw();
}

function export_trace_png() {
  if (trace_dots.length === 0) {
    return;
  }

  const bounds = get_bounds(trace_dots);
  const span_x = Math.max(0.01, bounds.max_x - bounds.min_x);
  const span_y = Math.max(0.01, bounds.max_y - bounds.min_y);
  const resolution_multiplier = Number(export_scale_input.value);
  const target_long_side = 1800 * resolution_multiplier;
  const margin = 60 * resolution_multiplier;
  const scale = Math.min(
    (target_long_side - margin * 2) / Math.max(span_x, span_y),
    12000 / Math.max(span_x, span_y)
  );
  const width = Math.max(64, Math.ceil(span_x * scale + margin * 2));
  const height = Math.max(64, Math.ceil(span_y * scale + margin * 2));
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(width, 12000);
  canvas.height = Math.min(height, 12000);
  const ctx = canvas.getContext("2d");

  if (!transparent_export_input.checked) {
    ctx.fillStyle = "#1a1b1d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const actual_scale = Math.min(
    (canvas.width - margin * 2) / span_x,
    (canvas.height - margin * 2) / span_y
  );
  const base_radius = dot_size * resolution_multiplier;

  for (const dot of trace_dots) {
    const x = margin + (dot.x - bounds.min_x) * actual_scale;
    const y = margin + (dot.y - bounds.min_y) * actual_scale;
    draw_dot_shape(ctx, x, y, trace_radius(dot, base_radius), dot);
  }

  canvas.toBlob((blob) => {
    if (blob) {
      download_blob(blob, "pendulum_trace.png");
    }
  }, "image/png");
}

function escape_xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function export_trace_svg() {
  if (trace_dots.length === 0) {
    return;
  }

  const bounds = get_bounds(trace_dots);
  const span_x = Math.max(0.01, bounds.max_x - bounds.min_x);
  const span_y = Math.max(0.01, bounds.max_y - bounds.min_y);
  const margin = Math.max(dot_spacing * 3, 0.02);
  const min_x = bounds.min_x - margin;
  const min_y = bounds.min_y - margin;
  const width = span_x + margin * 2;
  const height = span_y + margin * 2;
  const base_radius = Math.max(dot_spacing * 0.18, 0.001);
  const elements = [];

  for (const dot of trace_dots) {
    const color = escape_xml(trace_color(dot));
    const radius = base_radius * (velocity_size_input.checked ? clamp(0.7 + dot.speed * 0.22, 0.7, 2.2) : 1);

    if (dot_style_input.value === "square") {
      elements.push(`<rect x="${(dot.x - radius).toFixed(6)}" y="${(dot.y - radius).toFixed(6)}" width="${(radius * 2).toFixed(6)}" height="${(radius * 2).toFixed(6)}" fill="${color}"/>`);
    } else if (dot_style_input.value === "hollow") {
      elements.push(`<circle cx="${dot.x.toFixed(6)}" cy="${dot.y.toFixed(6)}" r="${radius.toFixed(6)}" fill="none" stroke="${color}" stroke-width="${Math.max(radius * 0.45, 0.0004).toFixed(6)}"/>`);
    } else {
      elements.push(`<circle cx="${dot.x.toFixed(6)}" cy="${dot.y.toFixed(6)}" r="${radius.toFixed(6)}" fill="${color}"/>`);
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${min_x.toFixed(6)} ${min_y.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}">\n${elements.join("\n")}\n</svg>`;
  download_blob(new Blob([svg], { type: "image/svg+xml" }), "pendulum_trace.svg");
}

function simulate_fixed_step(dt) {
  const previous_joints = get_world_joints();
  integrate_rk4(dt);
  sim_time += dt;
  history_accumulator += dt;
  const current_joints = get_world_joints();
  const current_velocities = get_joint_velocities(
    links.map((link) => link.theta),
    links.map((link) => link.omega)
  );
  trace_step(previous_joints, current_joints, current_velocities);
  record_history();
}

function frame(now) {
  const frame_time = Math.min(MAX_FRAME_TIME, Math.max(0, (now - last_frame_time) / 1000));
  last_frame_time = now;

  if (is_running && links.length > 0 && history_preview_index < 0 && pointer_action !== "construct") {
    accumulator += frame_time * time_scale;
    let steps = 0;
    const maximum_steps = 180;

    while (accumulator >= FIXED_DT && steps < maximum_steps) {
      simulate_fixed_step(FIXED_DT);
      accumulator -= FIXED_DT;
      steps += 1;
    }

    if (steps === maximum_steps) {
      accumulator = 0;
    }
  }

  if (trail_redraw_requested) {
    redraw_trail();
  }

  draw_scene();
  update_ui();
  requestAnimationFrame(frame);
}

play_button.addEventListener("click", () => {
  if (history_preview_index >= 0) {
    return_to_live();
  }
  is_running = !is_running;
  play_button.textContent = is_running ? "pause" : "play";
});
restart_button.addEventListener("click", restart_motion);
clear_trace_button.addEventListener("click", clear_trace);
fit_chain_button.addEventListener("click", fit_chain);
fit_trace_button.addEventListener("click", fit_trace);
add_link_button.addEventListener("click", add_link_from_control);
undo_link_button.addEventListener("click", undo_link);
clear_all_button.addEventListener("click", clear_everything);
apply_link_button.addEventListener("click", apply_selected_link);
reset_link_button.addEventListener("click", sync_selected_link_panel);
delete_from_link_button.addEventListener("click", delete_from_selected_link);
apply_material_preset_button.addEventListener("click", apply_material_preset);
apply_gravity_preset_button.addEventListener("click", apply_gravity_preset);
trace_tip_button.addEventListener("click", set_trace_tip_only);
trace_all_button.addEventListener("click", set_trace_all);
history_live_button.addEventListener("click", return_to_live);
history_resume_button.addEventListener("click", resume_from_history);
save_project_button.addEventListener("click", save_project);
load_project_button.addEventListener("click", () => load_project_input.click());
export_png_button.addEventListener("click", export_trace_png);
export_svg_button.addEventListener("click", export_trace_svg);

history_slider.addEventListener("input", () => preview_history(Number(history_slider.value)));

load_project_input.addEventListener("change", async () => {
  const file = load_project_input.files?.[0];
  if (!file) {
    return;
  }

  try {
    await load_project_file(file);
  } catch (error) {
    window.alert(`could not load project: ${error.message}`);
  } finally {
    load_project_input.value = "";
  }
});

length_input.addEventListener("input", sync_control_outputs);
gravity_input.addEventListener("input", () => {
  gravity = Number(gravity_input.value);
  clear_history();
  reset_energy_reference();
  record_history(true);
  sync_control_outputs();
});
density_input.addEventListener("input", () => {
  default_density = Number(density_input.value);
  sync_control_outputs();
});
bob_mass_input.addEventListener("input", () => {
  default_bob_mass = Number(bob_mass_input.value);
  sync_control_outputs();
});
time_scale_input.addEventListener("input", () => {
  time_scale = Number(time_scale_input.value);
  sync_control_outputs();
});
bearing_friction_input.addEventListener("input", () => {
  bearing_friction = Number(bearing_friction_input.value);
  clear_history();
  reset_energy_reference();
  record_history(true);
  sync_control_outputs();
});
air_drag_input.addEventListener("input", () => {
  air_drag = Number(air_drag_input.value);
  clear_history();
  reset_energy_reference();
  record_history(true);
  sync_control_outputs();
});
dot_spacing_input.addEventListener("input", () => {
  dot_spacing = Number(dot_spacing_input.value);
  reset_trace_cursors();
  sync_control_outputs();
});
dot_size_input.addEventListener("input", () => {
  dot_size = Number(dot_size_input.value);
  reset_trace_cursors();
  request_trail_redraw();
  sync_control_outputs();
});
dot_style_input.addEventListener("change", request_trail_redraw);
color_mode_input.addEventListener("change", request_trail_redraw);
trace_color_input.addEventListener("input", request_trail_redraw);
velocity_size_input.addEventListener("change", request_trail_redraw);

scene_canvas.addEventListener("pointerdown", begin_pointer_action);
scene_canvas.addEventListener("pointermove", update_pointer_action);
scene_canvas.addEventListener("pointerup", end_pointer_action);
scene_canvas.addEventListener("pointercancel", cancel_pointer_action);
scene_canvas.addEventListener("wheel", zoom_at_pointer, { passive: false });
scene_canvas.addEventListener("auxclick", (event) => {
  if (event.button === 1) {
    event.preventDefault();
  }
});
window.addEventListener("resize", resize_canvases);

sync_control_outputs();
resize_canvases();
clear_trace();
clear_history();
reset_energy_reference();
rebuild_trace_source_list();
sync_selected_link_panel();
update_ui();
requestAnimationFrame(frame);
