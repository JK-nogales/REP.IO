import { angleAtPoint, LANDMARK, trunkLeanDegrees } from './angles.js';

const MIN_VISIBILITY = 0.15;
const EXERCISE_CONFIRMATION_FRAMES = 4;
const LOST_POSE_TOLERANCE_FRAMES = 8;
const REQUIRED_DEPTH_FRAMES = 6;
const REQUIRED_SUPPORT_FRAMES = 5;
const MAX_SUPPORT_MOVEMENT = 0.02;
const MAX_DEPTH_ANGLE_VARIATION = 10;
const MAX_LANDMARK_FRAME_JUMP = 0.1;
export const REP_DEPTH_RANGE = {
  squat: { min: 90, max: 110 },
  pushup: { min: 0, max: 90 },
};
export const REP_DEPTH_ANGLE = { squat: 110, pushup: 90 };

function visible(landmarks, index) {
  const landmark = landmarks[index];
  return Boolean(
    landmark &&
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    (landmark.visibility == null || landmark.visibility >= MIN_VISIBILITY),
  );
}

function pixelPoint(landmarks, index, width, height) {
  const landmark = landmarks[index];
  return landmark ? { x: landmark.x * width, y: landmark.y * height } : null;
}

function angleAtWorldPoint(a, b, c) {
  if (!a || !b || !c) return null;
  const first = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const second = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const denominator = Math.hypot(first.x, first.y, first.z) *
    Math.hypot(second.x, second.y, second.z);
  if (!denominator) return null;
  const cosine = (
    first.x * second.x + first.y * second.y + first.z * second.z
  ) / denominator;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

function visibleWorldAngle(worldLandmarks, hipIndex, kneeIndex, ankleIndex) {
  if (![hipIndex, kneeIndex, ankleIndex].every((index) => (
    worldLandmarks?.[index] &&
    Number.isFinite(worldLandmarks[index].x) &&
    Number.isFinite(worldLandmarks[index].y) &&
    Number.isFinite(worldLandmarks[index].z) &&
    (worldLandmarks[index].visibility ?? 0) >= MIN_VISIBILITY
  ))) return null;
  return angleAtWorldPoint(
    worldLandmarks[hipIndex],
    worldLandmarks[kneeIndex],
    worldLandmarks[ankleIndex],
  );
}

export function smoothLandmarks(landmarks, previous, alpha = 0.35) {
  if (!previous || previous.length !== landmarks.length) {
    return landmarks.map((landmark) => ({ ...landmark }));
  }
  return landmarks.map((landmark, index) => {
    const prior = previous[index];
    if ((landmark.visibility ?? 1) < 0.2) {
      return { ...landmark, x: prior.x, y: prior.y, z: prior.z };
    }
    const clampMovement = (value, previousValue) => {
      const delta = value - previousValue;
      return previousValue + Math.max(-MAX_LANDMARK_FRAME_JUMP, Math.min(MAX_LANDMARK_FRAME_JUMP, delta));
    };
    const x = clampMovement(landmark.x, prior.x);
    const y = clampMovement(landmark.y, prior.y);
    const z = clampMovement(landmark.z, prior.z);
    return {
      ...landmark,
      x: prior.x + (x - prior.x) * alpha,
      y: prior.y + (y - prior.y) * alpha,
      z: prior.z + (z - prior.z) * alpha,
    };
  });
}

export function hasCompleteSkeleton(landmarks, minimumVisibility = 0.5) {
  return ['left', 'right'].some((side) => (
    ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle'].every((joint) => (
      (landmarks[LANDMARK[`${side}${joint}`]]?.visibility ?? 0) > minimumVisibility
    ))
  ));
}

export function selectPoseSide(landmarks, exercise, previousSide = 'left') {
  const joints = exercise === 'squat'
    ? ['Hip', 'Knee', 'Ankle']
    : exercise === 'pushup'
      ? ['Shoulder', 'Elbow', 'Wrist']
      : ['Shoulder', 'Hip', 'Knee', 'Ankle'];
  const score = (side) => joints.reduce((total, joint) => {
    const point = landmarks[LANDMARK[`${side}${joint}`]];
    const visibility = point?.visibility ?? 0;
    return total + (visibility >= MIN_VISIBILITY ? visibility : 0);
  }, 0);
  const preferredScore = score(previousSide);
  const otherSide = previousSide === 'left' ? 'right' : 'left';
  const otherScore = score(otherSide);
  if (preferredScore > 0 && preferredScore >= otherScore - 0.35) return previousSide;
  return otherScore > preferredScore ? otherSide : previousSide;
}

