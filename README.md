# Rep.io

A browser-only camera and pose tracker built with Vite, React, and MediaPipe Pose Landmarker. Camera frames are processed locally in the browser and are never uploaded. The app downloads the MediaPipe runtime and lite model when it starts.

## Run this project

Install Node.js 20 or newer, then run these commands from this project directory in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Vite opens the app in your browser. If it does not, open the localhost URL printed in the terminal. In Windows PowerShell, use `npm.cmd` if the `npm` command is blocked by the script execution policy. Camera access is allowed on `localhost` or a secure HTTPS origin.

To create a fresh Vite + React project with the same dependencies:

```powershell
npm.cmd create vite@latest rep-io -- --template react
cd rep-io
npm.cmd install
npm.cmd install @mediapipe/tasks-vision lucide-react
npm.cmd run dev
```

## Test on a phone

For the simplest phone test, deploy the project to Vercel or Netlify and open its HTTPS URL on the phone. Camera permission requires a secure origin. `npm.cmd run dev -- --host 0.0.0.0` makes the development server reachable on your local network, but plain HTTP on a LAN address is not a secure origin in most mobile browsers; use a local HTTPS certificate setup or an HTTPS deployment for camera access.

## Current milestone

The current build includes camera start/stop and switching, on-device pose detection, a smoothed skeleton overlay with live hip, knee, and elbow angle annotations, FPS and detection status, smoothed live joint angles, and squat/push-up identification with separate rep counts. The mirrored camera preview and pose overlay are rendered together into a canvas to avoid layered video compositing artifacts. Inference is capped at 20 frames per second and the live UI refreshes at 10 frames per second to reduce main-thread work; the camera requests a moderate 960×540 stream with a 30 FPS cap. Before tracking, register one person for five continuous seconds in each prompted front, side, and back view. Front/back use a T-pose; the side step accepts a tall, relaxed stance to avoid rejecting a side-on person whose far arm is occluded. Live framing guidance prompts the user to move closer or farther, center in the frame, or adjust the registration pose. The included three-view image is a visual reference only—the camera checks pose quality and hold time but does not independently verify which direction the person is facing. Registration captures a session-only body-proportion profile from MediaPipe's 3D pose landmarks; rep counting is paused when multiple people are visible or the detected pose does not closely match that profile. Squat knee depth uses 3D pose landmarks where available, with the image-plane angle as a fallback; a side camera view remains the clearest and most reliable way to assess squat depth. In front view, the app recommends turning sideways and labels the reading as 3D. Pose matching is a best-effort consistency check, not secure or guaranteed identity recognition: pose landmarks can vary with camera placement, occlusion, clothing, and body position, and similar body proportions may match. No registration profile is saved beyond the page session.

Choose Squat or Push-up to count only that exercise, or select Auto for pose-based exercise detection. Squats work from either a side or front view: side view uses the clearest knee, while front view averages both visible knee angles. A squat rep requires the knee angle to stay in the 90–110 degree range for several steady frames; a push-up rep requires an elbow angle of 90 degrees or less held steadily. Both require a return to full extension. The body and visible foot (or wrist for push-ups) must settle before a rep starts, and sudden landmark jumps are damped to reduce glitch counts. Contact stability is a camera-based estimate, not a guarantee of physical floor contact. For best results, keep the camera still and keep one complete side of the body visible; the skeleton overlay is hidden when no side has all main joints detected.