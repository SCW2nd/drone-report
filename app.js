// app.js - updated: ensure lat/lng always included and debug logging
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycby43wYy7177ajJpAwzF4ORF82_G-ik-UmqJ0aj2UQISaF5jRrr2EZBjFWRomA4UosYT2w/exec';
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
      reject(new Error('Geolocation error: ' + (err && err.message ? err.message : JSON.stringify(err))));
    };

    const timer = setTimeout(() => {
      if(done) return;
      done = true;
      if(watchId !== null) navigator.geolocation.clearWatch(watchId);
      reject(new Error('Geolocation timeout'));
    }, timeout);

    let watchId = null;
    navigator.geolocation.getCurrentPosition(onSuccess, err => {
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
    // debug log
    try{ console.log('Sending payload', JSON.parse(JSON.stringify(payload))); }catch(e){}
    const res = await fetch(GAS_ENDPOINT, {
      method: 'POST',
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

function normalizeLatLng(obj){
  // prefer explicit lat/lng, fallback to latitude/longitude, else empty string
  obj.lat = obj.lat || obj.latitude || obj.Latitude || obj.LAT || '';
  obj.lng = obj.lng || obj.longitude || obj.Longitude || obj.LON || obj.LONG || '';
  return obj;
}

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
        // if form inputs empty, fill them
        if(!obj.lat) obj.lat = pos.lat;
        if(!obj.lng) obj.lng = pos.lng;
        // also reflect in form inputs if present
        const latEl = document.getElementById('lat');
        const lngEl = document.getElementById('lng');
        if(latEl && !latEl.value) latEl.value = pos.lat;
        if(lngEl && !lngEl.value) lngEl.value = pos.lng;
      }
    }catch(err){
      console.warn('GPS fetch failed on submit', err);
    }

    // ensure lat/lng fields exist with normalized keys
    normalizeLatLng(obj);

    try{
      if(navigator.onLine){
        const res = await sendJsonToGAS(obj);
        if(res && res.status === 'ok'){
          const id = res.xlsxFileId || res.sheetFileId || res.fileId || 'unknown';
          const url = res.xlsxUrl || res.fileUrl || null;
          setStatus('Uploaded. FileId: ' + id);
          if(url) console.log('Saved file URL:', url);
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
