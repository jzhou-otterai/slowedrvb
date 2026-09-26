// ---- palette (for canvas drawing) ----
var COLOR_SUB = '#646669';
var COLOR_MAIN = '#e2b714';
var COLOR_ERROR = '#ca4754';

// ---- shared audio graph ----
var audioContext;
var bassFilter, convolverNode, dryGain, wetGain, outputBus, volumeGain, pannerNode;

// ---- file mode (default) ----
var audioEl, mediaSource, filePeaks = null, peaksMax = 0.0001, peaksLive = false;
var analyser, analyserBuf, placeholderPeaks = null;
var sourceBuffer = null, isMp3 = false;   // decoded buffer + flag, for mp3 export
var WAVE_N = 1200;
var mobileSourceNode = null;
var mobileSourceStartedAt = 0;
var mobileSourceOffset = 0;
var mobileSourceRate = 1;
var mobileSourcePlaying = false;
var filePlaybackEngine = 'media'; // 'media' | 'buffer'
var autoLoopFilePlayback = true;

// ---- streaming mode ----
var streamSource, scriptNode, currentAudioTrack;
var circularBuffer, bufferLength = 0, writePos = 0, readPos = 0, isStreaming = false;

// ---- app mode ----
var appMode = 'file';            // 'file' | 'stream'

// ---- visualization ----
var VIZ_SECONDS = 60;
var vizRafId = null;

// ---- 8D auto-pan ----
var eightDEnabled = false;
var lfoOsc = null, lfoGain = null;

// ---- name shown under the disc ----
var fileName = '', tabName = '';

var ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
var ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

// ---- elements ----
var playbackControl = document.querySelector('#playback-rate-control');
var playbackValue = document.querySelector('#playback-rate-value');
var reverbMixControl = document.querySelector('#reverb-mix-control');
var reverbMixValue = document.querySelector('#reverb-mix-value');
var reverbDecayControl = document.querySelector('#reverb-decay-control');
var reverbDecayValue = document.querySelector('#reverb-decay-value');
var bassControl = document.querySelector('#bass-boost-control');
var bassValue = document.querySelector('#bass-boost-value');
var panControl = document.querySelector('#pan-control');
var panValue = document.querySelector('#pan-value');
var panSection = document.querySelector('#pan-section');
var btn8d = document.querySelector('#btn-8d');
var eightdSpeed = document.querySelector('#eightd-speed');
var eightdPeriodControl = document.querySelector('#eightd-period-control');
var eightdPeriodValue = document.querySelector('#eightd-period-value');
var statusEl = document.querySelector('#status');
var bufferCanvas = document.querySelector('#buffer-canvas');
var bufferCtx = bufferCanvas ? bufferCanvas.getContext('2d') : null;
var volumeControl = document.querySelector('#volume-control');
var fileInput = document.querySelector('#file-input');
var disc = document.querySelector('#disc');
var trackNameEl = document.querySelector('#track-name');
var playBtn = document.querySelector('#btn-play');
var btnAdvanced = document.querySelector('#btn-advanced');
var advanced = document.querySelector('#advanced');
var streamBtn = document.querySelector('#btn-stream');
var exportBtn = document.querySelector('#btn-export');
var jumpLiveBtn = document.querySelector('#btn-jump-live');
var rateTicks = document.querySelector('#rate-ticks');
var youtubeUrlInput = document.querySelector('#youtube-url-input');
var youtubeDownloadBtn = document.querySelector('#btn-youtube-download');
var youtubeCancelBtn = document.querySelector('#btn-youtube-cancel');
var mobileMoreOptionsBtn = document.querySelector('#btn-mobile-more-options');
var mobileMoreOptions = document.querySelector('#mobile-more-options');
var mobileChooseMp3 = document.querySelector('#btn-choose-mp3');
var savedSongsList = document.querySelector('#saved-songs-list');
var clearSongsBtn = document.querySelector('#btn-clear-songs');

var YOUTUBE_DOWNLOAD_ENDPOINT = 'https://jerryzhou.ca/ytdlp/download';
var YOUTUBE_DB_NAME = 'slowedrvb-local-media';
var YOUTUBE_STORE_NAME = 'youtube';
var MOBILE_MORE_OPTIONS_KEY = 'slowedrvb.mobileMoreOptionsOpen';
var SAMPLE_YOUTUBE_URL = 'https://www.youtube.com/watch?v=abc123xyz00';
var mobileLoadedYoutubeUrl = '';
var youtubePasteDownloadTimer = null;
var youtubeDownloadInFlight = false;
var youtubeDownloadController = null;
var youtubeDownloadCanceled = false;

function setStatus(text, className) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = 'status' + (className ? ' ' + className : '');
}

function setYoutubePromptStatus() {
  if (!statusEl) return;
  setStatus('paste a youtube URL.', '');
}

// youtube/download messages share the one status line under the waveform
function setMobileStatus(text, className) {
  setStatus(text, className);
}

function setYoutubeFetching(fetching) {
  youtubeDownloadInFlight = fetching;
  if (youtubeDownloadBtn) youtubeDownloadBtn.disabled = fetching;
  if (youtubeUrlInput) youtubeUrlInput.readOnly = fetching;
  if (youtubeCancelBtn) youtubeCancelBtn.hidden = !fetching;
}

function throwIfYoutubeCanceled() {
  if (!youtubeDownloadCanceled) return;
  var err = new Error('download canceled');
  err.name = 'AbortError';
  throw err;
}

function isValidYoutubeUrl(value) {
  var url;
  try {
    url = new URL(value);
  } catch (e) {
    return false;
  }

  var protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return false;

  var normalized = value.toLowerCase();
  return normalized.indexOf('youtube') !== -1 || url.hostname.toLowerCase() === 'youtu.be';
}

function startYoutubePlaceholderTyping() {
  if (!youtubeUrlInput) return;
  var fallback = 'youtube url';
  var index = 0;
  var deleting = false;

  function tick() {
    if (youtubeUrlInput.value) {
      youtubeUrlInput.placeholder = fallback;
    } else {
      if (deleting) {
        index = Math.max(0, index - 1);
        youtubeUrlInput.placeholder = SAMPLE_YOUTUBE_URL.slice(0, index);
        if (index === 0) {
          deleting = false;
          setTimeout(tick, 600);
          return;
        }
      } else {
        youtubeUrlInput.placeholder = SAMPLE_YOUTUBE_URL.slice(0, index);
        index++;
        if (index > SAMPLE_YOUTUBE_URL.length) {
          deleting = true;
          setTimeout(tick, 1600);
          return;
        }
      }
    }
    setTimeout(tick, deleting ? 35 : 55);
  }

  tick();
}

function focusYoutubeInputOnDesktop() {
  if (!youtubeUrlInput || isMobileViewport()) return;
  requestAnimationFrame(function () {
    try {
      youtubeUrlInput.focus({ preventScroll: true });
    } catch (e) {
      youtubeUrlInput.focus();
    }
  });
}

function currentRate() {
  return playbackControl ? parseFloat(playbackControl.value) : 1.0;
}

// 0× floor always; uploads can speed up to 1.5×, live streams cap at 1× (can't read past the live edge)
function setRateRange(maxRate) {
  if (!playbackControl) return;
  playbackControl.min = 0;
  playbackControl.max = maxRate;
  if (currentRate() > maxRate) {
    playbackControl.value = maxRate;
    if (playbackValue) playbackValue.textContent = maxRate.toFixed(2);
    if (audioEl) audioEl.playbackRate = maxRate;
    updateSpinDuration();
  }
  if (rateTicks && rateTicks.children.length >= 3) {
    rateTicks.children[0].textContent = '0×';
    rateTicks.children[1].textContent = parseFloat((maxRate / 2).toFixed(2)) + '×';
    rateTicks.children[2].textContent = parseFloat(maxRate.toFixed(2)) + '×';
  }
}

