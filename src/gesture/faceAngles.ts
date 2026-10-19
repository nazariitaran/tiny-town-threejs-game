/**
 * Head yaw and pitch from the Face Landmarker's facial transformation matrix (pure; the worker uses it).
 * The matrix is 4 × 4, column-major, mapping the canonical face (y up, +z out of the face) into camera
 * space (x right in the unmirrored image, y up, the camera looking down −z).
 */

/**
 * Radians, signed like `noseOffset`: yaw > 0 when the head turns to its own right (towards screen right
 * in a mirror), pitch > 0 when it tilts down. 0 is facing the camera, not the player's neutral pose.
 */
export function headAngles(matrix: ArrayLike<number>, out: { yaw: number; pitch: number } = { yaw: 0, pitch: 0 }): { yaw: number; pitch: number } {
  // The face's forward axis in camera space: the matrix's third column.
  const fx = matrix[8];
  const fy = matrix[9];
  const fz = matrix[10];
  const length = Math.hypot(fx, fy, fz);
  if (!(length > 1e-9)) {
    out.yaw = 0;
    out.pitch = 0;
    return out;
  }
  // Turning to the subject's right points the face to image-left (−x); tilting down points it to −y.
  out.yaw = Math.atan2(-fx, fz);
  out.pitch = Math.asin(Math.max(-1, Math.min(1, -fy / length)));
  return out;
}
