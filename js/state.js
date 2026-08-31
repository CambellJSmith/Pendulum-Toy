"use strict";

const by_id = (id) => document.getElementById(id);

const trail_canvas = by_id("trail_canvas");
const scene_canvas = by_id("scene_canvas");
const canvas_wrap = by_id("canvas_wrap");
const trail_ctx = trail_canvas.getContext("2d");
const scene_ctx = scene_canvas.getContext("2d");

const play_button = by_id("play_button");
const restart_button = by_id("restart_button");
const clear_trace_button = by_id("clear_trace_button");
const fit_chain_button = by_id("fit_chain_button");
const fit_trace_button = by_id("fit_trace_button");
const add_link_button = by_id("add_link_button");
const undo_link_button = by_id("undo_link_button");
const clear_all_button = by_id("clear_all_button");
const apply_link_button = by_id("apply_link_button");
const reset_link_button = by_id("reset_link_button");
const delete_from_link_button = by_id("delete_from_link_button");
const apply_material_preset_button = by_id("apply_material_preset_button");
const apply_gravity_preset_button = by_id("apply_gravity_preset_button");
const trace_tip_button = by_id("trace_tip_button");
const trace_all_button = by_id("trace_all_button");
const history_live_button = by_id("history_live_button");
const history_resume_button = by_id("history_resume_button");
const save_project_button = by_id("save_project_button");
const load_project_button = by_id("load_project_button");
const export_png_button = by_id("export_png_button");
const export_svg_button = by_id("export_svg_button");

const length_input = by_id("length_input");
const gravity_input = by_id("gravity_input");
const density_input = by_id("density_input");
const bob_mass_input = by_id("bob_mass_input");
const time_scale_input = by_id("time_scale_input");
const bearing_friction_input = by_id("bearing_friction_input");
const air_drag_input = by_id("air_drag_input");
const energy_lock_input = by_id("energy_lock_input");
const dot_spacing_input = by_id("dot_spacing_input");
const dot_size_input = by_id("dot_size_input");
const dot_style_input = by_id("dot_style_input");
const color_mode_input = by_id("color_mode_input");
const trace_color_input = by_id("trace_color_input");
const velocity_size_input = by_id("velocity_size_input");
const interaction_mode_input = by_id("interaction_mode_input");
const material_preset_input = by_id("material_preset_input");
const gravity_preset_input = by_id("gravity_preset_input");
const show_com_input = by_id("show_com_input");
const show_velocity_input = by_id("show_velocity_input");
const show_angular_input = by_id("show_angular_input");
const show_energy_input = by_id("show_energy_input");
const history_slider = by_id("history_slider");
const selected_length_input = by_id("selected_length_input");
const selected_density_input = by_id("selected_density_input");
const selected_bob_mass_input = by_id("selected_bob_mass_input");
const selected_angle_input = by_id("selected_angle_input");
const selected_velocity_input = by_id("selected_velocity_input");
const load_project_input = by_id("load_project_input");
const export_scale_input = by_id("export_scale_input");
const transparent_export_input = by_id("transparent_export_input");

const length_output = by_id("length_output");
const gravity_output = by_id("gravity_output");
const density_output = by_id("density_output");
const bob_mass_output = by_id("bob_mass_output");
const time_scale_output = by_id("time_scale_output");
const bearing_friction_output = by_id("bearing_friction_output");
const air_drag_output = by_id("air_drag_output");
const dot_spacing_output = by_id("dot_spacing_output");
const dot_size_output = by_id("dot_size_output");
const link_count = by_id("link_count");
const sim_time_output = by_id("sim_time");
const energy_drift_output = by_id("energy_drift");
const trace_count_output = by_id("trace_count");
const history_output = by_id("history_output");
const selected_link_label = by_id("selected_link_label");
const selected_link_empty = by_id("selected_link_empty");
const selected_link_controls = by_id("selected_link_controls");
const trace_source_list = by_id("trace_source_list");
const empty_hint = by_id("empty_hint");

const MAX_LINKS = 18;
const FIXED_DT = 1 / 480;
const MAX_FRAME_TIME = 0.05;
const HISTORY_INTERVAL = 1 / 30;
const MIN_LINK_LENGTH = 0.05;
const MAX_LINK_LENGTH = 2.0;
const MIN_PIXELS_PER_METER = 20;
const MAX_PIXELS_PER_METER = 1800;
const ZOOM_SENSITIVITY = 0.0015;
const HIT_RADIUS = 13;

const material_presets = {
  steel: { density: 0.45, bob_mass: 0.22 },
  aluminium: { density: 0.16, bob_mass: 0.11 },
  brass: { density: 0.62, bob_mass: 0.35 },
  carbon: { density: 0.09, bob_mass: 0.08 },
  light: { density: 0.035, bob_mass: 0.025 }
};

const gravity_presets = {
  earth: 9.80665,
  moon: 1.62,
  mars: 3.721,
  jupiter: 24.79
};

const links = [];
const trace_dots = [];
const trace_sources = new Set();
const trace_cursors = new Map();
const history = [];

let gravity = Number(gravity_input.value);
let default_density = Number(density_input.value);
let default_bob_mass = Number(bob_mass_input.value);
let time_scale = Number(time_scale_input.value);
let bearing_friction = Number(bearing_friction_input.value);
let air_drag = Number(air_drag_input.value);
let dot_spacing = Number(dot_spacing_input.value);
let dot_size = Number(dot_size_input.value);

let is_running = true;
let sim_time = 0;
let accumulator = 0;
let history_accumulator = 0;
let last_frame_time = performance.now();
let energy_target = 0;
let energy_reference = 0;
let model_cache = null;
let selected_link_index = -1;
let history_preview_index = -1;

let css_width = 1;
let css_height = 1;
let dpr = 1;
let pixels_per_meter = 240;
let anchor = { x: 0, y: 0 };
let trail_redraw_requested = true;

let pointer_action = "none";
let active_pointer_id = null;
let pointer_start = { x: 0, y: 0 };
let pointer_current = { x: 0, y: 0 };
let pan_start_anchor = { x: 0, y: 0 };
let construct_source_screen = { x: 0, y: 0 };
let construct_source_world = { x: 0, y: 0 };
let edit_joint_index = -1;
let was_running_before_action = false;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function degrees_to_radians(value) {
  return value * Math.PI / 180;
}

function radians_to_degrees(value) {
  return value * 180 / Math.PI;
}