function showTrackName() {
  if (trackNameEl) trackNameEl.textContent = (appMode === 'stream') ? tabName : fileName;
}

// ---- vinyl spin: rotation speed proportional to playback rate ----
function setSpin(on) {
  if (disc) disc.classList.toggle('spinning', on);
}

function updateSpinDuration() {
  document.documentElement.style.setProperty('--rotation-duration', (1 / Math.max(0.05, currentRate())) + 's');
}

function isPlaying() {
  if (appMode === 'stream') return isStreaming;
  if (useMobileBufferPlayback()) return mobileSourcePlaying;
  return !!(audioEl && !audioEl.paused);
}

function updatePlayIcon() {
  if (playBtn) playBtn.innerHTML = isPlaying() ? ICON_PAUSE : ICON_PLAY;
  updateMobileYoutubeAction();
}

function showPlayButton() {
  var has = (appMode === 'stream') ? !!currentAudioTrack : !!(useMobileBufferPlayback() || (audioEl && audioEl.src));
  if (playBtn) playBtn.disabled = !has;
}

// ---- reverb impulse response ----
function generateImpulseResponse(ctx, duration, decay) {
  var sampleRate = ctx.sampleRate;
  var length = Math.max(1, Math.floor(sampleRate * duration));
  var impulse = ctx.createBuffer(2, length, sampleRate);
  for (var ch = 0; ch < 2; ch++) {
    var data = impulse.getChannelData(ch);
    for (var i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

// Debounced: regenerating a multi-second impulse on every slider tick starves the
// audio thread (the crackle), and swapping the convolver buffer cuts the live reverb
// tail (the click). Wait for the drag to settle, then duck the wet path across the swap.
var decayTimer = null;
function scheduleImpulse() {
  clearTimeout(decayTimer);
  decayTimer = setTimeout(rebuildImpulse, 150);
}

function rebuildImpulse() {
  if (!audioContext || !convolverNode) return;
  var decay = reverbDecayControl ? parseFloat(reverbDecayControl.value) : 3.0;
  var newBuf = generateImpulseResponse(audioContext, decay, 2.5);
  if (!wetGain) { convolverNode.buffer = newBuf; return; }
  var mix = (reverbMixControl ? parseInt(reverbMixControl.value, 10) : 0) / 100;
  var now = audioContext.currentTime;
  wetGain.gain.cancelScheduledValues(now);
  wetGain.gain.setValueAtTime(wetGain.gain.value, now);
  wetGain.gain.linearRampToValueAtTime(0, now + 0.02);
  setTimeout(function () {
    convolverNode.buffer = newBuf;
    var t = audioContext.currentTime;
    wetGain.gain.cancelScheduledValues(t);
    wetGain.gain.setValueAtTime(0, t);
    wetGain.gain.linearRampToValueAtTime(mix, t + 0.02);
  }, 25);
}

// ---- effect setters ----
function applyReverbMix(mix01) {
  if (dryGain) dryGain.gain.value = 1 - mix01;
  if (wetGain) wetGain.gain.value = mix01;
}

function applyBass(db) {
  if (bassFilter) bassFilter.gain.value = db;
}

function applyPan(pan) {
  if (!pannerNode) return;
  var az = pan * 80 * Math.PI / 180;
  var x = Math.sin(az);
  var z = -Math.cos(az);
  if (pannerNode.positionX) {
    pannerNode.positionX.value = x;
    pannerNode.positionY.value = 0;
    pannerNode.positionZ.value = z;
  } else if (pannerNode.setPosition) {
    pannerNode.setPosition(x, 0, z);
  }
}

function formatPan(p) {
  if (p === 0) return 'C';
  return (p < 0 ? 'L ' : 'R ') + Math.abs(p);
}

function currentVolume() {
  if (!volumeControl) return 1;
  var parsed = parseInt(volumeControl.value, 10);
  if (isNaN(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed / 100));
}

function applyVolume(volume) {
  var safeVolume = Math.max(0, Math.min(1, volume));
  if (volumeGain) volumeGain.gain.value = safeVolume;
  if (volumeControl) volumeControl.style.setProperty('--volume-progress', (safeVolume * 100) + '%');
}

// HRTF panner colors the sound even at center, so only route through it when used.
function routeOutput() {
  if (!outputBus || !audioContext) return;
  var spatial = eightDEnabled || (panControl && parseInt(panControl.value, 10) !== 0);
  outputBus.disconnect();
  if (!volumeGain) {
    outputBus.connect(spatial ? pannerNode : audioContext.destination);
    return;
  }
  volumeGain.disconnect();
  outputBus.connect(volumeGain);
  volumeGain.connect(spatial ? pannerNode : audioContext.destination);
}

// ---- 8D sweep ----
function start8D() {
  if (!audioContext || !pannerNode || !pannerNode.positionX) return;
  stop8D();
  var period = eightdPeriodControl ? parseFloat(eightdPeriodControl.value) : 8;
  lfoOsc = audioContext.createOscillator();
  lfoOsc.type = 'sine';
  lfoOsc.frequency.value = 1 / period;
  lfoGain = audioContext.createGain();
  lfoGain.gain.value = 1.0;
  pannerNode.positionX.value = 0;
  pannerNode.positionY.value = 0;
  pannerNode.positionZ.value = -0.3;
  lfoOsc.connect(lfoGain);
  lfoGain.connect(pannerNode.positionX);
  lfoOsc.start();
}

function stop8D() {
  if (lfoOsc) {
    try { lfoOsc.stop(); } catch (e) {}
    lfoOsc.disconnect();
    lfoOsc = null;
  }
  if (lfoGain) {
    lfoGain.disconnect();
    lfoGain = null;
  }
}

function updateEightDUI() {
  if (btn8d) {
    btn8d.textContent = eightDEnabled ? 'on' : 'off';
    btn8d.classList.toggle('active', eightDEnabled);
    btn8d.setAttribute('aria-pressed', eightDEnabled ? 'true' : 'false');
  }
  if (eightdSpeed) eightdSpeed.hidden = !eightDEnabled;
  if (panControl) panControl.disabled = eightDEnabled;
  if (panSection) panSection.classList.toggle('disabled', eightDEnabled);
  if (panValue) {
    panValue.textContent = eightDEnabled
      ? '8D'
      : formatPan(panControl ? parseInt(panControl.value, 10) : 0);
  }
}

window.toggle_8d = function () {
  eightDEnabled = !eightDEnabled;
  updateEightDUI();
  if (eightDEnabled) {
    if (audioContext) start8D();
  } else {
    stop8D();
    applyPan(panControl ? parseInt(panControl.value, 10) / 100 : 0);
  }
  routeOutput();
};

window.toggle_advanced = function () {
  if (!advanced) return;
  var open = advanced.hidden;
  advanced.hidden = !open;
  document.documentElement.classList.toggle('mobile-scroll-open', open);
  document.body.classList.toggle('mobile-scroll-open', open);
  if (btnAdvanced) {
    btnAdvanced.textContent = open ? 'hide advanced ▴' : 'show advanced ▾';
    btnAdvanced.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
};

function configureAudioElementPitch(el) {
  try { el.preservesPitch = false; } catch (e) {}
  try { el.mozPreservesPitch = false; } catch (e) {}
  try { el.webkitPreservesPitch = false; } catch (e) {}
}

function ensureAudioElement() {
  if (audioEl) return;
  audioEl = new Audio();
  audioEl.preload = 'auto';
  audioEl.loop = autoLoopFilePlayback;
  audioEl.playsInline = true;
  audioEl.setAttribute('playsinline', '');
  configureAudioElementPitch(audioEl);
  audioEl.addEventListener('play', function () { setSpin(true); updatePlayIcon(); updateMediaSessionState(); });
  audioEl.addEventListener('pause', function () { setSpin(false); updatePlayIcon(); updateMediaSessionState(); });
  audioEl.addEventListener('ended', function () { setSpin(false); updatePlayIcon(); updateMediaSessionState(); });
}

// ---- build the shared effect chain once ----
function ensureAudio() {
  if (audioContext) return;
  // ponytail: iOS 17+ keeps Web Audio alive in background / with phone muted when session is "playback"
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  bassFilter = audioContext.createBiquadFilter();
  bassFilter.type = 'lowshelf';
  bassFilter.frequency.value = 160;

  convolverNode = audioContext.createConvolver();
  dryGain = audioContext.createGain();
  wetGain = audioContext.createGain();
  outputBus = audioContext.createGain();
  volumeGain = audioContext.createGain();
  volumeGain.gain.value = currentVolume();

  pannerNode = audioContext.createPanner();
  pannerNode.panningModel = 'HRTF';
  pannerNode.distanceModel = 'inverse';
  pannerNode.refDistance = 1;
  pannerNode.rolloffFactor = 0;

  bassFilter.connect(dryGain);
  dryGain.connect(outputBus);
  bassFilter.connect(convolverNode);
  convolverNode.connect(wetGain);
  wetGain.connect(outputBus);
  pannerNode.connect(audioContext.destination);

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyserBuf = new Float32Array(analyser.fftSize);
  bassFilter.connect(analyser);   // taps audio to draw a live waveform when decode fails

  rebuildImpulse();
  applyReverbMix((reverbMixControl ? parseInt(reverbMixControl.value, 10) : 0) / 100);
  applyBass(bassControl ? parseFloat(bassControl.value) : 0);
  applyPan(panControl ? parseInt(panControl.value, 10) / 100 : 0);
  applyVolume(currentVolume());
  routeOutput();
  if (eightDEnabled) start8D();
}

function useMobileBufferPlayback() {
  return appMode === 'file' && filePlaybackEngine === 'buffer' && !!sourceBuffer;
}

function normalizeFileLoopTime(time, duration) {
  if (!duration) return 0;
  if (!autoLoopFilePlayback) return Math.max(0, Math.min(duration, time));
  var wrapped = time % duration;
  return wrapped < 0 ? wrapped + duration : wrapped;
}

function mobileBufferCurrentTime() {
  if (!sourceBuffer) return 0;
  var duration = sourceBuffer.duration || 0;
  if (!duration) return 0;
  if (!mobileSourcePlaying) return normalizeFileLoopTime(mobileSourceOffset, duration);
  var elapsed = (audioContext.currentTime - mobileSourceStartedAt) * mobileSourceRate;
  return normalizeFileLoopTime(mobileSourceOffset + elapsed, duration);
}

function stopMobileBufferSource(updateOffset) {
  if (updateOffset) mobileSourceOffset = mobileBufferCurrentTime();
  if (mobileSourceNode) {
    mobileSourceNode.onended = null;
    try { mobileSourceNode.stop(); } catch (e) {}
    try { mobileSourceNode.disconnect(); } catch (e) {}
    mobileSourceNode = null;
  }
  mobileSourcePlaying = false;
}

function startMobileBufferPlayback(offset) {
  if (!sourceBuffer || !audioContext) return false;
  var duration = sourceBuffer.duration || 0;
  if (!duration) return false;
  if (audioContext.state === 'suspended') audioContext.resume();

  stopMobileBufferSource(false);
  var startOffset = (typeof offset === 'number') ? offset : (mobileSourceOffset || 0);
  mobileSourceOffset = normalizeFileLoopTime(startOffset, duration);

  var node = audioContext.createBufferSource();
  node.buffer = sourceBuffer;
  node.loop = autoLoopFilePlayback;
  node.playbackRate.value = currentRate();
  node.connect(bassFilter);
  mobileSourceNode = node;
  mobileSourceRate = currentRate();
  mobileSourceStartedAt = audioContext.currentTime;
  mobileSourcePlaying = true;

  node.onended = function () {
    if (mobileSourceNode !== node) return;
    mobileSourceNode = null;
    mobileSourcePlaying = false;
    mobileSourceOffset = 0;
    setSpin(false);
    updatePlayIcon();
    updateMediaSessionState();
  };

  node.start(0, mobileSourceOffset);
  setSpin(true);
  updatePlayIcon();
  updateMediaSessionState();
  return true;
}

function pauseMobileBufferPlayback() {
  stopMobileBufferSource(true);
  setSpin(false);
  updatePlayIcon();
  updateMediaSessionState();
}

function restartMobileBufferAtCurrentRate() {
  if (!useMobileBufferPlayback() || !mobileSourcePlaying) return;
  startMobileBufferPlayback(mobileBufferCurrentTime());
}

function fileModeDuration() {
  if (useMobileBufferPlayback()) return sourceBuffer.duration || 0;
  return (audioEl && audioEl.duration) || 0;
}

function fileModeCurrentTime() {
  if (useMobileBufferPlayback()) return mobileBufferCurrentTime();
  return (audioEl && audioEl.currentTime) || 0;
}

function seekFileMode(time) {
  if (appMode !== 'file') return;
  var duration = fileModeDuration();
  if (!duration) return;
  var nextTime = Math.max(0, Math.min(duration, time));
  if (useMobileBufferPlayback()) {
    mobileSourceOffset = nextTime;
    if (mobileSourcePlaying) startMobileBufferPlayback(nextTime);
  } else if (audioEl) {
    audioEl.currentTime = nextTime;
  }
  updateMediaSessionState();
}

function updateMediaSessionMetadata() {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: (appMode === 'stream' ? tabName : fileName) || 'slow playback audio',
      artist: 'slowedrvb',
    });
  } catch (e) {}
}

function updateMediaSessionState() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = isPlaying() ? 'playing' : 'paused';
    if (navigator.mediaSession.setPositionState && appMode === 'file' && fileModeDuration()) {
      navigator.mediaSession.setPositionState({
        duration: fileModeDuration(),
        playbackRate: Math.max(0.05, currentRate()),
        position: fileModeCurrentTime(),
      });
    }
  } catch (e) {}
}

