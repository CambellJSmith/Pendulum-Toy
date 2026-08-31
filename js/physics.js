function solve_linear_system(matrix, vector) {
  const n = vector.length;
  const augmented = new Array(n);

  for (let row = 0; row < n; row += 1) {
    augmented[row] = matrix[row].slice();
    augmented[row].push(vector[row]);
  }

  for (let pivot = 0; pivot < n; pivot += 1) {
    let best_row = pivot;
    let best_value = Math.abs(augmented[pivot][pivot]);

    for (let row = pivot + 1; row < n; row += 1) {
      const candidate = Math.abs(augmented[row][pivot]);
      if (candidate > best_value) {
        best_value = candidate;
        best_row = row;
      }
    }

    if (best_value < 1e-12) {
      return new Array(n).fill(0);
    }

    if (best_row !== pivot) {
      const temporary = augmented[pivot];
      augmented[pivot] = augmented[best_row];
      augmented[best_row] = temporary;
    }

    const pivot_value = augmented[pivot][pivot];
    for (let column = pivot; column <= n; column += 1) {
      augmented[pivot][column] /= pivot_value;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === pivot) {
        continue;
      }

      const factor = augmented[row][pivot];
      if (Math.abs(factor) < 1e-15) {
        continue;
      }

      for (let column = pivot; column <= n; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function rebuild_model_cache() {
  const n = links.length;
  const coupling = Array.from({ length: n }, () => new Array(n).fill(0));
  const gravity_arm = new Array(n).fill(0);

  for (let body_index = 0; body_index < n; body_index += 1) {
    const link = links[body_index];
    const rod_mass = link.density * link.length;
    const rod_inertia = rod_mass * link.length * link.length / 12;
    const rod_coefficients = new Array(n).fill(0);

    for (let joint_index = 0; joint_index <= body_index; joint_index += 1) {
      rod_coefficients[joint_index] = joint_index < body_index
        ? links[joint_index].length
        : link.length * 0.5;
    }

    accumulate_mass_contribution(coupling, gravity_arm, rod_coefficients, rod_mass);
    coupling[body_index][body_index] += rod_inertia;

    const bob_coefficients = new Array(n).fill(0);
    for (let joint_index = 0; joint_index <= body_index; joint_index += 1) {
      bob_coefficients[joint_index] = links[joint_index].length;
    }

    accumulate_mass_contribution(coupling, gravity_arm, bob_coefficients, link.bob_mass);
  }

  model_cache = { coupling, gravity_arm };
}

function accumulate_mass_contribution(coupling, gravity_arm, coefficients, mass) {
  for (let i = 0; i < coefficients.length; i += 1) {
    const coefficient_i = coefficients[i];
    if (coefficient_i === 0) {
      continue;
    }

    gravity_arm[i] += mass * coefficient_i;
    for (let j = 0; j < coefficients.length; j += 1) {
      const coefficient_j = coefficients[j];
      if (coefficient_j !== 0) {
        coupling[i][j] += mass * coefficient_i * coefficient_j;
      }
    }
  }
}

function compute_accelerations(theta, omega) {
  const n = links.length;
  if (n === 0) {
    return [];
  }

  if (!model_cache) {
    rebuild_model_cache();
  }

  const mass_matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const rhs = new Array(n).fill(0);

  for (let i = 0; i < n; i += 1) {
    let velocity_coupling = 0;

    for (let j = 0; j < n; j += 1) {
      const angle_delta = theta[i] - theta[j];
      mass_matrix[i][j] = model_cache.coupling[i][j] * Math.cos(angle_delta);
      velocity_coupling += model_cache.coupling[i][j] * Math.sin(angle_delta) * omega[j] * omega[j];
    }

    const gravity_term = gravity * model_cache.gravity_arm[i] * Math.sin(theta[i]);
    const bearing_term = bearing_friction * omega[i];
    const air_term = air_drag * Math.pow(links[i].length, 3) * omega[i] * Math.abs(omega[i]);
    rhs[i] = -(velocity_coupling + gravity_term + bearing_term + air_term);
  }

  return solve_linear_system(mass_matrix, rhs);
}

function derivative(theta, omega) {
  return {
    theta: omega.slice(),
    omega: compute_accelerations(theta, omega)
  };
}

function combine_state(base_theta, base_omega, slope, scale) {
  const theta = new Array(base_theta.length);
  const omega = new Array(base_omega.length);

  for (let i = 0; i < base_theta.length; i += 1) {
    theta[i] = base_theta[i] + slope.theta[i] * scale;
    omega[i] = base_omega[i] + slope.omega[i] * scale;
  }

  return { theta, omega };
}

function integrate_rk4(dt) {
  if (links.length === 0) {
    return;
  }

  const theta = links.map((link) => link.theta);
  const omega = links.map((link) => link.omega);
  const k1 = derivative(theta, omega);
  const state_2 = combine_state(theta, omega, k1, dt * 0.5);
  const k2 = derivative(state_2.theta, state_2.omega);
  const state_3 = combine_state(theta, omega, k2, dt * 0.5);
  const k3 = derivative(state_3.theta, state_3.omega);
  const state_4 = combine_state(theta, omega, k3, dt);
  const k4 = derivative(state_4.theta, state_4.omega);

  for (let i = 0; i < links.length; i += 1) {
    links[i].theta += dt * (k1.theta[i] + 2 * k2.theta[i] + 2 * k3.theta[i] + k4.theta[i]) / 6;
    links[i].omega += dt * (k1.omega[i] + 2 * k2.omega[i] + 2 * k3.omega[i] + k4.omega[i]) / 6;
  }

  if (energy_lock_input.checked && is_lossless()) {
    project_energy();
  }
}

function build_mass_matrix(theta) {
  if (!model_cache) {
    rebuild_model_cache();
  }

  const n = links.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      matrix[i][j] = model_cache.coupling[i][j] * Math.cos(theta[i] - theta[j]);
    }
  }

  return matrix;
}

function kinetic_energy(theta, omega) {
  if (links.length === 0) {
    return 0;
  }

  const matrix = build_mass_matrix(theta);
  let kinetic = 0;

  for (let i = 0; i < links.length; i += 1) {
    for (let j = 0; j < links.length; j += 1) {
      kinetic += 0.5 * omega[i] * matrix[i][j] * omega[j];
    }
  }

  return kinetic;
}

function potential_energy(theta) {
  if (links.length === 0) {
    return 0;
  }

  if (!model_cache) {
    rebuild_model_cache();
  }

  let potential = 0;
  for (let i = 0; i < links.length; i += 1) {
    potential -= gravity * model_cache.gravity_arm[i] * Math.cos(theta[i]);
  }

  return potential;
}

function total_energy(theta = links.map((link) => link.theta), omega = links.map((link) => link.omega)) {
  return kinetic_energy(theta, omega) + potential_energy(theta);
}

function is_lossless() {
  return bearing_friction <= 1e-12 && air_drag <= 1e-12;
}

function project_energy() {
  const theta = links.map((link) => link.theta);
  const omega = links.map((link) => link.omega);
  const kinetic = kinetic_energy(theta, omega);
  const desired_kinetic = energy_target - potential_energy(theta);

  if (kinetic <= 1e-14 || desired_kinetic < 0) {
    return;
  }

  const scale = Math.sqrt(desired_kinetic / kinetic);
  if (!Number.isFinite(scale) || scale < 0.94 || scale > 1.06) {
    return;
  }

  for (const link of links) {
    link.omega *= scale;
  }
}

function reset_energy_reference() {
  model_cache = null;
  rebuild_model_cache();
  energy_target = total_energy();
  energy_reference = energy_target;
}