export function getSquatAngle(landmarks, side, width, height, worldLandmarks) {
  const point = (name) => pixelPoint(landmarks, LANDMARK[name], width, height);
  const leftImageAngle = visible(landmarks, LANDMARK.leftHip) &&
    visible(landmarks, LANDMARK.leftKnee) &&
    visible(landmarks, LANDMARK.leftAnkle)
    ? angleAtPoint(point('leftHip'), point('leftKnee'), point('leftAnkle'))
    : null;
  const rightImageAngle = visible(landmarks, LANDMARK.rightHip) &&
    visible(landmarks, LANDMARK.rightKnee) &&
    visible(landmarks, LANDMARK.rightAnkle)
    ? angleAtPoint(point('rightHip'), point('rightKnee'), point('rightAnkle'))
    : null;
  const leftAngle = visibleWorldAngle(worldLandmarks, 23, 25, 27) ?? leftImageAngle;
  const rightAngle = visibleWorldAngle(worldLandmarks, 24, 26, 28) ?? rightImageAngle;

  const leftHip = point('leftHip');
  const rightHip = point('rightHip');
  const leftShoulder = point('leftShoulder');
  const rightShoulder = point('rightShoulder');
  const torso = (leftHip && leftShoulder)
    ? Math.hypot(leftHip.x - leftShoulder.x, leftHip.y - leftShoulder.y)
    : rightHip && rightShoulder
      ? Math.hypot(rightHip.x - rightShoulder.x, rightHip.y - rightShoulder.y)
      : 0;
  const hipWidth = leftHip && rightHip ? Math.abs(leftHip.x - rightHip.x) : 0;
  const shoulderWidth = leftShoulder && rightShoulder
    ? Math.abs(leftShoulder.x - rightShoulder.x)
    : 0;
  const view = torso > 0 && Math.max(hipWidth, shoulderWidth) / torso > 0.38
    ? 'front'
    : 'side';

  if (view === 'front' && leftAngle != null && rightAngle != null) {
    return { angle: (leftAngle + rightAngle) / 2, view };
  }

  const preferredAngle = side === 'left' ? leftAngle : rightAngle;
  const otherAngle = side === 'left' ? rightAngle : leftAngle;
  return { angle: preferredAngle ?? otherAngle, view };
}

export function updateSupportStability(tracker, landmarks, exercise, side) {
  const supportIndices = exercise === 'squat'
    ? [side === 'left' ? 29 : 30, side === 'left' ? 31 : 32, LANDMARK[`${side}Ankle`]]
    : exercise === 'pushup' ? [LANDMARK[`${side}Wrist`]] : [];
  const bodyJoints = exercise === 'squat'
    ? ['Hip', 'Knee', 'Ankle']
    : exercise === 'pushup' ? ['Shoulder', 'Hip', 'Elbow', 'Wrist'] : [];
  if (!supportIndices.length || !bodyJoints.length || !landmarks) {
    tracker.supportExercise = exercise;
    tracker.supportSide = side;
    tracker.supportIndex = null;
    tracker.supportLandmarks = null;
    tracker.supportFrames = 0;
    return false;
  }

  const previousIndex = tracker.supportIndex;
  const index = supportIndices.includes(previousIndex) &&
    (landmarks[previousIndex]?.visibility ?? 0) >= MIN_VISIBILITY
    ? previousIndex
    : supportIndices
      .filter((candidate) => (landmarks[candidate]?.visibility ?? 0) >= MIN_VISIBILITY)
      .sort((first, second) => (
        (landmarks[second]?.visibility ?? 0) - (landmarks[first]?.visibility ?? 0)
      ))[0];
  const pointIndices = [
    ...bodyJoints.map((joint) => LANDMARK[`${side}${joint}`]),
    ...(index == null ? [] : [index]),
  ];
  const points = pointIndices.map((pointIndex) => landmarks[pointIndex]);
  if (
    points.length !== bodyJoints.length + 1 ||
    points.some((point) => (
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      (point.visibility ?? 0) < MIN_VISIBILITY
    ))
  ) {
    tracker.supportExercise = exercise;
    tracker.supportSide = side;
    tracker.supportIndex = null;
    tracker.supportLandmarks = null;
    tracker.supportFrames = 0;
    return false;
  }

  const previous = tracker.supportLandmarks;
  const sameContext = tracker.supportExercise === exercise &&
    tracker.supportSide === side &&
    tracker.supportIndex === index;
  const stable = sameContext &&
    Array.isArray(previous) &&
    points.every((point, pointIndex) => {
      const baseline = previous[pointIndex];
      return Math.hypot(point.x - baseline.x, point.y - baseline.y) <= MAX_SUPPORT_MOVEMENT;
    });
  tracker.supportExercise = exercise;
  tracker.supportSide = side;
  tracker.supportIndex = index;
  if (stable) {
    tracker.supportFrames += 1;
    tracker.supportLandmarks = points.map(({ x, y }) => ({ x, y }));
  } else {
    tracker.supportLandmarks = points.map(({ x, y }) => ({ x, y }));
    tracker.supportFrames = 1;
  }
  return tracker.supportFrames >= REQUIRED_SUPPORT_FRAMES;
}

