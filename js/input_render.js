function pointer_position(event) {
  const rect = scene_canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function distance_to_segment(point, a, b) {
  const ab_x = b.x - a.x;
  const ab_y = b.y - a.y;
  const length_squared = ab_x * ab_x + ab_y * ab_y;

  if (length_squared <= 1e-12) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = clamp(((point.x - a.x) * ab_x + (point.y - a.y) * ab_y) / length_squared, 0, 1);
  const closest_x = a.x + ab_x * t;
  const closest_y = a.y + ab_y * t;
  return Math.hypot(point.x - closest_x, point.y - closest_y);
}

function hit_test(pointer) {
  const state = get_display_state();
  const joints = get_world_joints(state.theta).map(world_to_screen);

  for (let joint = joints.length - 1; joint >= 0; joint -= 1) {
    if (Math.hypot(pointer.x - joints[joint].x, pointer.y - joints[joint].y) <= HIT_RADIUS) {
      return { type: "joint", index: joint };
    }
  }

  for (let link = links.length - 1; link >= 0; link -= 1) {
    if (distance_to_segment(pointer, joints[link], joints[link + 1]) <= 9) {
      return { type: "link", index: link };
    }
  }

  return null;
}

function begin_pointer_action(event) {
  const pointer = pointer_position(event);
  pointer_start = { ...pointer };
  pointer_current = { ...pointer };
  active_pointer_id = event.pointerId;

  if (event.button === 1) {
    event.preventDefault();
    pointer_action = "pan";
    pan_start_anchor = { ...anchor };
    scene_canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (event.button !== 0 || history_preview_index >= 0) {
    active_pointer_id = null;
    return;
  }

  const hit = hit_test(pointer);

  if (hit?.type === "link") {
    select_link(hit.index);
  } else if (hit?.type === "joint" && hit.index > 0) {
    select_link(hit.index - 1);
  }

  if (interaction_mode_input.value === "edit" && !is_running && hit?.type === "joint" && hit.index > 0) {
    pointer_action = "edit_joint";
    edit_joint_index = hit.index;
    scene_canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (interaction_mode_input.value === "construct") {
    const state = get_display_state();
    const tip_screen = world_to_screen(current_tip_world(state.theta));
    if (Math.hypot(pointer.x - tip_screen.x, pointer.y - tip_screen.y) <= HIT_RADIUS + 5) {
      pointer_action = "construct";
      construct_source_world = current_tip_world(state.theta);
      construct_source_screen = world_to_screen(construct_source_world);
      was_running_before_action = is_running;
      is_running = false;
      play_button.textContent = "play";
      scene_canvas.setPointerCapture(event.pointerId);
      return;
    }
  }

  pointer_action = "select";
}

function update_pointer_action(event) {
  if (event.pointerId !== active_pointer_id) {
    return;
  }

  pointer_current = pointer_position(event);

  if (pointer_action === "pan") {
    anchor.x = pan_start_anchor.x + (pointer_current.x - pointer_start.x);
    anchor.y = pan_start_anchor.y + (pointer_current.y - pointer_start.y);
    request_trail_redraw();
    return;
  }

  if (pointer_action === "edit_joint" && edit_joint_index > 0) {
    const state = get_display_state();
    const joints = get_world_joints(state.theta);
    const previous_joint = joints[edit_joint_index - 1];
    const pointer_world = screen_to_world(pointer_current);
    const dx = pointer_world.x - previous_joint.x;
    const dy = pointer_world.y - previous_joint.y;
    links[edit_joint_index - 1].theta = Math.atan2(dx, dy);
    links[edit_joint_index - 1].omega = 0;
    model_cache = null;
    reset_trace_cursors();
  }
}

function end_pointer_action(event) {
  if (event.pointerId !== active_pointer_id) {
    return;
  }

  pointer_current = pointer_position(event);

  if (pointer_action === "construct") {
    const pointer_world = screen_to_world(pointer_current);
    const dx_world = pointer_world.x - construct_source_world.x;
    const dy_world = pointer_world.y - construct_source_world.y;
    const length = Math.hypot(dx_world, dy_world);
    const screen_length = length * pixels_per_meter;

    if (screen_length >= 12 && links.length < MAX_LINKS) {
      const clamped_length = clamp(length, MIN_LINK_LENGTH, MAX_LINK_LENGTH);
      const theta = Math.atan2(dx_world, dy_world);
      length_input.value = String(clamp(clamped_length, Number(length_input.min), Number(length_input.max)));
      sync_control_outputs();
      add_link(clamped_length, theta);
    }

    if (was_running_before_action) {
      is_running = true;
      play_button.textContent = "pause";
    }
  } else if (pointer_action === "edit_joint") {
    clear_history();
    reset_energy_reference();
    record_history(true);
  }

  if (scene_canvas.hasPointerCapture(event.pointerId)) {
    scene_canvas.releasePointerCapture(event.pointerId);
  }

  pointer_action = "none";
  active_pointer_id = null;
  edit_joint_index = -1;
}

function cancel_pointer_action(event) {
  if (event.pointerId !== active_pointer_id) {
    return;
  }

  if (pointer_action === "construct" && was_running_before_action) {
    is_running = true;
    play_button.textContent = "pause";
  }

  pointer_action = "none";
  active_pointer_id = null;
  edit_joint_index = -1;
}

function zoom_at_pointer(event) {
  event.preventDefault();
  const pointer = pointer_position(event);
  const world_before = screen_to_world(pointer);
  const zoom_factor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
  const new_scale = clamp(pixels_per_meter * zoom_factor, MIN_PIXELS_PER_METER, MAX_PIXELS_PER_METER);

  if (Math.abs(new_scale - pixels_per_meter) < 1e-9) {
    return;
  }

  pixels_per_meter = new_scale;
  anchor.x = pointer.x - world_before.x * pixels_per_meter;
  anchor.y = pointer.y - world_before.y * pixels_per_meter;
  request_trail_redraw();
}

function draw_scene() {
  scene_ctx.setTransform(1, 0, 0, 1, 0, 0);
  scene_ctx.clearRect(0, 0, scene_canvas.width, scene_canvas.height);
  scene_ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const state = get_display_state();
  const joints_world = get_world_joints(state.theta);
  const joints = joints_world.map(world_to_screen);
  draw_anchor(joints[0]);

  if (links.length > 0) {
    draw_chain(joints, state);
    draw_overlays(joints_world, joints, state);
  }

  if (pointer_action === "construct") {
    draw_construct_preview();
  }
}

function draw_anchor(point) {
  scene_ctx.save();
  scene_ctx.beginPath();
  scene_ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
  scene_ctx.fillStyle = "#151618";
  scene_ctx.fill();
  scene_ctx.strokeStyle = "#595d62";
  scene_ctx.lineWidth = 1;
  scene_ctx.stroke();

  scene_ctx.beginPath();
  scene_ctx.arc(point.x, point.y, 4.3, 0, Math.PI * 2);
  scene_ctx.fillStyle = "#f28c28";
  scene_ctx.fill();
  scene_ctx.restore();
}

function draw_chain(joints, state) {
  scene_ctx.save();
  scene_ctx.lineCap = "round";
  scene_ctx.lineJoin = "round";

  for (let i = 0; i < links.length; i += 1) {
    const a = joints[i];
    const b = joints[i + 1];
    const selected = i === selected_link_index;

    scene_ctx.lineWidth = selected ? 9 : 7;
    scene_ctx.strokeStyle = selected ? "rgba(242,140,40,.45)" : "#101113";
    scene_ctx.beginPath();
    scene_ctx.moveTo(a.x, a.y);
    scene_ctx.lineTo(b.x, b.y);
    scene_ctx.stroke();

    scene_ctx.lineWidth = selected ? 3.8 : 3.2;
    scene_ctx.strokeStyle = selected ? "#f0a04a" : "#aeb3b8";
    scene_ctx.beginPath();
    scene_ctx.moveTo(a.x, a.y);
    scene_ctx.lineTo(b.x, b.y);
    scene_ctx.stroke();

    const bob_radius = clamp(5.2 + Math.sqrt(links[i].bob_mass) * 4, 5.5, 13);
    scene_ctx.beginPath();
    scene_ctx.arc(b.x, b.y, bob_radius + 2, 0, Math.PI * 2);
    scene_ctx.fillStyle = "#111214";
    scene_ctx.fill();

    scene_ctx.beginPath();
    scene_ctx.arc(b.x, b.y, bob_radius, 0, Math.PI * 2);
    scene_ctx.fillStyle = i === links.length - 1 ? "#d17922" : "#737980";
    scene_ctx.fill();

    scene_ctx.beginPath();
    scene_ctx.arc(b.x - bob_radius * 0.24, b.y - bob_radius * 0.24, bob_radius * 0.25, 0, Math.PI * 2);
    scene_ctx.fillStyle = "rgba(255,255,255,.24)";
    scene_ctx.fill();
  }

  if (interaction_mode_input.value === "construct" && history_preview_index < 0) {
    const tip = joints[joints.length - 1];
    scene_ctx.beginPath();
    scene_ctx.arc(tip.x, tip.y, 15, 0, Math.PI * 2);
    scene_ctx.strokeStyle = "rgba(242,140,40,.26)";
    scene_ctx.lineWidth = 1;
    scene_ctx.stroke();
  }

  scene_ctx.restore();
}

function draw_construct_preview() {
  const source_screen = world_to_screen(construct_source_world);
  const pointer_world = screen_to_world(pointer_current);
  const dx_world = pointer_world.x - construct_source_world.x;
  const dy_world = pointer_world.y - construct_source_world.y;
  const length = Math.hypot(dx_world, dy_world);

  scene_ctx.save();
  scene_ctx.setLineDash([5, 5]);
  scene_ctx.lineWidth = 1.5;
  scene_ctx.strokeStyle = "rgba(242,140,40,.95)";
  scene_ctx.beginPath();
  scene_ctx.moveTo(source_screen.x, source_screen.y);
  scene_ctx.lineTo(pointer_current.x, pointer_current.y);
  scene_ctx.stroke();
  scene_ctx.setLineDash([]);

  scene_ctx.beginPath();
  scene_ctx.arc(pointer_current.x, pointer_current.y, 6, 0, Math.PI * 2);
  scene_ctx.fillStyle = "#f28c28";
  scene_ctx.fill();

  const label = `${length.toFixed(2)} m`;
  scene_ctx.font = "11px Inter, system-ui, sans-serif";
  const metrics = scene_ctx.measureText(label);
  const x = pointer_current.x + 12;
  const y = pointer_current.y - 30;
  scene_ctx.fillStyle = "rgba(23,24,26,.94)";
  scene_ctx.fillRect(x, y, metrics.width + 14, 24);
  scene_ctx.fillStyle = "#e7e8ea";
  scene_ctx.fillText(label, x + 7, y + 16);
  scene_ctx.restore();
}

function draw_overlays(joints_world, joints_screen, state) {
  if (show_com_input.checked) {
    draw_center_of_mass(state.theta);
  }

  if (show_velocity_input.checked) {
    draw_velocity_vectors(joints_screen, state);
  }

  if (show_angular_input.checked) {
    draw_angular_velocity(joints_screen, state.omega);
  }

  if (show_energy_input.checked) {
    draw_energy_panel(state);
  }
}

function draw_center_of_mass(theta) {
  const center = world_to_screen(get_center_of_mass(theta));
  scene_ctx.save();
  scene_ctx.strokeStyle = "#64b5f6";
  scene_ctx.fillStyle = "rgba(100,181,246,.18)";
  scene_ctx.lineWidth = 1.4;
  scene_ctx.beginPath();
  scene_ctx.arc(center.x, center.y, 8, 0, Math.PI * 2);
  scene_ctx.fill();
  scene_ctx.stroke();
  scene_ctx.beginPath();
  scene_ctx.moveTo(center.x - 12, center.y);
  scene_ctx.lineTo(center.x + 12, center.y);
  scene_ctx.moveTo(center.x, center.y - 12);
  scene_ctx.lineTo(center.x, center.y + 12);
  scene_ctx.stroke();
  scene_ctx.restore();
}

function draw_velocity_vectors(joints_screen, state) {
  const velocities = get_joint_velocities(state.theta, state.omega);
  scene_ctx.save();
  scene_ctx.strokeStyle = "#6dcf8b";
  scene_ctx.fillStyle = "#6dcf8b";
  scene_ctx.lineWidth = 1.3;

  for (let i = 1; i < velocities.length; i += 1) {
    const start = joints_screen[i];
    const scale = clamp(28 / Math.max(1, Math.hypot(velocities[i].x, velocities[i].y)), 4, 18);
    const end = {
      x: start.x + velocities[i].x * scale,
      y: start.y + velocities[i].y * scale
    };
    draw_arrow(scene_ctx, start, end);
  }

  scene_ctx.restore();
}

function draw_arrow(ctx, start, end) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const head = 5;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle - 0.55) * head, end.y - Math.sin(angle - 0.55) * head);
  ctx.lineTo(end.x - Math.cos(angle + 0.55) * head, end.y - Math.sin(angle + 0.55) * head);
  ctx.closePath();
  ctx.fill();
}