function setMediaSessionAction(name, handler) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setActionHandler) return;
  try { navigator.mediaSession.setActionHandler(name, handler); } catch (e) {}
}

function setupMediaSession() {
  setMediaSessionAction('play', function () {
    if (!isPlaying()) window.toggle_play();
  });
  setMediaSessionAction('pause', function () {
    if (isPlaying()) window.toggle_play();
  });
  setMediaSessionAction('seekbackward', function (details) {
    seekFileMode(fileModeCurrentTime() - ((details && details.seekOffset) || 10));
  });
  setMediaSessionAction('seekforward', function (details) {
    seekFileMode(fileModeCurrentTime() + ((details && details.seekOffset) || 10));
  });
  setMediaSessionAction('seekto', function (details) {
    if (details && typeof details.seekTime === 'number') seekFileMode(details.seekTime);
  });
}

function isKeyboardInputTarget(target) {
  if (!target || target === document.body || target === document.documentElement) return false;
  var tag = target.tagName ? target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return true;
  if (target.isContentEditable) return true;
  return !!(target.closest && target.closest('[contenteditable="true"], [role="textbox"], [role="slider"]'));
}

function seekByKeyboard(seconds) {
  if (appMode !== 'file' || !fileModeDuration()) return false;
  seekFileMode(fileModeCurrentTime() + seconds);
  drawFileWave();
  return true;
}

function seekToFileEdge(edge) {
  var duration = fileModeDuration();
  if (appMode !== 'file' || !duration) return false;
  seekFileMode(edge === 'end' ? duration : 0);
  drawFileWave();
  return true;
}

function jumpLiveByKeyboard() {
  if (appMode !== 'stream' || !circularBuffer) return false;
  window.refresh_stream();
  return true;
}