export function classifyExercise(landmarks, side, width, height, worldLandmarks) {
  const shoulderIndex = LANDMARK[`${side}Shoulder`];
  const hipIndex = LANDMARK[`${side}Hip`];
  const kneeIndex = LANDMARK[`${side}Knee`];
  const ankleIndex = LANDMARK[`${side}Ankle`];
  const elbowIndex = LANDMARK[`${side}Elbow`];
  const wristIndex = LANDMARK[`${side}Wrist`];

  if (![shoulderIndex, hipIndex, kneeIndex, ankleIndex].every((index) => visible(landmarks, index))) return null;

  const shoulder = pixelPoint(landmarks, shoulderIndex, width, height);
  const hip = pixelPoint(landmarks, hipIndex, width, height);
  const knee = pixelPoint(landmarks, kneeIndex, width, height);
  const ankle = pixelPoint(landmarks, ankleIndex, width, height);
  const kneeAngle = visibleWorldAngle(worldLandmarks, hipIndex, kneeIndex, ankleIndex) ??
    angleAtPoint(hip, knee, ankle);
  if (kneeAngle == null) return null;

  if ([elbowIndex, wristIndex].every((index) => visible(landmarks, index))) {
    const elbow = pixelPoint(landmarks, elbowIndex, width, height);
    const wrist = pixelPoint(landmarks, wristIndex, width, height);
    const bodyLength = Math.hypot(ankle.x - shoulder.x, ankle.y - shoulder.y);
    const verticalRatio = bodyLength ? Math.abs(ankle.y - shoulder.y) / bodyLength : 1;
    const bodyAngle = angleAtPoint(shoulder, hip, ankle);
    const elbowAngle = angleAtPoint(shoulder, elbow, wrist);
    if (verticalRatio < 0.4 && bodyAngle >= 145 && elbowAngle != null) return 'pushup';
  }

  const trunkLean = trunkLeanDegrees(shoulder, hip);
  return trunkLean < 70 ? 'squat' : null;
}

export function createRepTracker() {
  return {
    exercise: null,
    candidate: null,
    candidateFrames: 0,
    missedFrames: 0,
    supportExercise: null,
    supportSide: null,
    supportIndex: null,
    supportLandmarks: null,
    supportFrames: 0,
    reps: { squat: 0, pushup: 0 },
    phase: { armed: false, bottomReached: false, depthFrames: 0, depthAngles: [] },
    message: 'Move into position to detect an exercise',
  };
}

