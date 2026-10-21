# Gamma by MFX - standalone player

On Windows, double-click Start.cmd (Python 3 is required).
Or run `python serve.py`, then open http://127.0.0.1:8090/.
Use `python serve.py --verify-only` to check the package hashes.
Alternatively serve this entire directory with any static HTTP server.
No source checkout, oracle files, npm packages or network services are needed.
Browser ES modules and DecompressionStream support are required.
The title page links to https://www.pouet.net/prod.php?which=2516 and
https://github.com/kdrapel/mfx-gamma. The original credits are from NOTES.TXT;
the decorative cover is a freshly computed frame of the port.

Play computes the original visual sequence live through the original main-loop
exit, about 143 seconds. Space pauses/resumes; controls include restart,
next frame and fullscreen. Esc returns to the title; F toggles fullscreen.
Left/right jump sections. Choose from 15 major sections; Previous/Next move
between section starts. Six disk checkpoints load on demand for quick jumps.
The progress bar seeks to any time when released. The -15s/+15s buttons jump
backward/forward. Stats for geeks shows FPS, update time, audio latency,
graphics/audio lag, tracker position and original instruction count.
Rendering is uncapped; graphics follow the audible music playback clock.
Music is synthesized in a separate worker from the original tracker code and
samples into a bounded 145-second buffer. Preparation takes a few seconds.
Play starts audio; Mute preserves the audio clock. Pause, restart and chapter
jumps synchronize both sound and graphics. No recorded soundtrack is loaded.
No recorded frames or video are used. Original palette and lighting are retained.

It starts from documented capture-derived original resources and reconstructed
scheduler/tracker initialization. Full executable startup remains unported.
The startup scratch stack is outside the original flare image.
A documented clipping guard rejects entirely off-screen flare intervals that
otherwise cause an original-code invalid read for some live timing samples.
The manifest records the sampled full-state original-code/JS comparison used
to package it. That agreement does not prove every live sample, DOSBox's
floating-point/audio backend or original hardware timing. Audio uses the named
fixed-48000 GUS candidate with synchronous stop-ramp polling. Chapter seeking replays
short gaps from validated simulation inputs; arbitrary-time targets are then
computed from the restored state, with the original minimum frame interval.
The input RAM is original resource evidence, not a bank of output frames.
