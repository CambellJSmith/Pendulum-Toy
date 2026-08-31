function make_link(length, theta) {
  return {
    length: clamp(length, MIN_LINK_LENGTH, MAX_LINK_LENGTH),
    density: default_density,
    bob_mass: default_bob_mass,
    theta,
    omega: 0,
    initial_theta: theta,
    initial_omega: 0
  };
}

function add_link(length, theta) {
  if (links.length >= MAX_LINKS) {
    return;
  }

  const previous_final = links.length;
  const was_all_sources = previous_final > 0
    && trace_sources.size === previous_final
    && Array.from({ length: previous_final }, (_, index) => index + 1).every((joint) => trace_sources.has(joint));
  links.push(make_link(length, theta));

  if (was_all_sources) {
    trace_sources.add(links.length);
  } else if (trace_sources.size === 0 || (trace_sources.size === 1 && trace_sources.has(previous_final))) {
    trace_sources.clear();
    trace_sources.add(links.length);
  }

  selected_link_index = links.length - 1;
  reset_after_structure_change();
}

function add_link_from_control() {
  const length = Number(length_input.value);
  const base_angle = links.length === 0 ? Math.PI * 0.28 : Math.PI * 0.18;
  const direction = links.length % 2 === 0 ? 1 : -1;
  add_link(length, base_angle * direction);
}

function undo_link() {
  if (links.length === 0) {
    return;
  }

  links.pop();
  selected_link_index = Math.min(selected_link_index, links.length - 1);
  sanitize_trace_sources();
  reset_after_structure_change();
}

function delete_from_selected_link() {
  if (selected_link_index < 0 || selected_link_index >= links.length) {
    return;
  }

  links.splice(selected_link_index);
  selected_link_index = Math.min(selected_link_index - 1, links.length - 1);
  sanitize_trace_sources();
  reset_after_structure_change();
}

function clear_everything() {
  links.length = 0;
  trace_sources.clear();
  selected_link_index = -1;
  sim_time = 0;
  accumulator = 0;
  model_cache = null;
  clear_trace();
  clear_history();
  reset_energy_reference();
  rebuild_trace_source_list();
  sync_selected_link_panel();
  update_ui();
}

function restart_motion() {
  for (const link of links) {
    link.theta = link.initial_theta;
    link.omega = link.initial_omega;
  }

  sim_time = 0;
  accumulator = 0;
  history_preview_index = -1;
  clear_trace();
  clear_history();
  reset_energy_reference();
  record_history(true);
  request_trail_redraw();
}

function reset_after_structure_change() {
  model_cache = null;
  history_preview_index = -1;
  clear_history();
  reset_energy_reference();
  reset_trace_cursors();
  record_history(true);
  rebuild_trace_source_list();
  sync_selected_link_panel();
  request_trail_redraw();
  update_ui();
}

function sanitize_trace_sources() {
  for (const source of Array.from(trace_sources)) {
    if (source < 1 || source > links.length) {
      trace_sources.delete(source);
    }
  }

  if (links.length > 0 && trace_sources.size === 0) {
    trace_sources.add(links.length);
  }
}

function select_link(index) {
  selected_link_index = clamp(index, -1, links.length - 1);
  sync_selected_link_panel();
}

function sync_selected_link_panel() {
  const valid = selected_link_index >= 0 && selected_link_index < links.length;
  selected_link_empty.classList.toggle("hidden", valid);
  selected_link_controls.classList.toggle("hidden", !valid);

  if (!valid) {
    selected_link_label.textContent = "none";
    return;
  }

  const link = links[selected_link_index];
  selected_link_label.textContent = `link ${selected_link_index + 1}`;
  selected_length_input.value = link.length.toFixed(4);
  selected_density_input.value = link.density.toFixed(4);
  selected_bob_mass_input.value = link.bob_mass.toFixed(4);
  selected_angle_input.value = radians_to_degrees(link.initial_theta).toFixed(2);
  selected_velocity_input.value = link.initial_omega.toFixed(4);
}

function apply_selected_link() {
  if (selected_link_index < 0 || selected_link_index >= links.length) {
    return;
  }

  const link = links[selected_link_index];
  link.length = clamp(Number(selected_length_input.value), MIN_LINK_LENGTH, MAX_LINK_LENGTH);
  link.density = clamp(Number(selected_density_input.value), 0.001, 10);
  link.bob_mass = clamp(Number(selected_bob_mass_input.value), 0.001, 10);
  link.initial_theta = degrees_to_radians(Number(selected_angle_input.value));
  link.initial_omega = Number(selected_velocity_input.value);

  if (!is_running) {
    link.theta = link.initial_theta;
    link.omega = link.initial_omega;
  }

  model_cache = null;
  clear_history();
  reset_energy_reference();
  reset_trace_cursors();
  record_history(true);
  request_trail_redraw();
  sync_selected_link_panel();
}