export function updateRepTracker(tracker, candidate, angle, supportStable = false) {
  if (candidate) {
    tracker.missedFrames = 0;
    if (candidate === tracker.exercise) {
      tracker.candidate = null;
      tracker.candidateFrames = 0;
    } else if (candidate === tracker.candidate) {
      tracker.candidateFrames += 1;
    } else {
      tracker.candidate = candidate;
      tracker.candidateFrames = 1;
    }

    if (tracker.candidateFrames >= EXERCISE_CONFIRMATION_FRAMES) {
      tracker.exercise = candidate;
      tracker.candidate = null;
      tracker.candidateFrames = 0;
      tracker.phase = { armed: false, bottomReached: false, depthFrames: 0, depthAngles: [] };
    }
  } else {
    tracker.candidate = null;
    tracker.candidateFrames = 0;
    tracker.missedFrames += 1;
    tracker.phase.depthFrames = 0;
    tracker.phase.depthAngles = [];
    if (tracker.missedFrames > LOST_POSE_TOLERANCE_FRAMES) {
      tracker.exercise = null;
      tracker.phase = { armed: false, bottomReached: false, depthFrames: 0, depthAngles: [] };
      tracker.message = 'Move into position to detect an exercise';
    }
  }

  if (!tracker.exercise || tracker.exercise !== candidate) return tracker;
  if (!supportStable && !tracker.phase.armed) {
    tracker.message = tracker.exercise === 'squat'
      ? 'Keep the visible foot planted, then stand tall'
      : 'Keep the visible hand planted, then reach full extension';
    return tracker;
  }
  if (angle == null || !Number.isFinite(angle)) {
    tracker.phase = { armed: false, bottomReached: false, depthFrames: 0, depthAngles: [] };
    tracker.message = 'Keep the exercise joints visible to the camera';
    return tracker;
  }

  const { min: bottomMinimum, max: bottomMaximum } = REP_DEPTH_RANGE[tracker.exercise];
  const topThreshold = 150;
  if (angle >= topThreshold) {
    if (tracker.phase.bottomReached) {
      tracker.reps[tracker.exercise] += 1;
      tracker.phase.bottomReached = false;
      tracker.message = 'Rep counted';
    } else {
      tracker.message = tracker.exercise === 'squat'
        ? `Ready — lower into ${bottomMinimum}°–${bottomMaximum}°`
        : `Ready — lower to ${bottomMaximum}° or less`;
    }
    tracker.phase.armed = true;
    tracker.phase.depthFrames = 0;
    tracker.phase.depthAngles = [];
  } else if (angle >= bottomMinimum && angle <= bottomMaximum && tracker.phase.armed) {
    if (!tracker.phase.bottomReached) {
      tracker.phase.depthAngles = [...tracker.phase.depthAngles, angle].slice(-REQUIRED_DEPTH_FRAMES);
      tracker.phase.depthFrames = tracker.phase.depthAngles.length;
      const angleSpread = Math.max(...tracker.phase.depthAngles) - Math.min(...tracker.phase.depthAngles);
      if (
        tracker.phase.depthFrames >= REQUIRED_DEPTH_FRAMES &&
        angleSpread <= MAX_DEPTH_ANGLE_VARIATION
      ) {
        tracker.phase.bottomReached = true;
        tracker.message = 'Depth reached — return to the top';
      } else if (tracker.phase.depthFrames >= REQUIRED_DEPTH_FRAMES) {
        tracker.phase.depthAngles = [angle];
        tracker.phase.depthFrames = 1;
        tracker.message = 'Hold a steady position in the depth range';
      } else {
        tracker.message = `Reach depth and hold (${tracker.phase.depthFrames}/${REQUIRED_DEPTH_FRAMES})`;
      }
    }
  } else if (tracker.phase.armed) {
    tracker.phase.depthFrames = 0;
    tracker.phase.depthAngles = [];
    if (tracker.exercise === 'squat' && angle < bottomMinimum) {
      tracker.message = `Ease up into the ${bottomMinimum}°–${bottomMaximum}° range`;
    } else if (angle > bottomMaximum) {
      tracker.message = tracker.exercise === 'squat'
        ? `Go deeper — reach ${bottomMinimum}°–${bottomMaximum}°`
        : `Go deeper — reach ${bottomMaximum}° or less`;
    }
  } else {
    tracker.phase.depthFrames = 0;
    tracker.message = 'Reach full extension to start counting';
  }

  return tracker;
}
