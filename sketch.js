let cameraInput;
let extractedTextElement;
let harmfulIngredientsData = {};
let currentUserPlan = 'free';
let scanCount = 0;
let analysisCount = 0;

// Load ingredients JSON
fetch('ingredients.json')
  .then(r => r.json())
  .then(data => harmfulIngredientsData = data.harmfulIngredients || {})
  .catch(err => console.error('ingredients.json load err', err));

function setup() {
  noCanvas();
  extractedTextElement = document.getElementById('extracted-text');

  // Track user plan and usage
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      const doc = await db.collection('users').doc(user.uid).get();
      if (doc.exists) {
        const data = doc.data();
        currentUserPlan = data.plan || 'free';
        scanCount = data.scansToday || 0;
        analysisCount = data.analysisToday || 0;
      } else {
        currentUserPlan = 'free';
      }
    } else currentUserPlan = 'free';
    updateUsageUI();
  });
}

// 🎥 Start Camera
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
      video.style.height = 'calc(100vh - 180px)';
      video.style.objectFit = 'contain';
      video.style.borderRadius = '12px';

      const container = document.getElementById('video-container');
      container.innerHTML = '';
      container.appendChild(video);
      cameraInput = video;

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

// 📊 Update Progress Bars + Premium Card
function updateUsageUI() {
  const scanProgress = document.getElementById('scan-progress');
  const aiProgress = document.getElementById('ai-progress');
  const scanText = document.getElementById('scan-text');
  const aiText = document.getElementById('ai-text');
  const premiumSection = document.querySelector('.premium-section');

  const maxScans = 5;
  const maxAI = 5;

  if (scanProgress) {
    scanProgress.value = scanCount;
    scanProgress.max = maxScans;
  }
  if (aiProgress) {
    aiProgress.value = analysisCount;
    aiProgress.max = maxAI;
  }
  if (scanText) scanText.textContent = `${scanCount}/${maxScans} Scans Today`;
  if (aiText) aiText.textContent = `${analysisCount}/${maxAI} AI Analyses Today`;

  if (premiumSection) {
    premiumSection.style.display = currentUserPlan === 'premium' ? 'none' : 'block';
  }

  const usageText = document.getElementById('usage-text');
  const progressBar = document.getElementById('usage-progress');
  if (usageText && progressBar) {
    const totalUsed = scanCount + analysisCount;
    const totalLimit = currentUserPlan === 'premium' ? 1 : (maxScans + maxAI);
    const percent = currentUserPlan === 'premium' ? 100 : Math.min((totalUsed / totalLimit) * 100, 100);
    progressBar.style.width = percent + '%';
    progressBar.style.background = percent >= 100 ? '#ff4d4d' : '#00c6ff';
    usageText.textContent =
      currentUserPlan === 'premium'
        ? 'Unlimited access for Premium users 🏆'
        : `Used ${totalUsed}/${totalLimit} actions today`;
  }
}

// 🧠 Limit Check
async function checkScanLimit(type = 'scan') {
  const user = auth.currentUser;
  if (!user) {
    Swal.fire('Please log in to use scanning.');
    return false;
  }

  const docRef = db.collection('users').doc(user.uid);
  const docSnap = await docRef.get();
  const today = new Date().toISOString().split('T')[0];
  let data = docSnap.exists ? docSnap.data() : null;

  if (!data) {
    await docRef.set({
      plan: 'free',
      scansToday: 0,
      analysisToday: 0,
      lastScanDate: today
    });
    data = { plan: 'free', scansToday: 0, analysisToday: 0, lastScanDate: today };
  }

  if (data.lastScanDate !== today) {
    await docRef.update({ scansToday: 0, analysisToday: 0, lastScanDate: today });
    data.scansToday = 0;
    data.analysisToday = 0;
  }

  const maxScans = 8, maxAI = 5;
  if (data.plan === 'free') {
    if (type === 'scan' && data.scansToday >= maxScans) {
      Swal.fire({
        icon: 'info',
        title: 'Daily Scan Limit Reached',
        text: 'Upgrade to Premium for unlimited scans 🚀'
      });
      document.querySelector('.premium-section')?.scrollIntoView({ behavior: 'smooth' });
      return false;
    }
    if (type === 'ai' && data.analysisToday >= maxAI) {
      Swal.fire({
        icon: 'info',
        title: 'Daily AI Analysis Limit Reached',
        text: 'Upgrade to Premium for unlimited analyses 🚀'
      });
      document.querySelector('.premium-section')?.scrollIntoView({ behavior: 'smooth' });
      return false;
    }
  }

  await docRef.update({
    [`${type === 'scan' ? 'scansToday' : 'analysisToday'}`]:
      (type === 'scan' ? data.scansToday : data.analysisToday) + 1,
    lastScanDate: today
  });

  if (type === 'scan') scanCount++;
  else analysisCount++;
  updateUsageUI();
  return true;
}