function handleMediaKeydown(e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isKeyboardInputTarget(e.target)) return;

  var key = e.key || '';
  var lowerKey = key.length === 1 ? key.toLowerCase() : key;
  var seekStep = e.shiftKey ? 30 : 10;
  var handled = false;

  if ((key === ' ' || key === 'Spacebar' || e.code === 'Space' || lowerKey === 'k' || key === 'MediaPlayPause') && !e.repeat) {
    window.toggle_play();
    handled = true;
  } else if (key === 'MediaPlay' && !e.repeat) {
    if (!isPlaying()) window.toggle_play();
    handled = true;
  } else if ((key === 'MediaPause' || key === 'MediaStop') && !e.repeat) {
    if (isPlaying()) window.toggle_play();
    handled = true;
  } else if (key === 'ArrowLeft' || lowerKey === 'j' || key === 'MediaTrackPrevious') {
    handled = seekByKeyboard(-seekStep);
  } else if (key === 'ArrowRight' || lowerKey === 'l' || key === 'MediaTrackNext') {
    handled = seekByKeyboard(seekStep) || (key === 'MediaTrackNext' && jumpLiveByKeyboard());
  } else if (key === 'Home') {
    handled = seekToFileEdge('start');
  } else if (key === 'End') {
    handled = seekToFileEdge('end') || jumpLiveByKeyboard();
  }

  if (handled) e.preventDefault();
}

// ============================ FILE MODE ============================

async function load_file(file) {
  ensureAudio();
  if (appMode === 'stream') stopStreamFully();
  stopMobileBufferSource(false);
  appMode = 'file';
  var mobileMode = isMobileViewport();
  filePlaybackEngine = mobileMode ? 'buffer' : 'media';

  ensureAudioElement();
  if (!mediaSource) mediaSource = audioContext.createMediaElementSource(audioEl);  // once per element
  mediaSource.disconnect();

  setRateRange(1.5);
  audioEl.pause();
  configureAudioElementPitch(audioEl);
  audioEl.playbackRate = currentRate();
  fileName = file.name || '';
  isMp3 = /audio\/(mpeg|mp3)/i.test(file.type) || /\.mp3$/i.test(fileName);
  setStatus('loading...', '');

  if (mobileMode) {
    audioEl.removeAttribute('src');
    audioEl.load();
    await decodeFile(file);
    if (!sourceBuffer) {
      filePlaybackEngine = 'media';
      mediaSource.connect(bassFilter);
      audioEl.src = URL.createObjectURL(file);
      configureAudioElementPitch(audioEl);
      audioEl.playbackRate = currentRate();
    }
  } else {
    mediaSource.connect(bassFilter);
    audioEl.src = URL.createObjectURL(file);
    decodeFile(file);
  }

  showTrackName();
  showPlayButton();
  updatePlayIcon();
  updateLiveJumpUI();
  updateMediaSessionMetadata();
  updateMediaSessionState();
  updateSpinDuration();
  startViz();
  setStatus('loaded — hit play.', '');
}

// Decode the whole file once: drives the full static waveform and the mp3 export.
// If the decoder rejects it, fall back to filling the waveform live as it plays.
async function decodeFile(file) {
  filePeaks = new Float32Array(WAVE_N);   // start empty
  peaksMax = 0.0001;
  peaksLive = true;
  sourceBuffer = null;
  updateExportUI();
  try {
    var audioBuf = await audioContext.decodeAudioData(await file.arrayBuffer());
    sourceBuffer = audioBuf;
    var ch = audioBuf.getChannelData(0);
    var block = Math.floor(ch.length / WAVE_N) || 1;
    for (var i = 0; i < WAVE_N; i++) {
      var start = i * block, end = Math.min(ch.length, start + block), mx = 0;
      for (var j = start; j < end; j++) { var a = Math.abs(ch[j]); if (a > mx) mx = a; }
      filePeaks[i] = mx;
      if (mx > peaksMax) peaksMax = mx;
    }
    mobileSourceOffset = 0;
    mobileSourceRate = currentRate();
    peaksLive = false;   // got the whole thing up front
  } catch (e) {
    peaksLive = true;    // decoder refused it — fill in live while it plays
  }
  updateExportUI();
}

window.choose_file = function () { if (fileInput) fileInput.click(); };

if (mobileChooseMp3) {
  mobileChooseMp3.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    window.choose_file();
  });
}

if (fileInput) {
  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    if (f) {
      mobileLoadedYoutubeUrl = '';
      if (youtubeUrlInput) youtubeUrlInput.value = '';
      load_file(f).then(updateMobileYoutubeAction);
    }
  });
}

function isMobileViewport() {
  return window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
}

function openYoutubeDb() {
  return new Promise(function (resolve, reject) {
    if (!window.indexedDB) {
      reject(new Error('local media storage is unavailable.'));
      return;
    }

    var req = indexedDB.open(YOUTUBE_DB_NAME, 1);
    req.onupgradeneeded = function () {
      req.result.createObjectStore(YOUTUBE_STORE_NAME);
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('could not open local media storage.')); };
  });
}

// keyed by the youtube url so each downloaded song persists and can be looked up by link
function saveYoutubeTrack(file, sourceUrl) {
  return openYoutubeDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(YOUTUBE_STORE_NAME, 'readwrite');
      tx.objectStore(YOUTUBE_STORE_NAME).put({
        blob: file,
        name: file.name,
        type: file.type,
        sourceUrl: sourceUrl,
        savedAt: Date.now(),
      }, sourceUrl);
      tx.oncomplete = function () { db.close(); resolve(); };
      tx.onerror = function () {
        var err = tx.error || new Error('could not save local media.');
        db.close();
        reject(err);
      };
    });
  });
}

function getSavedYoutubeTrack(sourceUrl) {
  return openYoutubeDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(YOUTUBE_STORE_NAME, 'readonly');
      var req = tx.objectStore(YOUTUBE_STORE_NAME).get(sourceUrl);
      req.onsuccess = function () {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = function () {
        var err = req.error || new Error('could not read local media.');
        db.close();
        reject(err);
      };
    });
  });
}

// every saved track, newest first
function listSavedYoutubeTracks() {
  return openYoutubeDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(YOUTUBE_STORE_NAME, 'readonly');
      var req = tx.objectStore(YOUTUBE_STORE_NAME).getAll();
      req.onsuccess = function () {
        db.close();
        var rows = (req.result || []).filter(function (r) { return r && r.blob; });
        rows.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
        resolve(rows);
      };
      req.onerror = function () {
        var err = req.error || new Error('could not read local media.');
        db.close();
        reject(err);
      };
    });
  });
}

function clearSavedYoutubeTracks() {
  return openYoutubeDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(YOUTUBE_STORE_NAME, 'readwrite');
      tx.objectStore(YOUTUBE_STORE_NAME).clear();
      tx.oncomplete = function () { db.close(); resolve(); };
      tx.onerror = function () {
        var err = tx.error || new Error('could not clear local media.');
        db.close();
        reject(err);
      };
    });
  });
}

function filenameFromDisposition(header) {
  if (!header) return '';
  var utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8 && utf8[1]) return decodeURIComponent(utf8[1].replace(/^"|"$/g, ''));
  var plain = header.match(/filename="?([^";]+)"?/i);
  return plain && plain[1] ? plain[1] : '';
}

function extensionForType(type) {
  if (/mpeg|mp3/i.test(type)) return '.mp3';
  if (/mp4/i.test(type)) return '.mp4';
  if (/webm/i.test(type)) return '.webm';
  if (/ogg/i.test(type)) return '.ogg';
  return '.mp3';
}

function fileFromDownload(blob, response) {
  var name = filenameFromDisposition(response.headers.get('content-disposition'));
  if (!name) name = 'youtube-audio' + extensionForType(blob.type);
  return new File([blob], name, { type: blob.type || 'audio/mpeg' });
}

function hasLoadedFileTrack() {
  return appMode === 'file' && !!(sourceBuffer || (audioEl && audioEl.src));
}

