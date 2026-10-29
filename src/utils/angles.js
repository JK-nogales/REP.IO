export const LANDMARK = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

export function angleAtPoint(a, b, c) {
  if (!a || !b || !c) return null;
  const first = { x: a.x - b.x, y: a.y - b.y };
  const second = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  if (!denominator) return null;
  const cosine = (first.x * second.x + first.y * second.y) / denominator;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

export function trunkLeanDegrees(shoulder, hip) {
  if (!shoulder || !hip) return null;
  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  if (Math.hypot(dx, dy) === 0) return null;
  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
}

export function getJointAngles(landmarks) {
  const point = (name) => landmarks[LANDMARK[name]];
  const sideAngles = (side) => ({
    knee: angleAtPoint(point(`${side}Hip`), point(`${side}Knee`), point(`${side}Ankle`)),
    hip: angleAtPoint(point(`${side}Shoulder`), point(`${side}Hip`), point(`${side}Knee`)),
    elbow: angleAtPoint(point(`${side}Shoulder`), point(`${side}Elbow`), point(`${side}Wrist`)),
    confidence: ['Shoulder', 'Hip', 'Knee', 'Ankle', 'Elbow', 'Wrist']
      .map((joint) => landmarks[LANDMARK[`${side}${joint}`]]?.visibility ?? 0)
      .reduce((sum, value) => sum + value, 0) / 6,
  });

  return {
    left: sideAngles('left'),
    right: sideAngles('right'),
    leftTrunk: trunkLeanDegrees(point('leftShoulder'), point('leftHip')),
    rightTrunk: trunkLeanDegrees(point('rightShoulder'), point('rightHip')),
  };
}

export function smoothAngleValues(values, history, windowSize = 5) {
  const next = {};
  const smoothed = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      next[key] = [];
      smoothed[key] = null;
      continue;
    }
    const samples = [...(history[key] ?? []), value].slice(-windowSize);
    next[key] = samples;
    smoothed[key] = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  }
  return { values: smoothed, history: next };
}