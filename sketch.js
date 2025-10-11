let cameraInput;
let extractedTextElement;
let harmfulIngredientsData = {};

// Load ingredients JSON
fetch('ingredients.json')
  .then(r => r.json())
  .then(data => harmfulIngredientsData = data.harmfulIngredients || {})
  .catch(err => console.error('ingredients.json load err', err));

function setup() {
  noCanvas();
  extractedTextElement = document.getElementById('extracted-text');
}

function startCamera() {
  const constraints = { video: { facingMode: "environment" } };
  navigator.mediaDevices.getUserMedia(constraints)
    .then(stream => {
      const video = document.createElement('video');
      video.id = 'camera';
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.style.width = '100%';
      video.style.height = 'auto';
      video.style.objectFit = 'contain'; // full frame visible
      video.style.borderRadius = '12px';
      video.style.transform = 'none';
      
      const container = document.getElementById('video-container');
      container.innerHTML = '';
      container.appendChild(video);
      cameraInput = video;

      // Button logic
      const scanButton = document.getElementById('scan-button');
      const galleryButton = document.getElementById('gallery-button');
      const galleryInput = document.getElementById('gallery-input');
      const editButton = document.getElementById('edit-button');
      const saveButton = document.getElementById('save-button');

      if (scanButton) scanButton.onclick = captureImage;
      if (galleryButton) galleryButton.onclick = () => galleryInput.click();
      if (galleryInput) galleryInput.onchange = e => {
        const file = e.target.files[0];
        if (file) processGalleryImage(file);
      };
      if (editButton) editButton.onclick = enableEditing;
      if (saveButton) saveButton.onclick = saveChanges;
    })
    .catch(err => console.error('camera err', err));
}

function captureImage() {
  const canvas = document.createElement('canvas');
  canvas.width = cameraInput.videoWidth;
  canvas.height = cameraInput.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(cameraInput, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL();

  document.getElementById('captured-image').innerHTML = `
    <img src="${data}" alt="captured" style="width:100%;max-width:400px;border-radius:8px">
  `;
  extractTextFromImage(canvas);
}

function processGalleryImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const src = e.target.result;
    document.getElementById('captured-image').innerHTML = `
      <img src="${src}" alt="selected" style="width:100%;max-width:400px;border-radius:8px">
    `;
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      extractTextFromImage(canvas);
    };
  };
  reader.readAsDataURL(file);
}

function extractTextFromImage(canvasEl) {
  extractedTextElement.value = 'Recognizing...';
  Tesseract.recognize(canvasEl, 'eng', { logger: m => console.log(m) })
    .then(({ data }) => {
      const text = data.text || '';
      extractedTextElement.value = text;
      checkAllergiesThenHarmful(text);
    })
    .catch(err => {
      console.error('ocr err', err);
      extractedTextElement.value = '';
      Swal.fire('OCR failed', 'Try again', 'error');
    });
}

function checkAllergiesThenHarmful(extractedText) {
  const textLower = extractedText.toLowerCase();
  auth.onAuthStateChanged(async (user) => {
    let allergyAlerts = [];
    if (user) {
      const doc = await db.collection('users').doc(user.uid).get();
      if (doc.exists) {
        const allergies = doc.data().allergies || [];
        allergyAlerts = allergies.filter(a => a && textLower.includes(a.toLowerCase()));
      }
    }
    if (allergyAlerts.length > 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Allergy Alert!',
        text: `Contains: ${allergyAlerts.join(', ')}`
      }).then(() => detectHarmfulIngredients(extractedText, allergyAlerts));
    } else {
      detectHarmfulIngredients(extractedText, allergyAlerts);
    }
  });
}

function detectHarmfulIngredients(extractedText, allergyAlerts = []) {
  const cleaned = extractedText.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean);
  const ignore = new Set(['and', 'or', 'with', 'the', 'a', 'to', 'of']);
  const filtered = words.filter(w => !ignore.has(w));

  const synonyms = { 'e300': 'ascorbic acid', 'vitamin c': 'ascorbic acid', 'e330': 'citric acid' };
  const found = new Set();

  for (let i = 0; i < filtered.length; i++) {
    const w = filtered[i];
    const bigram = i < filtered.length - 1 ? (w + ' ' + filtered[i + 1]) : null;
    const wMapped = synonyms[w] || w;
    const bMapped = bigram ? (synonyms[bigram] || bigram) : null;

    if (harmfulIngredientsData[wMapped]) harmfulIngredientsData[wMapped].diseases.forEach(d => found.add(d));
    if (bMapped && harmfulIngredientsData[bMapped]) harmfulIngredientsData[bMapped].diseases.forEach(d => found.add(d));
  }

  const foundArr = Array.from(found);

  if (foundArr.length > 0) {
    Swal.fire({
      icon: 'error',
      title: 'Harmful ingredients detected!',
      text: 'Tap Show Risks for details.',
      showCancelButton: true,
      confirmButtonText: 'Show Risks'
    }).then(async res => {
      if (res.isConfirmed) {
        Swal.fire({ icon: 'warning', title: 'Potential risks', text: foundArr.join('\n') });
      }
      await saveScanResult(extractedText, allergyAlerts, foundArr);
      if (window.appLoadHistory) window.appLoadHistory();
    });
  } else {
    Swal.fire({ icon: 'success', title: 'No harmful ingredients detected.' });
    saveScanResult(extractedText, allergyAlerts, foundArr);
    if (window.appLoadHistory) window.appLoadHistory();
  }
}

async function saveScanResult(extractedText, allergyAlerts, foundArr) {
  const user = auth.currentUser;
  const doc = {
    timestamp: firebase.firestore.FieldValue.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : Date.now(),
    ingredients: extractedText.slice(0, 2000),
    allergiesFound: allergyAlerts,
    harmfulNotes: foundArr
  };
  try {
    if (user) {
      await db.collection('users').doc(user.uid).collection('history').add(doc);
    } else {
      const arr = JSON.parse(localStorage.getItem('localHistory') || '[]');
      arr.unshift(doc);
      localStorage.setItem('localHistory', JSON.stringify(arr.slice(0, 50)));
    }
  } catch (err) {
    console.error('saveScan err', err);
  }
}

function enableEditing() {
  const ta = document.getElementById('extracted-text');
  ta.readOnly = false;
  document.getElementById('edit-button').style.display = 'none';
  document.getElementById('save-button').style.display = 'inline';
}

function saveChanges() {
  const ta = document.getElementById('extracted-text');
  const edited = ta.value;
  ta.readOnly = true;
  document.getElementById('edit-button').style.display = 'inline';
  document.getElementById('save-button').style.display = 'none';
  checkAllergiesThenHarmful(edited);
}

document.addEventListener('DOMContentLoaded', () => {
  const navScanner = document.getElementById('nav-scanner');
  const goScanner = document.getElementById('go-scanner');
  function ensureStartCamera() {
    if (!cameraInput) startCamera();
  }
  navScanner && navScanner.addEventListener('click', ensureStartCamera);
  goScanner && goScanner.addEventListener('click', ensureStartCamera);
  const sc = document.getElementById('scanner-screen');
  if (sc && sc.style.display !== 'none') ensureStartCamera();
});