// 📸 Capture from Camera
async function captureImage() {
  const allowed = await checkScanLimit('scan');
  if (!allowed) return;

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

// 🖼️ From Gallery
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

// 🔍 OCR Text Extraction
async function extractTextFromImage(canvasEl) {
  extractedTextElement.value = 'Recognizing...';
  const allowed = await checkScanLimit('ai');
  if (!allowed) return;

  Tesseract.recognize(canvasEl, 'eng', { logger: m => console.log(m) })
    .then(({ data }) => {
      const text = data.text || '';
      extractedTextElement.value = text;
      checkAllergiesThenHarmful(text);

      // Show AI button
      const aiBtn = document.getElementById('ai-button');
      if (aiBtn) aiBtn.style.display = 'inline-block';
    })
    .catch(err => {
      console.error('ocr err', err);
      extractedTextElement.value = '';
      Swal.fire('OCR failed', 'Try again', 'error');
    });
}

// 🧾 Allergy & Harmful Ingredient Checks
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
      if (res.isConfirmed)
        Swal.fire({ icon: 'warning', title: 'Potential risks', text: foundArr.join('\n') });
      await saveScanResult(extractedText, allergyAlerts, foundArr);
      if (window.appLoadHistory) window.appLoadHistory();
    });
  } else {
    Swal.fire({ icon: 'success', title: 'No harmful ingredients detected.' });
    saveScanResult(extractedText, allergyAlerts, foundArr);
    if (window.appLoadHistory) window.appLoadHistory();
  }
}

// 💾 Save Result
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

// ✏️ Edit Text
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

// 🧠 AI Analysis Integration (Gemini)
// const GEMINI_API_KEY = "AIzaSyAC6RyMxHDQYqntTJcraeuXAsGY6MJYbjs"; // Replace with your key
// const MODEL = "gemini-2.5-flash-latest";

async function runAIAnalysis() {
  const allowed = await checkScanLimit('ai');
  if (!allowed) return;

  const text = extractedTextElement.value.trim();
  if (!text) {
    Swal.fire('No ingredients found!', 'Please scan first.', 'info');
    return;
  }

  const aiBtn = document.getElementById('ai-button');
  aiBtn.textContent = "Analyzing...";
  aiBtn.disabled = true;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: `Given these ingredients:\n${text}\nSuggest safer or healthier alternatives for each ingredient and briefly explain why they're better.`
          }]
        }]
      })
    });

    const data = await res.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No AI analysis result.";
    Swal.fire({
      icon: 'info',
      title: 'AI Ingredient Analysis 🧠',
      html: `<div style="text-align:left;white-space:pre-wrap">${aiText}</div>`
    });
  } catch (err) {
    console.error('AI Error', err);
    Swal.fire('AI analysis failed', 'Try again later', 'error');
  } finally {
    aiBtn.textContent = "AI Analysis";
    aiBtn.disabled = false;
  }
}

// 🧠 Auto Camera Init + Premium Upgrade Button
document.addEventListener('DOMContentLoaded', () => {
  const navScanner = document.getElementById('nav-scanner');
  const goScanner = document.getElementById('go-scanner');
  const upgradeBtn = document.getElementById('upgrade-btn');
  const aiBtn = document.getElementById('ai-button');
  if (aiBtn) aiBtn.addEventListener('click', runAIAnalysis);

  function ensureStartCamera() {
    if (!cameraInput) startCamera();
  }
  navScanner && navScanner.addEventListener('click', ensureStartCamera);
  goScanner && goScanner.addEventListener('click', ensureStartCamera);
  const sc = document.getElementById('scanner-screen');
  if (sc && sc.style.display !== 'none') ensureStartCamera();

  updateUsageUI();
});

