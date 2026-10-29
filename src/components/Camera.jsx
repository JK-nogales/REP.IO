import React, { useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, CameraOff, FlipHorizontal, LoaderCircle, RotateCcw } from 'lucide-react';
import { usePoseDetector } from '../hooks/usePoseDetector.js';
import { REP_DEPTH_ANGLE, REP_DEPTH_RANGE } from '../utils/exercises.js';

export default function Camera() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [active, setActive] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [cameraAspect, setCameraAspect] = useState(4 / 3);
  const [cameraError, setCameraError] = useState('');
  const {
    status, error: modelError, fps, angles, selectedSide, squatView, ready,
    exercise, selectedExercise, selectExercise, reps, repMessage, resetReps,
    registration, startRegistration, continueRegistration, resetRegistration,
  } = usePoseDetector(videoRef, canvasRef, active);
  const currentExercise = selectedExercise || exercise;
  const depthAngle = currentExercise
    ? currentExercise === 'squat'
      ? angles?.squatKnee
      : angles?.[`${selectedSide}Elbow`]
    : null;
  const depthTarget = currentExercise ? REP_DEPTH_ANGLE[currentExercise] : null;
  const depthRange = currentExercise ? REP_DEPTH_RANGE[currentExercise] : null;
  const depthProgress = depthAngle == null
    ? 0
    : Math.max(0, Math.min(100, ((160 - depthAngle) / (160 - depthTarget)) * 100));
  const withinDepthRange = depthAngle != null &&
    depthAngle >= depthRange?.min &&
    depthAngle <= depthRange?.max;

  async function startCamera(nextFacingMode = facingMode) {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access requires localhost or a secure HTTPS connection.');
      return;
    }
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: nextFacingMode },
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      streamRef.current = stream;
      setFacingMode(nextFacingMode);
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setActive(true);
    } catch (cameraFailure) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setActive(false);
      if (cameraFailure.name === 'NotAllowedError' || cameraFailure.name === 'SecurityError') {
        setCameraError('Camera permission was denied. Allow camera access in your browser settings and try again.');
      } else if (cameraFailure.name === 'NotFoundError' || cameraFailure.name === 'DevicesNotFoundError') {
        setCameraError('No camera was found on this device.');
      } else {
        setCameraError(`Could not start camera: ${cameraFailure.message}`);
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  const visibleError = cameraError || modelError;
  const visibleAngles = angles && ['leftKnee', 'rightKnee', 'leftHip', 'rightHip', 'leftElbow', 'rightElbow', 'trunkLean'];
  const angleLabels = {
    leftKnee: 'Left knee', rightKnee: 'Right knee',
    leftHip: 'Left hip', rightHip: 'Right hip',
    leftElbow: 'Left elbow', rightElbow: 'Right elbow', trunkLean: 'Trunk lean',
  };

  return (
    <section className="tracker" aria-label="Camera and pose tracker">
      <div className="camera-frame" style={{ aspectRatio: cameraAspect }}>
        <video
          ref={videoRef}
          className={active ? 'camera-video is-active' : 'camera-video'}
          onLoadedMetadata={() => setCameraAspect(videoRef.current.videoWidth / videoRef.current.videoHeight)}
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="pose-canvas" />
        {!active && (
          <div className="camera-placeholder">
            <div className="placeholder-mark"><CameraIcon size={26} strokeWidth={1.6} /></div>
            <span>YOUR MOVEMENT, IN FRAME</span>
            <p>{ready ? 'Start the camera to begin tracking.' : 'Preparing on-device pose model…'}</p>
          </div>
        )}
        <div className="camera-topline">
          <span className={`status-dot ${active && status === 'Registered person detected' ? 'is-detected' : ''}`} />
          <span>{active ? status : ready ? 'Camera is off' : status}</span>
          <span className="fps-readout">{active ? `${fps} FPS` : '-- FPS'}</span>
        </div>
        {active && registration.capturing && (
          <div className="registration-camera-prompt" role="status" aria-live="polite">
            <strong>{registration.guidance}</strong>
            <span>{registration.progress > 0
              ? `Hold still · ${Math.ceil((1 - registration.progress) * 5)}s`
              : `Preparing ${['front', 'side', 'back'][registration.step]} view`}</span>
          </div>
        )}
      </div>

      {visibleError && <div className="error-message" role="alert">{visibleError}</div>}

      <div className="camera-controls">
        {!active ? (
          <button className="primary-button" onClick={() => startCamera()} disabled={!ready || Boolean(modelError)}>
            {!ready && !modelError ? <LoaderCircle size={17} className="spin" /> : <CameraIcon size={17} />}
            {ready ? 'Start camera' : modelError ? 'Model unavailable' : 'Loading model'}
          </button>
        ) : (
          <button className="primary-button stop-button" onClick={stopCamera}>
            <CameraOff size={17} /> Stop camera
          </button>
        )}
        <button className="icon-button" onClick={() => startCamera(facingMode === 'user' ? 'environment' : 'user')} disabled={!active} aria-label="Switch camera" title="Switch camera">
          <FlipHorizontal size={18} />
        </button>
      </div>

      <div className="registration-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">PERSON REGISTRATION</span><h2>{registration.enrolled ? 'Profile ready' : 'Register your pose'}</h2></div>
          <span className="side-indicator">
            {registration.enrolled ? '3 views saved' : `${Math.min(registration.step, 3)} / 3 views`}
          </span>
        </div>
        <figure className="registration-guide">
          <img
            src="/pose-registration-guide.png"
            alt="Front, side, and back examples of a person in a T-pose"
          />
          <figcaption>Reference: front, side, then back. Turn your body when prompted.</figcaption>
        </figure>
        <p className="registration-guidance">
          {registration.message}
          {!registration.enrolled && ' Hold still for 5 seconds in each view. Use a T-pose for front/back; for side, stand tall with your arms relaxed.'}
        </p>
        <div
          className="registration-progress"
          role="progressbar"
          aria-label="Current view registration progress"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(registration.progress * 100)}
        >
          <span style={{ width: `${registration.progress * 100}%` }} />
        </div>
        <div className="registration-actions">
          {!registration.enrolled && !registration.capturing && (
            <button
              className="exercise-select-button is-selected"
              type="button"
              onClick={registration.step === 0 ? startRegistration : continueRegistration}
              disabled={!active}
            >
              {`Start ${['front', 'side', 'back'][registration.step]} view`}
            </button>
          )}
          {registration.capturing && (
            <button className="exercise-select-button" type="button" onClick={resetRegistration}>
              Cancel registration
            </button>
          )}
          {registration.enrolled && (
            <button className="exercise-select-button" type="button" onClick={startRegistration} disabled={!active}>
              Register again
            </button>
          )}
        </div>
        <p className="registration-disclaimer">
          Turn to each prompted view yourself; the camera does not verify direction. Pose matching is best-effort, not secure identity verification, and stays in this page session.
        </p>
      </div>

      <div className="exercise-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">WORKOUT TRACKER</span><h2>Exercise & reps</h2></div>
          <span className="side-indicator">
            {selectedExercise
              ? `${selectedExercise === 'pushup' ? 'Push-up' : 'Squat'} selected`
              : exercise ? `${exercise === 'pushup' ? 'Push-up' : 'Squat'} detected` : 'Detecting exercise'}
          </span>
        </div>
        <div className="exercise-select" role="group" aria-label="Choose exercise to count">
          <button
            className={`exercise-select-button ${selectedExercise === 'squat' ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={selectedExercise === 'squat'}
            onClick={() => selectExercise(selectedExercise === 'squat' ? null : 'squat')}
            disabled={!registration.enrolled}
          >
            Squat
          </button>
          <button
            className={`exercise-select-button ${selectedExercise === 'pushup' ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={selectedExercise === 'pushup'}
            onClick={() => selectExercise(selectedExercise === 'pushup' ? null : 'pushup')}
            disabled={!registration.enrolled}
          >
            Push-up
          </button>
          <button
            className={`exercise-select-button auto-select-button ${!selectedExercise ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={!selectedExercise}
            onClick={() => selectExercise(null)}
            disabled={!registration.enrolled}
          >
            Auto
          </button>
        </div>
        <p className="rep-guidance">{!registration.enrolled
          ? 'Complete registration before choosing an exercise or counting reps.'
          : active
            ? `${repMessage}${currentExercise === 'squat' && squatView === 'front'
              ? ' Turn to a side view for the clearest squat depth reading.'
              : ''}`
            : 'Start the camera, then face sideways with your full body in frame for the clearest squat depth. Keep feet planted for squats and hands steady for push-ups.'}</p>
        <div className="depth-readout">
          <div className="depth-readout-label">
            <span>
              {currentExercise === 'pushup'
                ? 'Elbow depth'
                : currentExercise === 'squat' ? `Knee depth · ${squatView} view${squatView === 'front' ? ' · 3D' : ''}` : 'Depth target'}
            </span>
            <strong>
              {currentExercise
                ? `${depthAngle == null ? '--' : `${Math.round(depthAngle)}°`} / ${
                  currentExercise === 'squat'
                    ? `${depthRange.min}°–${depthRange.max}°`
                    : `≤${depthTarget}°`
                }`
                : 'Select an exercise'}
            </strong>
          </div>
          <div
            className="depth-track"
            role="progressbar"
            aria-label="Exercise depth"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(depthProgress)}
          >
            <span
              className={`depth-fill ${withinDepthRange ? 'is-deep-enough' : ''}`}
              style={{ width: `${depthProgress}%` }}
            />
          </div>
        </div>
        <div className="rep-grid">
          <div className={`rep-card ${currentExercise === 'squat' ? 'is-current' : ''}`}>
            <span>Squats</span><strong>{reps.squat}</strong>
          </div>
          <div className={`rep-card ${currentExercise === 'pushup' ? 'is-current' : ''}`}>
            <span>Push-ups</span><strong>{reps.pushup}</strong>
          </div>
        </div>
        <button className="reset-button" onClick={resetReps} disabled={!reps.squat && !reps.pushup}>
          <RotateCcw size={14} /> Reset counts
        </button>
      </div>

      <div className="angles-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">LIVE BIOMECHANICS</span><h2>Joint angles</h2></div>
          <span className="side-indicator">{angles ? `${selectedSide} side selected` : 'Waiting for pose'}</span>
        </div>
        <div className="angle-grid">
          {visibleAngles ? visibleAngles.map((key) => (
            <div className="angle-value" key={key}>
              <span>{angleLabels[key]}</span>
              <strong>{angles[key] == null ? '--' : `${Math.round(angles[key])}°`}</strong>
            </div>
          )) : <p className="angle-empty">Angles appear when your body is detected.</p>}
        </div>
      </div>
    </section>
  );
}