function hasLoadedMobileYoutubeUrl() {
  var sourceUrl = youtubeUrlInput ? youtubeUrlInput.value.trim() : '';
  return !!(sourceUrl && mobileLoadedYoutubeUrl && sourceUrl === mobileLoadedYoutubeUrl && hasLoadedFileTrack());
}

function mobilePrimaryActionPlaysLoadedTrack() {
  var sourceUrl = youtubeUrlInput ? youtubeUrlInput.value.trim() : '';
  return hasLoadedFileTrack() && (!sourceUrl || hasLoadedMobileYoutubeUrl());
}

function updateMobileYoutubeAction() {
  if (!youtubeDownloadBtn) return;
  var sourceUrl = youtubeUrlInput ? youtubeUrlInput.value.trim() : '';
  var playsLoadedTrack = mobilePrimaryActionPlaysLoadedTrack();
  youtubeDownloadBtn.textContent = playsLoadedTrack
    ? (isPlaying() ? 'pause' : 'play')
    : (sourceUrl ? 'download' : 'play');
  youtubeDownloadBtn.setAttribute(
    'aria-label',
    playsLoadedTrack
      ? (isPlaying() ? 'pause loaded audio' : 'play loaded audio')
      : (sourceUrl ? 'download youtube audio' : 'play loaded audio')
  );
}

function readMobileMoreOptionsOpen() {
  try {
    return localStorage.getItem(MOBILE_MORE_OPTIONS_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

function setMobileMoreOptionsOpen(open) {
  if (mobileMoreOptions) mobileMoreOptions.hidden = !open;
  if (mobileMoreOptionsBtn) {
    mobileMoreOptionsBtn.textContent = open ? 'fewer options ▴' : 'more options ▾';
    mobileMoreOptionsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  try {
    localStorage.setItem(MOBILE_MORE_OPTIONS_KEY, open ? 'true' : 'false');
  } catch (e) {}
}

window.toggle_mobile_more_options = function () {
  setMobileMoreOptionsOpen(!(mobileMoreOptions && !mobileMoreOptions.hidden));
};

async function restoreSavedYoutubeTrack() {
  if (!isMobileViewport()) return;
  try {
    var saved = (await listSavedYoutubeTracks())[0];
    if (!saved || !saved.blob) return;
    var file = new File([saved.blob], saved.name || 'youtube-audio.mp3', {
      type: saved.type || saved.blob.type || 'audio/mpeg',
    });
    if (youtubeUrlInput && saved.sourceUrl) youtubeUrlInput.value = saved.sourceUrl;
    mobileLoadedYoutubeUrl = saved.sourceUrl || '';
    await load_file(file);
    updateMobileYoutubeAction();
    setMobileStatus('saved track ready.', 'ready');
  } catch (e) {}
}

// Load a track into the player WITHOUT auto-starting it. iOS only unlocks audio
// inside a real user gesture, and the gesture is gone after an async download —
// so we prompt the user to press play (which resumes the context within its tap).
async function loadTrack(file, sourceUrl) {
  mobileLoadedYoutubeUrl = sourceUrl || '';
  if (youtubeUrlInput && sourceUrl) youtubeUrlInput.value = sourceUrl;
  await load_file(file);
  updateMobileYoutubeAction();   // download button now reads "play"
}

function loadSavedTrack(saved) {
  var file = new File([saved.blob], saved.name || 'youtube-audio.mp3', {
    type: saved.type || saved.blob.type || 'audio/mpeg',
  });
  return loadTrack(file, saved.sourceUrl || '');
}

function scheduleYoutubePasteDownload() {
  clearTimeout(youtubePasteDownloadTimer);
  youtubePasteDownloadTimer = setTimeout(function () {
    startYoutubeDownloadFromInput(true);
  }, 0);
}

function startYoutubeDownloadFromInput(blurOnValidUrl) {
  if (!youtubeUrlInput || !youtubeUrlInput.value.trim()) return;
  if (youtubeDownloadInFlight) return;
  if (hasLoadedMobileYoutubeUrl()) {
    if (blurOnValidUrl && isValidYoutubeUrl(youtubeUrlInput.value.trim())) youtubeUrlInput.blur();
    return;
  }
  window.download_youtube(blurOnValidUrl);
}

// stream the response so we can show real transfer progress instead of one frozen "downloading…"
async function readBlobWithProgress(response) {
  var total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !response.body.getReader) return response.blob(); // ponytail: old browsers, just await the blob
  var reader = response.body.getReader();
  var chunks = [];
  var received = 0;
  while (true) {
    var step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    received += step.value.length;
    var mb = (received / 1048576).toFixed(1);
    setMobileStatus(
      total ? 'receiving audio… ' + Math.round((received / total) * 100) + '% (' + mb + ' MB)'
            : 'receiving audio… ' + mb + ' MB',
      'streaming'
    );
  }
  return new Blob(chunks, { type: response.headers.get('content-type') || '' });
}

window.download_youtube = async function (blurOnValidUrl) {
  if (youtubeDownloadInFlight) return;
  var sourceUrl = youtubeUrlInput ? youtubeUrlInput.value.trim() : '';

  if (mobilePrimaryActionPlaysLoadedTrack() || !sourceUrl) {
    window.toggle_play();
    updateMobileYoutubeAction();
    return;
  }

  if (!isValidYoutubeUrl(sourceUrl)) {
    setMobileStatus('enter a valid youtube url.', 'error');
    return;
  }

  if (blurOnValidUrl && youtubeUrlInput) youtubeUrlInput.blur();

  if (mobilePrimaryActionPlaysLoadedTrack()) {
    window.toggle_play();
    updateMobileYoutubeAction();
    return;
  }

  setYoutubeFetching(true);
  youtubeDownloadCanceled = false;
  youtubeDownloadController = typeof AbortController !== 'undefined' ? new AbortController() : null;

  try {
    // already downloaded this link? load from local cache, skip the network.
    var cached = await getSavedYoutubeTrack(sourceUrl);
    throwIfYoutubeCanceled();
    if (cached && cached.blob) {
      await loadSavedTrack(cached);
      throwIfYoutubeCanceled();
      setMobileStatus('ready — press play.', 'ready');
      return;
    }

    setMobileStatus('connecting to server…', 'streaming');
    // server runs yt-dlp before sending headers, so this await IS the "fetching" wait
    setMobileStatus('fetching from youtube…', 'streaming');
    var response = await fetch(
      YOUTUBE_DOWNLOAD_ENDPOINT + '?url=' + encodeURIComponent(sourceUrl),
      youtubeDownloadController ? { signal: youtubeDownloadController.signal } : undefined
    );
    if (!response.ok) {
      var message = '';
      try { message = await response.text(); } catch (e) {}
      throw new Error(message || ('download failed: ' + response.status));
    }

    var blob = await readBlobWithProgress(response);
    throwIfYoutubeCanceled();
    var file = fileFromDownload(blob, response);
    setMobileStatus('saving locally…', 'streaming');
    await saveYoutubeTrack(file, sourceUrl);
    renderSavedSongs();
    throwIfYoutubeCanceled();
    await loadTrack(file, sourceUrl);
    setMobileStatus('saved — press play.', 'ready');
  } catch (e) {
    if (youtubeDownloadCanceled || (e && e.name === 'AbortError')) {
      setMobileStatus('download canceled.', '');
    } else {
      setMobileStatus(e && e.message ? e.message : 'download failed.', 'error');
    }
  } finally {
    setYoutubeFetching(false);
    youtubeDownloadController = null;
    youtubeDownloadCanceled = false;
  }
};

window.cancel_youtube_download = function () {
  if (!youtubeDownloadInFlight) return;
  youtubeDownloadCanceled = true;
  if (youtubeDownloadController) youtubeDownloadController.abort();
  setMobileStatus('canceling download…', '');
};

// always-visible list of saved songs, newest first
async function renderSavedSongs() {
  if (!savedSongsList) return;
  var rows;
  try { rows = await listSavedYoutubeTracks(); } catch (e) { rows = []; }
  savedSongsList.textContent = '';
  if (!rows.length) {
    var empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'no saved songs yet.';
    savedSongsList.appendChild(empty);
  } else {
    rows.forEach(function (row) {
      var li = document.createElement('li');
      li.textContent = row.name || row.sourceUrl || 'untitled';
      li.title = row.sourceUrl || '';
      li.addEventListener('click', function () {
        loadSavedTrack(row).then(function () {
          setMobileStatus('ready — press play.', 'ready');
        });
      });
      savedSongsList.appendChild(li);
    });
  }
  if (clearSongsBtn) clearSongsBtn.hidden = !rows.length;   // only when there are songs to clear
}

window.clear_saved_songs = async function () {
  try {
    await clearSavedYoutubeTracks();
    renderSavedSongs();
    setMobileStatus('cleared saved songs.', 'ready');
  } catch (e) {
    setMobileStatus('could not clear saved songs.', 'error');
  }
};

if (youtubeUrlInput) {
  youtubeUrlInput.addEventListener('paste', function () {
    scheduleYoutubePasteDownload();
  });
  youtubeUrlInput.addEventListener('input', function (e) {
    updateMobileYoutubeAction();
    if (e && e.inputType === 'insertFromPaste') scheduleYoutubePasteDownload();
  });
  youtubeUrlInput.addEventListener('blur', function () {
    startYoutubeDownloadFromInput(false);
  });
  youtubeUrlInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    startYoutubeDownloadFromInput(true);
  });
}

// unified play/pause for both modes
window.toggle_play = function () {
  if (appMode === 'stream') {
    if (!currentAudioTrack || currentAudioTrack.readyState !== 'live') {
      setStatus('press "stream (tab)" to capture a tab first.', '');
      return;
    }
    if (isStreaming) pauseStream(); else resumeStream();
  } else {
    if (useMobileBufferPlayback()) {
      if (mobileSourcePlaying) pauseMobileBufferPlayback();
      else startMobileBufferPlayback(mobileSourceOffset);
      return;
    }
    if (!audioEl || !audioEl.src) { setStatus('choose a file first.', ''); return; }
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    if (audioEl.paused) audioEl.play(); else audioEl.pause();
  }
};

// drag a file straight onto the disc
if (disc) {
  disc.addEventListener('dragover', function (e) { e.preventDefault(); disc.classList.add('dragover'); });
  disc.addEventListener('dragleave', function () { disc.classList.remove('dragover'); });
  disc.addEventListener('drop', function (e) {
    e.preventDefault();
    disc.classList.remove('dragover');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) load_file(f);
  });
}

