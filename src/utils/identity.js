const REQUIRED_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const VISIBILITY_THRESHOLD = 0.5;

function distance(first, second) {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}

function angleAtWorldPoint(first, vertex, last) {
  const firstVector = {
    x: first.x - vertex.x,
    y: first.y - vertex.y,
    z: first.z - vertex.z,
  };
  const secondVector = {
    x: last.x - vertex.x,
    y: last.y - vertex.y,
    z: last.z - vertex.z,
  };
  const denominator = distance(firstVector, { x: 0, y: 0, z: 0 }) *
    distance(secondVector, { x: 0, y: 0, z: 0 });
  if (!denominator) return null;
  const cosine = (
    firstVector.x * secondVector.x +
    firstVector.y * secondVector.y +
    firstVector.z * secondVector.z
  ) / denominator;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

function validPoint(point, minimumVisibility = VISIBILITY_THRESHOLD) {
  return point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z) &&
    (point.visibility ?? 1) >= minimumVisibility;
}

function isSideRegistrationPose(landmarks, worldLandmarks) {
  return ['left', 'right'].some((side) => {
    const offset = side === 'right' ? 1 : 0;
    const coreIndices = [11, 23, 25, 27].map((index) => index + offset);
    if (coreIndices.some((index) => (
      !validPoint(landmarks[index], 0.35) || !validPoint(worldLandmarks[index], 0.2)
    ))) return false;

    const shoulderWidth = Math.abs(landmarks[11].x - landmarks[12].x);
    const hipWidth = Math.abs(landmarks[23].x - landmarks[24].x);
    const torsoHeight = Math.abs(landmarks[11].y - landmarks[23].y);
    const looksSideOn = torsoHeight > 0 &&
      Math.max(shoulderWidth, hipWidth) / torsoHeight < 0.7;
    const knee = worldLandmarks[25 + offset];
    const hip = worldLandmarks[23 + offset];
    const ankle = worldLandmarks[27 + offset];
    const kneeAngle = angleAtWorldPoint(hip, knee, ankle);
    return looksSideOn && kneeAngle != null && kneeAngle >= 145;
  });
}

export function isRegistrationPose(landmarks, worldLandmarks, view = 'front') {
  if (!landmarks || !worldLandmarks) return false;
  if (view === 'side') return isSideRegistrationPose(landmarks, worldLandmarks);
  if (REQUIRED_JOINTS.some((index) => (
    !validPoint(landmarks[index]) || !validPoint(worldLandmarks[index])
  ))) return false;

  const torsoLength = (
    distance(worldLandmarks[11], worldLandmarks[23]) +
    distance(worldLandmarks[12], worldLandmarks[24])
  ) / 2;
  if (!Number.isFinite(torsoLength) || torsoLength <= 0) return false;

  return [0, 1].every((side) => {
    const shoulder = worldLandmarks[11 + side];
    const elbow = worldLandmarks[13 + side];
    const wrist = worldLandmarks[15 + side];
    const elbowAngle = angleAtWorldPoint(shoulder, elbow, wrist);
    return elbowAngle != null &&
      elbowAngle >= 140 &&
      Math.abs(elbow.y - shoulder.y) / torsoLength <= 0.35 &&
      Math.abs(wrist.y - shoulder.y) / torsoLength <= 0.45;
  });
}

export function getRegistrationGuidance(landmarks, worldLandmarks, view = 'front') {
  if (!landmarks || !worldLandmarks) return 'Step into view so the camera can see your full body.';

  const shoulders = [landmarks[11], landmarks[12]];
  const ankles = [landmarks[27], landmarks[28]];
  const visibleShoulders = shoulders.filter(validPoint);
  const visibleAnkles = ankles.filter(validPoint);
  if (visibleShoulders.length && visibleAnkles.length) {
    const bodyTop = Math.min(...visibleShoulders.map(({ y }) => y));
    const bodyBottom = Math.max(...visibleAnkles.map(({ y }) => y));
    const bodyHeight = bodyBottom - bodyTop;
    if (bodyHeight < 0.52) return 'Move closer to the camera so your body fills more of the frame.';
    if (
      bodyHeight > 0.88 ||
      bodyTop < 0.025 ||
      bodyBottom > 0.975
    ) return 'Move back from the camera until your full body fits comfortably in frame.';

    if (validPoint(landmarks[23]) && validPoint(landmarks[24])) {
      const bodyCenter = (landmarks[23].x + landmarks[24].x) / 2;
      if (bodyCenter < 0.38 || bodyCenter > 0.62) return 'Move to the center of the camera frame.';
    }
  } else {
    return 'Move back until your head, body, and both feet are visible.';
  }

  if (view === 'side') {
    if (!isSideRegistrationPose(landmarks, worldLandmarks)) {
      return 'Turn fully sideways, stand tall with your arms relaxed, and keep your full body visible.';
    }
    if (!getBodySignature(worldLandmarks)) {
      return 'Keep your nearer shoulder, elbow, wrist, hip, knee, and ankle clearly visible.';
    }
    return 'Good side-on stance. Hold still so the side profile can register.';
  }
  if (REQUIRED_JOINTS.some((index) => !validPoint(landmarks[index]))) {
    return 'Keep both arms and legs visible, and make sure the area is well lit.';
  }
  if (!isRegistrationPose(landmarks, worldLandmarks, view)) {
    return 'Raise both arms straight out at shoulder height and hold a T-pose.';
  }
  return 'Great framing. Hold your T-pose still to register this view.';
}

export function getBodySignature(worldLandmarks) {
  if (!worldLandmarks) return null;
  const validWorldPoint = (index) => {
    const point = worldLandmarks[index];
    return point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.z) &&
      (point.visibility ?? 1) >= 0.2;
  };
  const sides = [
    { shoulder: 11, hip: 23, knee: 25, ankle: 27 },
    { shoulder: 12, hip: 24, knee: 26, ankle: 28 },
  ];
  const side = sides
    .filter((indices) => [indices.shoulder, indices.hip, indices.knee, indices.ankle]
    .every(validWorldPoint))
    .sort((first, second) => (
    [second.shoulder, second.hip, second.knee, second.ankle]
      .reduce((sum, index) => sum + (worldLandmarks[index].visibility ?? 1), 0) -
    [first.shoulder, first.hip, first.knee, first.ankle]
      .reduce((sum, index) => sum + (worldLandmarks[index].visibility ?? 1), 0)
    ))[0];
  if (!side) return null;

  const torsoLength = distance(worldLandmarks[side.shoulder], worldLandmarks[side.hip]);
  if (!Number.isFinite(torsoLength) || torsoLength <= 0) return null;
  return [
    distance(worldLandmarks[side.hip], worldLandmarks[side.knee]) / torsoLength,
    distance(worldLandmarks[side.knee], worldLandmarks[side.ankle]) / torsoLength,
  ];
}

export function medianBodySignature(samples) {
  if (!samples.length) return null;
  return samples[0].map((_, index) => {
    const values = samples.map((sample) => sample[index]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2
      ? values[middle]
      : (values[middle - 1] + values[middle]) / 2;
  });
}

export function matchesBodyProfile(signature, profiles) {
  if (!signature || !profiles.length) return false;
  return profiles.some((profile) => {
    const differences = signature.map((value, index) => (
      Math.abs(value - profile[index]) / Math.max(Math.abs(profile[index]), 0.15)
    ));
    const averageDifference = differences.reduce((sum, value) => sum + value, 0) / differences.length;
    return averageDifference <= 0.24 && Math.max(...differences) <= 0.55;
  });
}
