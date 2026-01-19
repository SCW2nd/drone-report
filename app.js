// Minimal client logic: GPS, local save (localForage), jsPDF generation, POST to GAS
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyRQMcG210UZ8Si9HmKDqcwFBMtn5Fiy8iR6A_u-n4G-VFKLfoQ6BoJ6ptjlPxPA9VD7g/exec'; // ← ここにGASデプロイURLを入れてください
const form = document.getElementById('reportForm');
const statusEl = document.getElementById('status');

localforage.config({name:'DroneReport'});

// get GPS on load
function setStatus(s){ statusEl.textContent = s; }
function fetchGPS(){
  if(!navigator.geolocation){ setStatus('Geolocation not supported'); return; }
  setStatus('Obtaining GPS…');
  navigator.geolocation.getCurrentPosition(pos=>{
    document.getElementById('lat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('lng').value = pos.coords.longitude.toFixed(6);
    setStatus('GPS obtained');
  },err=>{
    setStatus('GPS error: '+err.message);
  },{enableHighAccuracy:true,timeout:10000});
}
fetchGPS();

// helper: generate PDF as blob
async function generatePDF(data){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(12);
  doc.text('Drone Flight Report', 14, 20);
  let y = 30;
  for(const [k,v] of Object.entries(data)){
    doc.text(`${k}: ${v}`, 14, y);
    y += 8;
    if(y > 280){ doc.addPage(); y = 20; }
  }
  const blob = doc.output('blob');
  return blob;
}

// send to GAS
async function sendToGAS(formData, pdfBlob){
  setStatus('Sending to Google Drive…');
  // build multipart/form-data
  const payload = new FormData();
  payload.append('json', JSON.stringify(formData));
  payload.append('file', pdfBlob, `${formData.reportId || 'report'}.pdf`);
  const res = await fetch(GAS_ENDPOINT, { method:'POST', body:payload });
  if(!res.ok) throw new Error('GAS upload failed: '+res.status);
  return res.json();
}

// offline queue handling
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
      const pdf = await generatePDF(item);
      await sendToGAS(item, pdf);
      // remove from queue
      const cur = (await localforage.getItem('queue')) || [];
      cur.shift();
      await localforage.setItem('queue', cur);
    }catch(e){
      console.error('Sync failed', e);
      setStatus('Sync error: '+e.message);
      return;
    }
  }
  setStatus('All local reports synced.');
}

window.addEventListener('online', syncQueue);

// form submit
form.addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = new FormData(form);
  const obj = {};
  fd.forEach((v,k)=> obj[k]=v);
  obj.timestamp = new Date().toISOString();
  setStatus('Generating PDF...');
  try{
    const pdf = await generatePDF(obj);
    if(navigator.onLine){
      await sendToGAS(obj, pdf);
      setStatus('Uploaded to Drive.');
    }else if(document.getElementById('saveLocal').checked){
      // store raw data for later sync
      await queueReport(obj);
    }else{
      setStatus('Offline and not saving locally. Enable "オフライン時は端末に保存" to keep data.');
    }
  }catch(err){
    console.error(err);
    setStatus('Error: '+err.message);
  }
});