// ============================ STREAMING MODE ============================

window.stream_tab = async function () {
  ensureAudio();
  if (audioContext.state === 'suspended') await audioContext.resume();

  var displayStream;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: true,
      },
    });
  } catch (e) {
    setStatus(e.name + ': ' + e.message, 'error');
    return;
  }

  var audioTracks = displayStream.getAudioTracks();
  if (!audioTracks.length) {
    displayStream.getTracks().forEach(function (t) { t.stop(); });
    setStatus("no audio track — choose a Chrome Tab and enable 'Share tab audio'.", 'error');
    return;
  }

  // commit: leave file mode, drop any previous capture, start the new one
  if (audioEl) audioEl.pause();
  if (mediaSource) mediaSource.disconnect();
  stopStreamFully();
  appMode = 'stream';
  setRateRange(1);
  startCapture(displayStream, audioTracks);
  updateModeUI();
};

function startCapture(displayStream, audioTracks) {
  // grab the tab's name before dropping the video track (audio labels are often blank)
  var videoTrack = displayStream.getVideoTracks()[0];
  var rawLabel = (videoTrack && videoTrack.label) || (audioTracks[0] && audioTracks[0].label) || '';
  tabName = (rawLabel && rawLabel.indexOf('://') === -1) ? rawLabel : 'live tab audio';

  var audioOnlyStream = new MediaStream(audioTracks);
  displayStream.getVideoTracks().forEach(function (t) { t.stop(); });
  currentAudioTrack = audioTracks[0];

  bufferLength = audioContext.sampleRate * 300;   // ~5 min headroom
  circularBuffer = new Float32Array(bufferLength);
  writePos = 0;
  readPos = 0;
  isStreaming = true;

  streamSource = audioContext.createMediaStreamSource(audioOnlyStream);
  scriptNode = audioContext.createScriptProcessor(2048, 1, 1);
  scriptNode.onaudioprocess = streamProcess;
  streamSource.connect(scriptNode);
  scriptNode.connect(bassFilter);
  if (outputBus) outputBus.gain.value = 1;
  if (eightDEnabled) start8D();

  setSpin(true);
  setStatus('streaming — drag the slider to slow it down.', 'streaming');
  updateMediaSessionMetadata();
  updateMediaSessionState();

  currentAudioTrack.addEventListener('ended', function () {
    stopStreamFully();
    updateModeUI();
    setStatus('tab share ended — press "stream (tab)" to pick again.', '');
  });

  startViz();
}

function streamProcess(e) {
  var input = e.inputBuffer.getChannelData(0);
  var output = e.outputBuffer.getChannelData(0);
  var n = output.length;

  if (!isStreaming) {
    for (var k = 0; k < n; k++) output[k] = 0;
    return;
  }

  for (var i = 0; i < input.length; i++) {
    circularBuffer[writePos % bufferLength] = input[i];
    writePos++;
  }
  if (writePos - readPos > bufferLength - 1) {
    readPos = writePos - bufferLength + 1;
  }

  var rate = currentRate();
  for (var j = 0; j < n; j++) {
    if (readPos >= writePos - 1) { output[j] = 0; continue; }
    var idx = Math.floor(readPos);
    var frac = readPos - idx;
    var s0 = circularBuffer[idx % bufferLength];
    var s1 = circularBuffer[(idx + 1) % bufferLength];
    output[j] = s0 * (1 - frac) + s1 * frac;
    readPos += rate;
  }
}

// pause = mute (and stop buffering)
function pauseStream() {
  isStreaming = false;
  if (outputBus) outputBus.gain.value = 0;
  stop8D();
  setSpin(false);
  updatePlayIcon();
  updateMediaSessionState();
  setStatus('muted — press play to unmute and catch up to live.', '');
}

// play = unmute + clear the buffer (jump to live)
function resumeStream() {
  if (audioContext.state === 'suspended') audioContext.resume();
  if (circularBuffer) { readPos = writePos; circularBuffer.fill(0); }
  if (outputBus) outputBus.gain.value = 1;
  isStreaming = true;
  if (eightDEnabled) start8D();
  setSpin(true);
  updatePlayIcon();
  updateMediaSessionState();
  startViz();
  setStatus('streaming — drag the slider to slow it down.', 'streaming');
}

// fully release the capture (tab ended, or a new capture/file replaces it)
function stopStreamFully() {
  isStreaming = false;
  stop8D();
  if (scriptNode) { scriptNode.disconnect(); scriptNode.onaudioprocess = null; scriptNode = null; }
  if (streamSource) { streamSource.disconnect(); streamSource = null; }
  if (currentAudioTrack) { try { currentAudioTrack.stop(); } catch (e) {} currentAudioTrack = null; }
  if (outputBus) outputBus.gain.value = 1;
  tabName = '';
  setSpin(false);
  updateMediaSessionState();
}

// ============================ MODE UI ============================

function updateModeUI() {
  showTrackName();
  showPlayButton();
  updatePlayIcon();
  updateExportUI();
  updateLiveJumpUI();
}

