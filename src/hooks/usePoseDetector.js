import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { getJointAngles, LANDMARK, smoothAngleValues } from '../utils/angles.js';
import {
  getBodySignature,
  getRegistrationGuidance,
  isRegistrationPose,
  matchesBodyProfile,
  medianBodySignature,
} from '../utils/identity.js';
import {
  classifyExercise,
  createRepTracker,
  getSquatAngle,
  hasCompleteSkeleton,
  REP_DEPTH_ANGLE,
  selectPoseSide,
  smoothLandmarks,
  updateSupportStability,
  updateRepTracker,
} from '../utils/exercises.js';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const MIN_VISIBILITY = 0.5;
const DRAW_VISIBILITY = 0.35;
const MIN_DETECTION_INTERVAL_MS = 50;
const UI_UPDATE_INTERVAL_MS = 100;
const REGISTRATION_HOLD_MS = 5000;
const REGISTRATION_MIN_SAMPLES = 20;
const REGISTRATION_VIEWS = ['front', 'side', 'back'];
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];

function drawAngle(context, landmarks, firstIndex, vertexIndex, lastIndex, value, label, highlighted) {
  const first = landmarks[firstIndex];
  const vertex = landmarks[vertexIndex];
  const last = landmarks[lastIndex];
  if (
    !first || !vertex || !last ||
    [first, vertex, last].some((point) => (point.visibility ?? 0) <= 0.15) ||
    value == null
  ) return;

  const firstAngle = Math.atan2(
    (first.y - vertex.y) * context.canvas.height,
    (first.x - vertex.x) * context.canvas.width,
  );
  const lastAngle = Math.atan2(
    (last.y - vertex.y) * context.canvas.height,
    (last.x - vertex.x) * context.canvas.width,
  );
  let difference = lastAngle - firstAngle;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;

  const radius = Math.max(13, Math.min(28, context.canvas.width / 36));
  const color = highlighted ? '#c5f47b' : '#72d9d0';
  context.beginPath();
  context.arc(vertex.x * context.canvas.width, vertex.y * context.canvas.height, radius, firstAngle, firstAngle + difference, difference < 0);
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, context.canvas.width / 400);
  context.stroke();

  const middleAngle = firstAngle + difference / 2;
  const labelRadius = radius + Math.max(13, context.canvas.width / 65);
  const labelX = vertex.x * context.canvas.width + Math.cos(middleAngle) * labelRadius;
  const labelY = vertex.y * context.canvas.height + Math.sin(middleAngle) * labelRadius;
  const fontSize = Math.max(10, Math.min(16, context.canvas.width / 65));
  const text = `${label} ${Math.round(value)}°`;

  context.save();
  context.font = `600 ${fontSize}px "DM Mono", monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const textWidth = context.measureText(text).width;
  const paddingX = fontSize * 0.45;
  const paddingY = fontSize * 0.3;
  context.fillStyle = 'rgba(10, 16, 13, 0.82)';
  context.beginPath();
  context.roundRect(labelX - textWidth / 2 - paddingX, labelY - fontSize / 2 - paddingY, textWidth + paddingX * 2, fontSize + paddingY * 2, 4);
  context.fill();
  context.fillStyle = color;
  context.translate(labelX, labelY);
  context.scale(-1, 1);
  context.fillText(text, 0, 0);
  context.restore();
}

function drawCameraFrame(canvas, video) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
}

function drawPose(canvas, landmarks, side, angles, exercise) {
  const context = canvas.getContext('2d');
  if (!context) return;
  if (!hasCompleteSkeleton(landmarks, DRAW_VISIBILITY)) return;
  context.lineWidth = Math.max(3, canvas.width / 240);
  context.lineCap = 'round';
  context.strokeStyle = '#b9f36b';
  context.fillStyle = '#f3ffe1';

  for (const [startIndex, endIndex] of CONNECTIONS) {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];
    if ((start?.visibility ?? 0) <= DRAW_VISIBILITY || (end?.visibility ?? 0) <= DRAW_VISIBILITY) continue;
    context.beginPath();
    context.moveTo(start.x * canvas.width, start.y * canvas.height);
    context.lineTo(end.x * canvas.width, end.y * canvas.height);
    context.stroke();
  }

  landmarks.forEach((landmark) => {
    if ((landmark?.visibility ?? 0) <= DRAW_VISIBILITY) return;
    context.beginPath();
    context.arc(landmark.x * canvas.width, landmark.y * canvas.height, Math.max(3, canvas.width / 180), 0, Math.PI * 2);
    context.fill();
  });

  const landmarkIndex = (joint) => LANDMARK[`${side}${joint}`];
  drawAngle(
    context,
    landmarks,
    landmarkIndex('Shoulder'),
    landmarkIndex('Hip'),
    landmarkIndex('Knee'),
    angles[`${side}Hip`],
    'HIP',
    exercise === 'squat',
  );
  drawAngle(
    context,
    landmarks,
    landmarkIndex('Hip'),
    landmarkIndex('Knee'),
    landmarkIndex('Ankle'),
    angles[`${side}Knee`],
    'KNEE',
    exercise === 'squat',
  );
  drawAngle(
    context,
    landmarks,
    landmarkIndex('Shoulder'),
    landmarkIndex('Elbow'),
    landmarkIndex('Wrist'),
    angles[`${side}Elbow`],
    'ELBOW',
    exercise === 'pushup',
  );
}

function pauseRepTracker(tracker) {
  tracker.exercise = null;
  tracker.candidate = null;
  tracker.candidateFrames = 0;
  tracker.missedFrames = 0;
  tracker.supportExercise = null;
  tracker.supportSide = null;
  tracker.supportIndex = null;
  tracker.supportLandmarks = null;
  tracker.supportFrames = 0;
  tracker.phase = { armed: false, bottomReached: false, depthFrames: 0, depthAngles: [] };
}

export function usePoseDetector(videoRef, canvasRef, active) {
  const [status, setStatus] = useState('Camera is off');
  const [error, setError] = useState('');
  const [fps, setFps] = useState(0);
  const [angles, setAngles] = useState(null);
  const [selectedSide, setSelectedSide] = useState('left');
  const [squatView, setSquatView] = useState('side');
  const selectedSideRef = useRef('left');
  const [ready, setReady] = useState(false);
  const [exercise, setExercise] = useState(null);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [reps, setReps] = useState({ squat: 0, pushup: 0 });
  const [repMessage, setRepMessage] = useState('Move into position to detect an exercise');
  const [registration, setRegistration] = useState({
    enrolled: false,
    capturing: false,
    step: 0,
    progress: 0,
    message: 'Register your T-pose to enable tracking.',
    guidance: 'Center yourself with your full body in view.',
  });
  const registrationRef = useRef({
    profiles: [],
    capturing: false,
    step: 0,
    startAt: null,
    samples: [],
    lastPublishedAt: 0,
  });
  const historyRef = useRef({});
  const landmarksRef = useRef(null);
  const repTrackerRef = useRef(createRepTracker());
  const publishedRepsRef = useRef({ squat: 0, pushup: 0 });
  const landmarkerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function loadModel() {
      setError('');
      setStatus('Loading pose model');
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        const options = {
          runningMode: 'VIDEO',
          numPoses: 2,
          minPoseDetectionConfidence: MIN_VISIBILITY,
          minPosePresenceConfidence: MIN_VISIBILITY,
          minTrackingConfidence: MIN_VISIBILITY,
        };
        let landmarker;
        let usedCpu = false;
        try {
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            ...options,
            baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          });
        } catch {
          usedCpu = true;
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            ...options,
            baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          });
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setReady(true);
        setStatus(usedCpu ? 'Model ready (CPU)' : 'Model ready');
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : String(loadError);
          setError(`Pose model failed to load: ${message}`);
          setStatus('Model unavailable');
        }
      }
    }
    loadModel();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (active) return;
    const tracker = repTrackerRef.current;
    tracker.exercise = null;
    tracker.candidate = null;
    tracker.candidateFrames = 0;
    tracker.missedFrames = 0;
    tracker.supportExercise = null;
    tracker.supportSide = null;
    tracker.supportIndex = null;
    tracker.supportLandmarks = null;
    tracker.supportFrames = 0;
    tracker.phase = { armed: false, bottomReached: false, depthFrames: 0, depthAngles: [] };
    tracker.message = 'Move into position to detect an exercise';
    setExercise(null);
    setRepMessage(tracker.message);
  }, [active]);

  useEffect(() => {
    if (!active || !ready) return undefined;
    let animationId = 0;
    let previousTimestamp = -1;
    let lastDetectionTime = 0;
    let lastUiUpdateTime = 0;
    let frameCount = 0;
    let lastFpsTime = performance.now();
    const detect = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = landmarkerRef.current;
      if (video && canvas && landmarker && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const now = performance.now();
        if (
          video.currentTime !== previousTimestamp &&
          now - lastDetectionTime >= MIN_DETECTION_INTERVAL_MS
        ) {
          previousTimestamp = video.currentTime;
          lastDetectionTime = now;
          const result = landmarker.detectForVideo(video, now);
          const poses = result.landmarks ?? [];
          const detectedPose = poses[0];
          const registrationState = registrationRef.current;
          drawCameraFrame(canvas, video);
          const updateUi = now - lastUiUpdateTime >= UI_UPDATE_INTERVAL_MS;
          if (updateUi) lastUiUpdateTime = now;
          const publishRegistration = (patch, force = false) => {
            if (force || now - registrationState.lastPublishedAt >= 100) {
              registrationState.lastPublishedAt = now;
              setRegistration((current) => ({ ...current, ...patch }));
            }
          };
          const resetCaptureTimer = (message) => {
            registrationState.startAt = null;
            registrationState.samples = [];
            publishRegistration({ progress: 0, message });
          };

          if (poses.length > 1) {
            if (registrationState.capturing) {
              resetCaptureTimer('Only one person can be in frame during registration.');
              publishRegistration({ guidance: 'Only one person should be in the camera frame.' });
            }
            if (registrationState.profiles.length === REGISTRATION_VIEWS.length) {
              const tracker = repTrackerRef.current;
              pauseRepTracker(tracker);
              tracker.message = 'Multiple people detected — clear the frame to resume tracking.';
              if (updateUi) {
                setExercise(tracker.exercise);
                setRepMessage('Multiple people detected — clear the frame to resume tracking.');
              }
            }
            if (updateUi) {
              setAngles(null);
              setStatus('Multiple people detected');
            }
            frameCount += 1;
            if (now - lastFpsTime >= 1000) {
              setFps(Math.round((frameCount * 1000) / (now - lastFpsTime)));
              frameCount = 0;
              lastFpsTime = now;
            }
            animationId = requestAnimationFrame(detect);
            return;
          }

          if (detectedPose) {
            const pose = smoothLandmarks(detectedPose, landmarksRef.current);
            landmarksRef.current = pose;
            const worldPose = result.worldLandmarks?.[0];
            const profileSignature = getBodySignature(worldPose);
            if (registrationState.capturing) {
              const registrationView = REGISTRATION_VIEWS[registrationState.step];
              const guidance = getRegistrationGuidance(pose, worldPose, registrationView);
              publishRegistration({ guidance });
              const validRegistrationPose = isRegistrationPose(pose, worldPose, registrationView) &&
                profileSignature;
              if (!validRegistrationPose) {
                resetCaptureTimer(guidance);
              } else {
                if (registrationState.startAt == null) {
                  registrationState.startAt = now;
                  registrationState.samples = [];
                }
                registrationState.samples.push(profileSignature);
                const elapsed = now - registrationState.startAt;
                const progress = Math.min(1, elapsed / REGISTRATION_HOLD_MS);
                publishRegistration({
                  progress,
                  message: registrationView === 'side'
                    ? 'Hold your side-on stance steady for 5 seconds.'
                    : `Hold your ${registrationView} T-pose steady for 5 seconds.`,
                  guidance,
                });
                if (elapsed >= REGISTRATION_HOLD_MS && registrationState.samples.length >= REGISTRATION_MIN_SAMPLES) {
                  registrationState.profiles.push(medianBodySignature(registrationState.samples));
                  registrationState.capturing = false;
                  registrationState.startAt = null;
                  registrationState.samples = [];
                  registrationState.step += 1;
                  const enrolled = registrationState.step >= REGISTRATION_VIEWS.length;
                  publishRegistration({
                    enrolled,
                    capturing: false,
                    step: registrationState.step,
                    progress: 0,
                    message: enrolled
                      ? 'Registration complete. Tracking is limited to a close pose match.'
                      : `${REGISTRATION_VIEWS[registrationState.step - 1]} view saved. Turn to your ${REGISTRATION_VIEWS[registrationState.step]} view, then continue.`,
                    guidance: 'Follow the on-screen prompt to begin the next view.',
                  }, true);
                }
              }
            }

            const enrolled = registrationState.profiles.length === REGISTRATION_VIEWS.length;
            const identityMatches = enrolled && matchesBodyProfile(profileSignature, registrationState.profiles);
            const registrationAllowed = !enrolled || identityMatches;
            const pixelPose = pose.map((landmark) => ({
              ...landmark,
              x: landmark.x * video.videoWidth,
              y: landmark.y * video.videoHeight,
            }));
            const rawAngles = getJointAngles(pixelPose);
            const side = selectPoseSide(pose, selectedExercise, selectedSideRef.current);
            selectedSideRef.current = side;
            const squatMetrics = getSquatAngle(
              pose,
              side,
              video.videoWidth,
              video.videoHeight,
              worldPose,
            );
            if (updateUi) {
              setSelectedSide(side);
              setSquatView(squatMetrics.view);
            }
            const smooth = smoothAngleValues({
              leftKnee: rawAngles.left.knee,
              rightKnee: rawAngles.right.knee,
              squatKnee: squatMetrics.angle,
              leftHip: rawAngles.left.hip,
              rightHip: rawAngles.right.hip,
              leftElbow: rawAngles.left.elbow,
              rightElbow: rawAngles.right.elbow,
              trunkLean: side === 'right' ? rawAngles.rightTrunk : rawAngles.leftTrunk,
            }, historyRef.current);
            historyRef.current = smooth.history;
            if (updateUi) setAngles(smooth.values);
            const candidate = classifyExercise(
              pose,
              side,
              video.videoWidth,
              video.videoHeight,
              worldPose,
            );
            if (!enrolled || identityMatches) {
              drawPose(canvas, pose, side, smooth.values, selectedExercise || candidate);
            }
            if (!enrolled) {
              if (updateUi) {
                setAngles(null);
                setExercise(null);
                setStatus(registrationState.capturing ? 'Registering person' : 'Registration required');
                setRepMessage(registrationState.capturing
                  ? registrationState.startAt == null
                    ? 'Show one person in a T-pose to begin registration.'
                    : 'Hold still while the registration timer runs.'
                  : 'Complete the front, side, and back registration before tracking reps.');
              }
              frameCount += 1;
              if (now - lastFpsTime >= 1000) {
                setFps(Math.round((frameCount * 1000) / (now - lastFpsTime)));
                frameCount = 0;
                lastFpsTime = now;
              }
              animationId = requestAnimationFrame(detect);
              return;
            }
            if (!registrationAllowed) {
              const tracker = repTrackerRef.current;
              pauseRepTracker(tracker);
              tracker.message = 'Person does not match the saved pose profile. Rep tracking is paused.';
              if (updateUi) {
                setExercise(tracker.exercise);
                setAngles(null);
                setRepMessage('Person does not match the saved pose profile. Rep tracking is paused.');
                setStatus('Person mismatch');
              }
              frameCount += 1;
              if (now - lastFpsTime >= 1000) {
                setFps(Math.round((frameCount * 1000) / (now - lastFpsTime)));
                frameCount = 0;
                lastFpsTime = now;
              }
              animationId = requestAnimationFrame(detect);
              return;
            }
            const activeExercise = selectedExercise || candidate;
            const requiredJoints = activeExercise === 'pushup'
              ? ['Shoulder', 'Elbow', 'Wrist']
              : activeExercise === 'squat' ? ['Hip', 'Knee', 'Ankle'] : [];
            const repPoseVisible = requiredJoints.every((joint) => (
              (pose[LANDMARK[`${side}${joint}`]]?.visibility ?? 0) >= 0.15
            ));
            const repAngle = !repPoseVisible
              ? null
              : activeExercise === 'pushup'
              ? smooth.values[`${side}Elbow`]
              : activeExercise === 'squat' ? smooth.values.squatKnee : null;
            const supportStable = updateSupportStability(repTrackerRef.current, pose, activeExercise, side);
            const tracker = updateRepTracker(repTrackerRef.current, activeExercise, repAngle, supportStable);
            setExercise(tracker.exercise);
            if (tracker.reps.squat !== publishedRepsRef.current.squat || tracker.reps.pushup !== publishedRepsRef.current.pushup) {
              publishedRepsRef.current = { ...tracker.reps };
              setReps(publishedRepsRef.current);
            }
            if (updateUi) {
              setRepMessage(tracker.message);
              setStatus('Registered person detected');
            }
          } else {
            historyRef.current = {};
            landmarksRef.current = null;
            updateSupportStability(repTrackerRef.current, null, selectedExercise, selectedSideRef.current);
            const tracker = updateRepTracker(repTrackerRef.current, selectedExercise, null, false);
            setExercise(tracker.exercise);
            if (updateUi) {
              setRepMessage(tracker.message);
              setAngles(null);
              setStatus('No body detected');
            }
            if (registrationState.capturing) {
              resetCaptureTimer('No person detected — step into view with your full body visible.');
              publishRegistration({ guidance: 'Step into view so the camera can see your full body.' });
            }
          }
          frameCount += 1;
          if (now - lastFpsTime >= 1000) {
            setFps(Math.round((frameCount * 1000) / (now - lastFpsTime)));
            frameCount = 0;
            lastFpsTime = now;
          }
        }
      }
      animationId = requestAnimationFrame(detect);
    };
    animationId = requestAnimationFrame(detect);
    return () => cancelAnimationFrame(animationId);
  }, [active, ready, videoRef, canvasRef, selectedExercise]);

  function selectExercise(nextExercise) {
    setSelectedExercise(nextExercise);
    const tracker = repTrackerRef.current;
    tracker.exercise = nextExercise;
    tracker.candidate = null;
    tracker.candidateFrames = 0;
    tracker.missedFrames = 0;
    tracker.supportExercise = null;
    tracker.supportSide = null;
    tracker.supportIndex = null;
    tracker.supportLandmarks = null;
    tracker.supportFrames = 0;
    tracker.phase = { armed: false, bottomReached: false, depthFrames: 0, depthAngles: [] };
    tracker.message = nextExercise
      ? `Selected ${nextExercise === 'pushup' ? 'push-up' : 'squat'} — reach the top position to start counting`
      : 'Move into position to detect an exercise';
    setExercise(nextExercise);
    setRepMessage(tracker.message);
  }

  function resetReps() {
    const tracker = repTrackerRef.current;
    tracker.reps = { squat: 0, pushup: 0 };
    tracker.phase = { armed: false, bottomReached: false, depthFrames: 0, depthAngles: [] };
    tracker.message = selectedExercise
      ? `Selected ${selectedExercise === 'pushup' ? 'push-up' : 'squat'} — reach the top position to start counting`
      : 'Reach the top position to start counting';
    publishedRepsRef.current = { ...tracker.reps };
    setReps(publishedRepsRef.current);
    setRepMessage(tracker.message);
  }

  function startRegistration() {
    const state = registrationRef.current;
    state.profiles = [];
    state.capturing = true;
    state.step = 0;
    state.startAt = null;
    state.samples = [];
    setRegistration({
      enrolled: false,
      capturing: true,
      step: 0,
      progress: 0,
      message: 'Face the camera in a T-pose to begin your front-view registration.',
      guidance: 'Stand centered, facing the camera, with your full body visible.',
    });
    const tracker = repTrackerRef.current;
    pauseRepTracker(tracker);
    tracker.reps = { squat: 0, pushup: 0 };
    publishedRepsRef.current = { ...tracker.reps };
    setReps(publishedRepsRef.current);
    setExercise(null);
    setRepMessage('Complete the front, side, and back registration before tracking reps.');
  }

  function continueRegistration() {
    const state = registrationRef.current;
    if (state.capturing || state.step >= REGISTRATION_VIEWS.length) return;
    state.capturing = true;
    state.startAt = null;
    state.samples = [];
    setRegistration((current) => ({
      ...current,
      capturing: true,
      progress: 0,
      message: state.step === 1
        ? 'Turn sideways to the camera and stand tall with your arms relaxed.'
        : `Show your ${REGISTRATION_VIEWS[state.step]} view in a T-pose to begin.`,
    }));
  }

  function resetRegistration() {
    registrationRef.current = {
      profiles: [],
      capturing: false,
      step: 0,
      startAt: null,
      samples: [],
      lastPublishedAt: 0,
    };
    setRegistration({
      enrolled: false,
      capturing: false,
      step: 0,
      progress: 0,
      message: 'Registration cleared. Register your T-pose to enable tracking.',
      guidance: 'Center yourself with your full body in view.',
    });
    const tracker = repTrackerRef.current;
    pauseRepTracker(tracker);
    tracker.reps = { squat: 0, pushup: 0 };
    publishedRepsRef.current = { ...tracker.reps };
    setReps(publishedRepsRef.current);
    setExercise(null);
    setRepMessage('Complete the front, side, and back registration before tracking reps.');
  }

  return {
    status, error, fps, angles, selectedSide, squatView, ready, exercise, selectedExercise,
    selectExercise, reps, repMessage, resetReps, registration, startRegistration,
    continueRegistration, resetRegistration,
  };
}