function draw_angular_velocity(joints, omega) {
  scene_ctx.save();
  scene_ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  scene_ctx.fillStyle = "#d8c27a";

  for (let i = 0; i < links.length; i += 1) {
    const x = (joints[i].x + joints[i + 1].x) * 0.5 + 7;
    const y = (joints[i].y + joints[i + 1].y) * 0.5 - 7;
    scene_ctx.fillText(`ω ${omega[i].toFixed(2)}`, x, y);
  }

  scene_ctx.restore();
}

function draw_energy_panel(state) {
  const kinetic = kinetic_energy(state.theta, state.omega);
  const potential = potential_energy(state.theta);
  const total = kinetic + potential;
  const x = 12;
  const y = 12;
  const width = 174;
  const height = 66;

  scene_ctx.save();
  scene_ctx.fillStyle = "rgba(26,27,29,.9)";
  scene_ctx.strokeStyle = "#34373b";
  scene_ctx.fillRect(x, y, width, height);
  scene_ctx.strokeRect(x, y, width, height);
  scene_ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  scene_ctx.fillStyle = "#c7c9cc";
  scene_ctx.fillText(`kinetic   ${kinetic.toFixed(4)} j`, x + 9, y + 18);
  scene_ctx.fillText(`potential ${potential.toFixed(4)} j`, x + 9, y + 35);
  scene_ctx.fillStyle = "#f0a04a";
  scene_ctx.fillText(`total     ${total.toFixed(4)} j`, x + 9, y + 52);
  scene_ctx.restore();
}