// refresh = drop the buffered backlog and snap the read head to the live edge
function updateLiveJumpUI() {
  var hasLiveStream = appMode === 'stream' && !!currentAudioTrack;
  if (jumpLiveBtn) jumpLiveBtn.hidden = !hasLiveStream;
  if (!streamBtn) return;

  streamBtn.textContent = hasLiveStream ? 'jump to live' : 'stream (tab)';
  streamBtn.setAttribute('aria-label', hasLiveStream ? 'jump to live stream' : 'stream browser tab');
  if (hasLiveStream) {
    streamBtn.title = 'jump to live';
    streamBtn.onclick = function () { window.refresh_stream(); };
  } else {
    streamBtn.removeAttribute('title');
    streamBtn.onclick = function () { window.stream_tab(); };
  }
}

window.refresh_stream = function () {
  if (appMode !== 'stream' || !circularBuffer) return;
  readPos = writePos;
  circularBuffer.fill(0);
  setStatus('jumped to live.', 'streaming');
};

// ============================ MP3 EXPORT ============================
// Only offered for uploaded mp3 files. Re-renders the decoded buffer through
// the same effect chain offline, then encodes with lamejs.
// ponytail: renders + encodes on the main thread; move to a Worker if big files jank the UI.

function updateExportUI() {
  // export re-encodes the decoded buffer to mp3, so any loaded file qualifies
  // (incl. youtube downloads, which aren't always tagged as mp3)
  if (exportBtn) exportBtn.hidden = !(appMode === 'file' && sourceBuffer);
}