function apply_material_preset() {
  const preset = material_presets[material_preset_input.value];
  if (!preset) {
    return;
  }

  default_density = preset.density;
  default_bob_mass = preset.bob_mass;
  density_input.value = String(default_density);
  bob_mass_input.value = String(default_bob_mass);

  if (selected_link_index >= 0 && selected_link_index < links.length) {
    links[selected_link_index].density = preset.density;
    links[selected_link_index].bob_mass = preset.bob_mass;
    model_cache = null;
    clear_history();
    reset_energy_reference();
    record_history(true);
    sync_selected_link_panel();
  }

  sync_control_outputs();
}

function apply_gravity_preset() {
  const preset = gravity_presets[gravity_preset_input.value];
  if (preset === undefined) {
    return;
  }

  gravity = preset;
  gravity_input.value = String(preset);
  clear_history();
  reset_energy_reference();
  record_history(true);
  sync_control_outputs();
}

function rebuild_trace_source_list() {
  trace_source_list.replaceChildren();

  for (let joint = 1; joint <= links.length; joint += 1) {
    const label = document.createElement("label");
    label.className = "trace_source_item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = trace_sources.has(joint);
    checkbox.dataset.joint = String(joint);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        trace_sources.add(joint);
      } else {
        trace_sources.delete(joint);
      }
      reset_trace_cursors();
    });
    const text = document.createElement("span");
    text.textContent = joint === links.length ? `joint ${joint} · tip` : `joint ${joint}`;
    label.append(checkbox, text);
    trace_source_list.append(label);
  }
}

function set_trace_tip_only() {
  trace_sources.clear();
  if (links.length > 0) {
    trace_sources.add(links.length);
  }
  reset_trace_cursors();
  rebuild_trace_source_list();
}

function set_trace_all() {
  trace_sources.clear();
  for (let joint = 1; joint <= links.length; joint += 1) {
    trace_sources.add(joint);
  }
  reset_trace_cursors();
  rebuild_trace_source_list();
}

function clear_history() {
  history.length = 0;
  history_accumulator = 0;
  history_preview_index = -1;
  sync_history_controls();
}

function record_history(force = false) {
  if (links.length === 0) {
    return;
  }

  if (!force && history_accumulator < HISTORY_INTERVAL) {
    return;
  }

  history_accumulator = 0;
  history.push({
    time: sim_time,
    theta: links.map((link) => link.theta),
    omega: links.map((link) => link.omega)
  });
  sync_history_controls();
}

function sync_history_controls() {
  history_slider.max = String(Math.max(0, history.length - 1));
  history_slider.disabled = history.length === 0;

  if (history_preview_index >= 0) {
    history_slider.value = String(history_preview_index);
    const snapshot = history[history_preview_index];
    history_output.textContent = snapshot ? `${snapshot.time.toFixed(2)} s · preview` : "no history";
    history_resume_button.disabled = !snapshot;
  } else {
    history_slider.value = String(Math.max(0, history.length - 1));
    history_output.textContent = history.length > 0 ? `${sim_time.toFixed(2)} s · live` : "no history";
    history_resume_button.disabled = true;
  }
}

function preview_history(index) {
  if (history.length === 0) {
    return;
  }

  history_preview_index = clamp(index, 0, history.length - 1);
  is_running = false;
  play_button.textContent = "play";
  request_trail_redraw();
  sync_history_controls();
}

function return_to_live() {
  history_preview_index = -1;
  request_trail_redraw();
  sync_history_controls();
}

function resume_from_history() {
  if (history_preview_index < 0 || !history[history_preview_index]) {
    return;
  }

  const snapshot = history[history_preview_index];
  for (let i = 0; i < links.length; i += 1) {
    links[i].theta = snapshot.theta[i];
    links[i].omega = snapshot.omega[i];
  }

  sim_time = snapshot.time;
  history.splice(history_preview_index + 1);

  for (let i = trace_dots.length - 1; i >= 0; i -= 1) {
    if (trace_dots[i].time > sim_time) {
      trace_dots.splice(i, 1);
    }
  }

  history_preview_index = -1;
  accumulator = 0;
  reset_trace_cursors();
  reset_energy_reference();
  request_trail_redraw();
  sync_history_controls();
}