function resize_canvases() {
  const rect = canvas_wrap.getBoundingClientRect();
  const old_width = css_width;
  const old_height = css_height;
  css_width = Math.max(1, rect.width);
  css_height = Math.max(1, rect.height);
  dpr = clamp(window.devicePixelRatio || 1, 1, 2);

  trail_canvas.width = Math.round(css_width * dpr);
  trail_canvas.height = Math.round(css_height * dpr);
  scene_canvas.width = Math.round(css_width * dpr);
  scene_canvas.height = Math.round(css_height * dpr);

  if (old_width <= 1 || old_height <= 1) {
    anchor = { x: css_width * 0.5, y: Math.max(60, css_height * 0.18) };
  } else {
    anchor.x += (css_width - old_width) * 0.5;
    anchor.y += (css_height - old_height) * 0.5;
  }

  request_trail_redraw();
}

function sync_control_outputs() {
  length_output.textContent = `${Number(length_input.value).toFixed(2)} m`;
  gravity_output.textContent = `${Number(gravity_input.value).toFixed(2)} m/s²`;
  density_output.textContent = `${Number(density_input.value).toFixed(2)} kg/m`;
  bob_mass_output.textContent = `${Number(bob_mass_input.value).toFixed(2)} kg`;
  time_scale_output.textContent = `${Number(time_scale_input.value).toFixed(2)}×`;
  bearing_friction_output.textContent = Number(bearing_friction_input.value).toFixed(4);
  air_drag_output.textContent = Number(air_drag_input.value).toFixed(4);
  dot_spacing_output.textContent = `${Number(dot_spacing_input.value).toFixed(3)} m`;
  dot_size_output.textContent = `${Number(dot_size_input.value).toFixed(1)} px`;
}

function update_ui() {
  link_count.textContent = String(links.length);
  trace_count_output.textContent = trace_dots.length.toLocaleString();
  empty_hint.style.opacity = links.length === 0 ? "1" : "0";

  const state = get_display_state();
  sim_time_output.textContent = state.time.toFixed(2);

  if (links.length === 0 || Math.abs(energy_reference) < 1e-12 || !is_lossless()) {
    energy_drift_output.textContent = "0.0000";
  } else {
    const current_energy = total_energy();
    const drift = Math.abs((current_energy - energy_reference) / energy_reference) * 100;
    energy_drift_output.textContent = Number.isFinite(drift) ? drift.toFixed(4) : "0.0000";
  }

  undo_link_button.disabled = links.length === 0;
  clear_all_button.disabled = links.length === 0 && trace_dots.length === 0;
  restart_button.disabled = links.length === 0;
  fit_chain_button.disabled = links.length === 0;
  fit_trace_button.disabled = trace_dots.length === 0;
  export_png_button.disabled = trace_dots.length === 0;
  export_svg_button.disabled = trace_dots.length === 0;
  energy_lock_input.disabled = !is_lossless();
  sync_history_controls();
}
