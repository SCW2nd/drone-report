// app.js - final version with correct response handling
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycby43wYy7177ajJpAwzF4ORF82_G-ik-UmqJ0aj2UQISaF5jRrr2EZBjFWRomA4UosYT2w/exec'; // ← あなたのGAS URLに置換
const form = document.getElementById('reportForm');
const statusEl = document.getElementById('status');

localforage.config({ name: 'DroneReport' });

function setStatus(s){ if(statusEl) statusEl.textContent = s; }

function fetchGPSOnce(timeout = 30000){
  return new Promise((resolve, reject) => {
    if(!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    let done = false;

    const onSuccess = pos => {
      if(done) return;
      done = true;
      clearTimeout(timer);
      resolve({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
    };
    const onError = err => {
      if(done) return;
      done = true;
      clearTimeout(timer);
      // provide detailed error message
      reject(new Error('Geolocation error: ' + (err && err.message ? err.message : JSON.stringify(err))));
    };

    const timer = setTimeout(() => {
      if(done) return;
      done = true;
      // try to stop any ongoing watch if set
      if(watchId !== null) navigator.geolocation.clearWatch(watchId);
      reject(new Error('Geolocation timeout'));
    }, timeout);

    // try getCurrentPosition first
    let watchId = null;
    navigator.geolocation.getCurrentPosition(onSuccess, err => {
      // if immediate getCurrentPosition fails, fallback to watchPosition
      console.warn('getCurrentPosition failed, trying watchPosition', err);
      try{
        watchId = navigator.geolocation.watchPosition(onSuccess, onError, { enableHighAccuracy: true, maximumAge: 0 });
      }catch(e){
        onError(e);
      }
    }, { enableHighAccuracy: true, timeout, maximumAge: 0 });
  });
}

async function queueReport(obj){
  const q = (await localforage.getItem('queue')) || [];
  q.push(obj);
  await localforage.setItem('queue', q);
  setStatus('Saved locally; will sync when online.');
}

async function syncQueue(){
  const q = (await localforage.getItem('queue')) || [];
  if(!q.length) return;
  setStatus('Syncing local reports...');
  for(const item of q.slice()){
    try{
      const res = await sendJsonToGAS(item);
      if(res && res.status === 'ok'){
        const cur = (await localforage.getItem('queue')) || [];
        cur.shift();
        await localforage.setItem('queue', cur);
      } else {
        setStatus('Sync error: ' + (res && res.message || 'unknown'));
        return;
      }
    }catch(e){
      console.error('Sync failed', e);
      setStatus('Sync error: ' + e.message);
      return;
    }
  }
  setStatus('All local reports synced.');
}

async function sendJsonToGAS(payload){
  setStatus('Sending to server...');
  try{
    const res = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      // Do NOT set Content-Type header to avoid CORS preflight in this setup.
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch(e){ json = {status:'error', message:'invalid json response', raw:text}; }
    return json;
  }catch(err){
    console.error('sendJsonToGAS error', err);
    return { status: 'error', message: err.message };
  }
}

(async function init(){
  try{
    setStatus('Obtaining GPS…');
    const pos = await fetchGPSOnce().catch(()=>null);
    if(pos){
      const latEl = document.getElementById('lat');
      const lngEl = document.getElementById('lng');
      if(latEl) latEl.value = pos.lat;
      if(lngEl) lngEl.value = pos.lng;
      setStatus('GPS obtained');
    } else {
      setStatus('GPS not available yet.');
    }
  }catch(err){
    setStatus('GPS error: ' + (err.message || err));
  }
  if(navigator.onLine) syncQueue();
})();

window.addEventListener('online', () => {
  setStatus('Back online — syncing...');
  syncQueue();
});

if(form){
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const obj = {};
    fd.forEach((v,k) => obj[k] = v);
    obj.timestamp = new Date().toISOString();

    try{
      const pos = await fetchGPSOnce().catch(()=>null);
      if(pos){
        obj.lat = pos.lat;
        obj.lng = pos.lng;
      }
    }catch(err){
      console.warn('GPS fetch failed on submit', err);
    }

    try{
      if(navigator.onLine){
        const res = await sendJsonToGAS(obj);
        if(res && res.status === 'ok'){
          // Prefer xlsxFileId, then sheetFileId, then fileId
          const id = res.xlsxFileId || res.sheetFileId || res.fileId || 'unknown';
          const url = res.xlsxUrl || res.fileUrl || null;
          setStatus('Uploaded. FileId: ' + id);
          if(url) {
            console.log('Saved file URL:', url);
          }
        } else {
          console.warn('Server error response', res);
          await queueReport(obj);
        }
      } else {
        if(document.getElementById('saveLocal') && document.getElementById('saveLocal').checked){
          await queueReport(obj);
        } else {
          setStatus('Offline and not saving locally. Enable local save to retain data.');
        }
      }
    }catch(err){
      console.error('Submit error', err);
      await queueReport(obj);
    }
  });
}
