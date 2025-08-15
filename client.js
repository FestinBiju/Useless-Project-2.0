document.addEventListener('DOMContentLoaded', () => {
  const socket = io(); // auto-use current origin
  const talkBtn = document.getElementById('talkBtn');
  const statusDiv = document.getElementById('status');
  const rxAudio = document.getElementById('rxAudio');

  let mediaRecorder;
  let stream;
  let isTalking = false;
  let audioContext;

  const mimeType = 'audio/webm;codecs=opus';
  const fallbackMimeType = 'audio/webm';
  
  // Initialize audio context for better audio handling
  function initAudioContext() {
    if (!audioContext) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('Audio context initialized');
      } catch (e) {
        console.error('Error initializing audio context:', e);
      }
    }
    
    // Resume audio context if suspended (required by some browsers)
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        console.log('Audio context resumed');
      });
    }
  }
  // let mediaSource, sourceBuffer, appendQueue = [];
  // let mseReady = false;

  // Setup MediaSource playback
  /* function setupMSE() {
    if (!('MediaSource' in window) || !MediaSource.isTypeSupported(mimeType)) {
      console.warn('MediaSource not supported, fallback mode');
      return;
    }
    mediaSource = new MediaSource();
    rxAudio.src = URL.createObjectURL(mediaSource);
    mediaSource.addEventListener('sourceopen', () => {
      sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      sourceBuffer.mode = 'sequence';
      sourceBuffer.addEventListener('updateend', flushQueue);
      mseReady = true;
      flushQueue();
    });
  }

  function flushQueue() {
    if (!sourceBuffer || sourceBuffer.updating) return;
    const chunk = appendQueue.shift();
    if (chunk) {
      try {
        sourceBuffer.appendBuffer(chunk);
      } catch (e) {
        console.error('appendBuffer failed', e);
      }
    }
  } */

  // setupMSE();

  // Socket events
  socket.on('connect', () => {
    statusDiv.textContent = 'Connected';
    initAudioContext(); // Initialize audio when connected
  });
  socket.on('disconnect', () => (statusDiv.textContent = 'Disconnected'));

  socket.on('channelStatus', ({ busy, speaker }) => {
    if (busy) {
      statusDiv.textContent = speaker === socket.id ? 'You are talking…' : 'Channel busy';
    } else {
      statusDiv.textContent = 'Connected';
    }
  });

  socket.on('audioChunk', (data) => {
    console.log('Received audio chunk, type:', typeof data, 'constructor:', data?.constructor?.name);
    
    // Ensure audio context is active
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }

    // Handle different data types
    let blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data && typeof data === 'object' && data.type === 'Buffer' && Array.isArray(data.data)) {
      // Socket.IO serialized Buffer - convert back to Blob
      const uint8Array = new Uint8Array(data.data);
      blob = new Blob([uint8Array], { type: 'audio/webm' });
    } else if (data instanceof ArrayBuffer) {
      blob = new Blob([data], { type: 'audio/webm' });
    } else {
      console.error('Received invalid audio data format:', typeof data);
      return;
    }

    // Create and play audio
    const url = URL.createObjectURL(blob);
    const tempAudio = new Audio(url);
    
    // Set audio properties for better playback
    tempAudio.volume = 1.0;
    tempAudio.preload = 'auto';
    
    // Play the audio chunk
    tempAudio.play().then(() => {
      console.log('Audio chunk played successfully');
      // Clean up the object URL after a delay to prevent memory leaks
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch((e) => { 
      console.error('Error playing audio chunk:', e);
      URL.revokeObjectURL(url);
    });
    
    // Clean up audio element after playback
    tempAudio.addEventListener('ended', () => {
      tempAudio.remove();
    });
  });

  // PTT events
  talkBtn.addEventListener('mousedown', startPTT);
  talkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startPTT(); });
  talkBtn.addEventListener('mouseup', stopPTT);
  talkBtn.addEventListener('mouseleave', stopPTT);
  talkBtn.addEventListener('touchend', stopPTT);
  talkBtn.addEventListener('touchcancel', stopPTT);

  async function startPTT() {
    if (isTalking) return;
    
    // Initialize audio context on user interaction (required by browsers)
    initAudioContext();
    
    socket.emit('startTalking', async (res) => {
      if (!res?.ok) {
        statusDiv.textContent = res?.reason || 'Channel busy';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000
          } 
        });
        const options = {};
        if (MediaRecorder.isTypeSupported(mimeType)) {
          options.mimeType = mimeType;
        } else if (MediaRecorder.isTypeSupported(fallbackMimeType)) {
          options.mimeType = fallbackMimeType;
          console.log('Using fallback audio format');
        } else {
          console.log('Using default audio format');
        }
        mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorder.ondataavailable = async (e) => {
          if (e.data && e.data.size > 0) {
            console.log(`Sending audio chunk: ${e.data.size} bytes`);
            // Send the blob directly instead of converting to ArrayBuffer
            socket.emit('audioChunk', e.data);
          }
        };
        mediaRecorder.start(100); // send every 100ms for better real-time performance
        isTalking = true;
        statusDiv.textContent = 'You are talking…';
      } catch (err) {
        console.error(err);
        statusDiv.textContent = 'Mic error or permission denied';
        socket.emit('stopTalking');
      }
    });
  }

  function stopPTT() {
    if (!isTalking) return;
    try {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    } catch {}
    isTalking = false;
    socket.emit('stopTalking');
  }
});
