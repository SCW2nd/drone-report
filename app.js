// Minimal client logic: GPS, local save (localForage), jsPDF generation, POST to GAS
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyRQMcG210UZ8Si9HmKDqcwFBMtn5Fiy8iR6A_u-n4G-VFKLfoQ6BoJ6ptjlPxPA9VD7g/exec'; // ← ここにGASデプロイURLを入れてください
const form = document.getElementById('reportForm');
const statusEl = document.getElementById('status');

localforage.config({ name: 'DroneReport' });

// 状態表示
function setStatus(s){ if(statusEl) statusEl.textContent = s; }

// GPS 取得（ロード時とフォーム送信時の再取得用）
async function fetchGPSOnce(timeout = 10000){
  return new Promise((resolve, reject) => {
    if(!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(pos => {
      resolve({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
    }, err => reject(err), { enableHighAccuracy: true, timeout });
  });
}

// ローカルキューに保存
async function queueReport(obj){
  const q = (await localforage.getItem('queue')) || [];
  q.push(obj);
  await localforage.setItem('queue', q);
  setStatus('Saved locally; will sync when online.');
}

// キュー同期
async function syncQueue(){
  const q = (await localforage.getItem('queue')) || [];
  if(!q.length) return;
  setStatus('Syncing local reports...');
  for(const item of q.slice()){ // iterate copy
    try{
      const res = await sendJsonToGAS(item);
      if(res && res.status === 'ok'){
        // pop first element (FIFO)
        const cur = (await localforage.getItem('queue')) || [];
        cur.shift();
        await localforage.setItem('queue', cur);
      } else {
        setStatus('Sync error: ' + (res && res.message || 'unknown'));
        return;
      }

