import React from 'react';
import { Activity, ShieldCheck } from 'lucide-react';
import Camera from './components/Camera.jsx';

export default function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="wordmark" href="#top" aria-label="Rep.io home"><span className="wordmark-icon"><Activity size={17} /></span>rep.io</a>
        <div className="privacy-note"><ShieldCheck size={15} /><span>On-device only</span></div>
      </header>

      <div className="page-content" id="top">
        <section className="intro">
          <span className="eyebrow">MOVEMENT LAB / 01</span>
          <h1>REP<em>.IO</em></h1>
          <p>Real-time pose tracking, right in your browser.</p>
        </section>

        <Camera />

        <footer className="instruction-line">
          <span className="instruction-index">01</span>
          <span>Place the phone sideways, full body in frame.</span>
          <span className="local-badge"><i /> No video leaves your device</span>
        </footer>
      </div>
    </main>
  );
}