window.export_mp3 = async function () {
  if (appMode !== 'file' || !sourceBuffer) { setStatus('load an mp3 first.', 'error'); return; }
  if (!window.lamejs) { setStatus('mp3 encoder still loading — try again in a moment.', 'error'); return; }
  if (exportBtn) exportBtn.disabled = true;
  setStatus('rendering export…', '');
  try {
    var rendered = await renderProcessed();   // captures the current speed/effects snapshot
    var blob = await encodeMp3(rendered, function (pct) {
      setStatus('encoding export… ' + pct + '%', '');
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (fileName.replace(/\.[^.]+$/, '') || 'export') + ' (slowed).mp3';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    setStatus('exported ' + a.download, '');
  } catch (e) {
    setStatus('export failed: ' + (e && e.message || e), 'error');
  }
  if (exportBtn) exportBtn.disabled = false;
};

// mirror the live graph (rate → bass → dry/wet reverb → pan/8D) in an OfflineAudioContext
function renderProcessed() {
  var rate = currentRate();
  var sr = sourceBuffer.sampleRate;
  var off = new OfflineAudioContext(2, Math.max(1, Math.ceil(sourceBuffer.length / rate)), sr);

  var src = off.createBufferSource();
  src.buffer = sourceBuffer;
  src.playbackRate.value = rate;   // resample → pitch drops with speed, like the live player

  var bass = off.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 160;
  bass.gain.value = bassControl ? parseFloat(bassControl.value) : 0;

  var conv = off.createConvolver();
  conv.buffer = generateImpulseResponse(off, reverbDecayControl ? parseFloat(reverbDecayControl.value) : 3, 2.5);
  var dry = off.createGain(), wet = off.createGain(), bus = off.createGain();
  var mix = (reverbMixControl ? parseInt(reverbMixControl.value, 10) : 0) / 100;
  dry.gain.value = 1 - mix;
  wet.gain.value = mix;

  src.connect(bass);
  bass.connect(dry); dry.connect(bus);
  bass.connect(conv); conv.connect(wet); wet.connect(bus);

  var panPos = panControl ? parseInt(panControl.value, 10) : 0;
  if (eightDEnabled || panPos !== 0) {
    var pan = off.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = 1;
    pan.rolloffFactor = 0;
    bus.connect(pan);
    pan.connect(off.destination);
    if (eightDEnabled && pan.positionX) {
      var period = eightdPeriodControl ? parseFloat(eightdPeriodControl.value) : 8;
      var lfo = off.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 1 / period;
      var lg = off.createGain();
      pan.positionY.value = 0;
      pan.positionZ.value = -0.3;
      lfo.connect(lg);
      lg.connect(pan.positionX);
      lfo.start();
    } else {
      var az = (panPos / 100) * 80 * Math.PI / 180;
      if (pan.positionX) {
        pan.positionX.value = Math.sin(az);
        pan.positionY.value = 0;
        pan.positionZ.value = -Math.cos(az);
      } else if (pan.setPosition) {
        pan.setPosition(Math.sin(az), 0, -Math.cos(az));
      }
    }
  } else {
    bus.connect(off.destination);
  }

  src.start();
  return off.startRendering();
}

// chunked + awaited so the encode loop yields to the event loop, keeping the
// sliders/play responsive and letting us report progress.
async function encodeMp3(buf, onProgress) {
  var channels = Math.min(2, buf.numberOfChannels);
  var enc = new window.lamejs.Mp3Encoder(channels, buf.sampleRate, 192);
  var left = floatTo16(buf.getChannelData(0));
  var right = channels > 1 ? floatTo16(buf.getChannelData(1)) : left;
  var block = 1152, chunks = [], n = 0;
  for (var i = 0; i < left.length; i += block) {
    var l = left.subarray(i, i + block);
    var part = channels > 1 ? enc.encodeBuffer(l, right.subarray(i, i + block)) : enc.encodeBuffer(l);
    if (part.length) chunks.push(part);
    if (++n % 100 === 0) {                       // ~2.6s of audio per yield
      if (onProgress) onProgress(Math.round((i / left.length) * 100));
      await new Promise(function (r) { setTimeout(r); });
    }
  }
  var tail = enc.flush();
  if (tail.length) chunks.push(tail);
  if (onProgress) onProgress(100);
  return new Blob(chunks, { type: 'audio/mpeg' });
}

function floatTo16(f32) {
  var out = new Int16Array(f32.length);
  for (var i = 0; i < f32.length; i++) {
    var s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// ---- visualization ----
function startViz() {
  if (vizRafId !== null) return;
  var loop = function () {
    vizRafId = requestAnimationFrame(loop);
    if (appMode === 'stream') drawBuffer(); else drawFileWave();
  };
  loop();
}

function prepCanvas() {
  if (!bufferCtx) return null;
  var dpr = window.devicePixelRatio || 1;
  var cssW = bufferCanvas.clientWidth || 480;
  var cssH = bufferCanvas.clientHeight || 90;
  var w = Math.round(cssW * dpr);
  var h = Math.round(cssH * dpr);
  if (bufferCanvas.width !== w || bufferCanvas.height !== h) {
    bufferCanvas.width = w;
    bufferCanvas.height = h;
  }
  bufferCtx.clearRect(0, 0, w, h);
  return { w: w, h: h, dpr: dpr };
}

// a stable decorative waveform for the idle/empty state
function getPlaceholder() {
  if (placeholderPeaks) return placeholderPeaks;
  var p = new Float32Array(600);
  for (var i = 0; i < p.length; i++) {
    p[i] = (0.45 + 0.55 * Math.abs(Math.sin(i * 0.13))) *
           (0.35 + 0.65 * Math.abs(Math.sin(i * 0.031 + 1)));
  }
  placeholderPeaks = p;
  return p;
}

// file mode: full-track waveform with a seekable playhead.
// shows a sample waveform when empty, and fills live when decode failed.
function drawFileWave() {
  if (filePeaks && peaksLive && analyser && audioEl && !audioEl.paused && audioEl.duration) {
    analyser.getFloatTimeDomainData(analyserBuf);
    var pk = 0;
    for (var a = 0; a < analyserBuf.length; a++) { var v = Math.abs(analyserBuf[a]); if (v > pk) pk = v; }
    var b = Math.floor((audioEl.currentTime / audioEl.duration) * filePeaks.length);
    b = Math.max(0, Math.min(filePeaks.length - 1, b));
    if (pk > filePeaks[b]) filePeaks[b] = pk;
    if (pk > peaksMax) peaksMax = pk;
  }

  var c = prepCanvas();
  if (!c) return;
  var ctx = bufferCtx, w = c.w, h = c.h, dpr = c.dpr, mid = h / 2;

  var hasData = filePeaks && peaksMax > 0.005;
  var peaks = hasData ? filePeaks : getPlaceholder();
  var scale = hasData ? 1 / peaksMax : 1;
  var N = peaks.length, cols = Math.min(w, 600), bw = Math.max(1, w / cols);

  var dur = fileModeDuration();
  var cur = fileModeCurrentTime();
  var playFrac = (hasData && dur) ? Math.max(0, Math.min(1, cur / dur)) : 0;

  if (hasData) {
    ctx.fillStyle = 'rgba(226, 183, 20, 0.10)';
    ctx.fillRect(0, 0, playFrac * w, h);
  }

  for (var x = 0; x < cols; x++) {
    var frac = x / cols;
    var peak = Math.min(1, (peaks[Math.floor(frac * N)] || 0) * scale);
    var bh = Math.max(1, peak * h * 0.88);
    if (!hasData) ctx.fillStyle = 'rgba(100, 102, 105, 0.5)';
    else ctx.fillStyle = frac <= playFrac ? COLOR_MAIN : COLOR_SUB;
    ctx.fillRect(frac * w, mid - bh / 2, bw, bh);
  }

  if (hasData) {
    ctx.fillStyle = COLOR_MAIN;
    ctx.fillRect(Math.min(w - 2 * dpr, playFrac * w), 0, 2 * dpr, h);
  }
}

// stream mode: rolling circular-buffer view, read head vs live edge
function drawBuffer() {
  var c = prepCanvas();
  if (!c || !circularBuffer || !audioContext) return;
  var ctx = bufferCtx, w = c.w, h = c.h, dpr = c.dpr;
  var mid = h / 2;

  var sr = audioContext.sampleRate;
  var windowSamples = Math.min(VIZ_SECONDS * sr, writePos);
  if (windowSamples < 1) return;
  var startSample = writePos - windowSamples;
  var cols = Math.min(w, 600);

  var readX = ((readPos - startSample) / windowSamples) * w;
  readX = Math.max(0, Math.min(w, readX));
  ctx.fillStyle = 'rgba(226, 183, 20, 0.12)';
  ctx.fillRect(readX, 0, w - readX, h);

  ctx.fillStyle = COLOR_SUB;
  for (var x = 0; x < cols; x++) {
    var a = startSample + Math.floor((windowSamples * x) / cols);
    var b = startSample + Math.floor((windowSamples * (x + 1)) / cols);
    if (b <= a) b = a + 1;
    var step = Math.max(1, Math.floor((b - a) / 8));
    var mn = 1, mx = -1, got = false;
    for (var s = a; s < b; s += step) {
      var v = circularBuffer[((s % bufferLength) + bufferLength) % bufferLength];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      got = true;
    }
    if (!got) continue;
    var px = (x / cols) * w;
    var pw = Math.max(1, w / cols);
    var yTop = mid - mx * mid * 0.9;
    var yBot = mid - mn * mid * 0.9;
    ctx.fillRect(px, yTop, pw, Math.max(1, yBot - yTop));
  }

  ctx.fillStyle = COLOR_ERROR;
  ctx.fillRect(w - 2 * dpr, 0, 2 * dpr, h);
  ctx.fillStyle = COLOR_MAIN;
  ctx.fillRect(Math.min(readX, w - 2 * dpr), 0, 2 * dpr, h);
}

// click the waveform to seek (file mode only)
if (bufferCanvas) {
  bufferCanvas.addEventListener('click', function (e) {
    if (appMode !== 'file' || !fileModeDuration()) return;
    var rect = bufferCanvas.getBoundingClientRect();
    var frac = (e.clientX - rect.left) / rect.width;
    seekFileMode(Math.max(0, Math.min(1, frac)) * fileModeDuration());
    drawFileWave();
  });
}

// ---- slider wiring ----
if (playbackControl) {
  playbackControl.addEventListener('input', function () {
    var v = currentRate();
    if (playbackValue) playbackValue.textContent = v.toFixed(2);
    if (useMobileBufferPlayback()) restartMobileBufferAtCurrentRate();
    else if (audioEl) audioEl.playbackRate = v;
    updateSpinDuration();
    updateMediaSessionState();
  });
}

if (volumeControl) {
  applyVolume(currentVolume());
  volumeControl.addEventListener('input', function () {
    applyVolume(currentVolume());
  });
}

if (reverbMixControl) {
  reverbMixControl.addEventListener('input', function () {
    var val = parseInt(reverbMixControl.value, 10);
    if (reverbMixValue) reverbMixValue.textContent = val;
    applyReverbMix(val / 100);
  });
}

if (reverbDecayControl) {
  reverbDecayControl.addEventListener('input', function () {
    if (reverbDecayValue) reverbDecayValue.textContent = parseFloat(reverbDecayControl.value).toFixed(1);
    scheduleImpulse();
  });
}

if (bassControl) {
  bassControl.addEventListener('input', function () {
    var db = parseFloat(bassControl.value);
    if (bassValue) bassValue.textContent = db.toFixed(1);
    applyBass(db);
  });
}

if (panControl) {
  panControl.addEventListener('input', function () {
    var p = parseInt(panControl.value, 10);
    if (panValue) panValue.textContent = formatPan(p);
    applyPan(p / 100);
    routeOutput();
  });
}

if (eightdPeriodControl) {
  eightdPeriodControl.addEventListener('input', function () {
    var period = parseFloat(eightdPeriodControl.value);
    if (eightdPeriodValue) eightdPeriodValue.textContent = period.toFixed(1);
    if (lfoOsc) lfoOsc.frequency.value = 1 / period;
  });
}

// ---- init ----
setupMediaSession();
document.addEventListener('keydown', handleMediaKeydown);
startYoutubePlaceholderTyping();
focusYoutubeInputOnDesktop();
updatePlayIcon();
updateLiveJumpUI();
updateSpinDuration();
setMobileMoreOptionsOpen(readMobileMoreOptionsOpen());
// Create the AudioContext at page load on mobile. iOS mutes a context first born
// inside an async callback (e.g. mid-download), so a fresh first download wouldn't
// play until a reload — building it here mirrors the working post-refresh path.
if (isMobileViewport()) {
  setYoutubePromptStatus();
  ensureAudio();
}
restoreSavedYoutubeTrack();
renderSavedSongs();
startViz();   // perpetual: draws the sample waveform while idle, real data once loaded

// friendly control name from the id: btn-play -> "play", playback-rate-control -> "playback-rate"
function controlName(el) {
  return (el.id || '').replace(/^btn-/, '').replace(/-control$/, '') || null;
}

function currentSongName() {
  var name = (appMode === 'stream') ? tabName : fileName;
  return name ? name.trim().slice(0, 120) : null;
}

// one clean posthog event per button press, identity from id/label — covers buttons added later too
document.addEventListener('click', function (e) {
  var btn = e.target.closest('button');
  if (!btn || typeof posthog === 'undefined') return;
  posthog.capture('button_press', {
    control: controlName(btn),   // e.g. "play", "youtube-download", "8d"
    id: btn.id || null,
    label: (btn.textContent || '').trim().slice(0, 60) || btn.getAttribute('aria-label') || null,
    current_song: currentSongName(),
  });
});

// sliders aren't buttons — debounce per control so arrow-key spamming / rapid drags
// collapse into one event carrying the final value
var sliderTimers = {};
document.addEventListener('change', function (e) {
  var el = e.target;
  if (!el || el.type !== 'range' || typeof posthog === 'undefined') return;
  var name = controlName(el) || el.id || 'slider';
  clearTimeout(sliderTimers[name]);
  sliderTimers[name] = setTimeout(function () {
    posthog.capture('slider_change', {
      control: controlName(el),   // e.g. "playback-rate", "reverb-mix", "bass-boost"
      id: el.id || null,
      value: Number(el.value),
      current_song: currentSongName(),
    });
  }, 400);
});
