// app.js
// Requires firebase.js loaded first (so auth & db are available)

document.addEventListener('DOMContentLoaded', () => {
  // DOM
  const screens = {
    home: document.getElementById('home-screen'),
    scanner: document.getElementById('scanner-screen'),
    allergies: document.getElementById('allergies-screen'),
    history: document.getElementById('history-screen'),
  };

  const navButtons = {
    home: document.getElementById('nav-home'),
    scanner: document.getElementById('nav-scanner'),
    allergies: document.getElementById('nav-allergies'),
    history: document.getElementById('nav-history'),
  };

  const openSettingsBtn = document.getElementById('open-settings');
  const logoutBtn = document.getElementById('logout');

  const goScanner = document.getElementById('go-scanner');
  const goAllergies = document.getElementById('go-allergies');

  const allergyInput = document.getElementById('allergy-input');
  const saveAllergiesBtn = document.getElementById('save-allergies');

  const historyList = document.getElementById('history-list');
  const clearHistoryBtn = document.getElementById('clear-history');

  // Helper: show screen
  function showScreen(name) {
    Object.keys(screens).forEach(k => screens[k].style.display = (k === name) ? 'block' : 'none');
    Object.keys(navButtons).forEach(k => navButtons[k].classList.toggle('active', k === name));
  }

  // Wire bottom nav
  navButtons.home.addEventListener('click', () => showScreen('home'));
  navButtons.scanner.addEventListener('click', () => showScreen('scanner'));
  navButtons.allergies.addEventListener('click', () => showScreen('allergies'));
  navButtons.history.addEventListener('click', () => showScreen('history'));

  goScanner.addEventListener('click', () => showScreen('scanner'));
  goAllergies.addEventListener('click', () => showScreen('allergies'));

  // Auth state
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      // Not logged in, redirect to login page
      window.location.href = 'login.html';
      return;
    }
    // Load user info and populate allergies input
    const doc = await db.collection('users').doc(user.uid).get();
    const data = doc.exists ? doc.data() : {};
    allergyInput.value = (data.allergies || []).join(', ');

    // Load history for user
    loadHistory();
  });

  // Logout
  logoutBtn.addEventListener('click', async () => {
    await auth.signOut();
    window.location.href = 'login.html';
  });

  // Account settings modal (Swal)
  openSettingsBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;
    const doc = await db.collection('users').doc(user.uid).get();
    const data = doc.exists ? doc.data() : {};

    Swal.fire({
      title: 'Edit Account',
      html:
        `<input id="sw-name" class="swal2-input" placeholder="Name" value="${data.name || ''}">` +
        `<input id="sw-age" type="number" class="swal2-input" placeholder="Age" value="${data.age || ''}">` +
        `<select id="sw-gender" class="swal2-input">
            <option value="">Select Gender</option>
            <option value="Male" ${data.gender==='Male' ? 'selected' : ''}>Male</option>
            <option value="Female" ${data.gender==='Female' ? 'selected' : ''}>Female</option>
            <option value="Other" ${data.gender==='Other' ? 'selected' : ''}>Other</option>
        </select>` +
        `<input id="sw-allergies" class="swal2-input" placeholder="Allergies (comma separated)" value="${(data.allergies||[]).join(', ')}">` +
        `<input id="sw-email" class="swal2-input" placeholder="Email" value="${data.email || user.email || ''}" readonly>`,
      showCancelButton: true,
      confirmButtonText: 'Save',
      preConfirm: () => {
        const name = document.getElementById('sw-name').value.trim();
        const age = parseInt(document.getElementById('sw-age').value);
        const gender = document.getElementById('sw-gender').value;
        const allergies = document.getElementById('sw-allergies').value.split(',').map(a => a.trim()).filter(a => a);
        if (!name || !age || !gender) {
          Swal.showValidationMessage('Please fill name, age and gender.');
          return false;
        }
        return { name, age, gender, allergies };
      }
    }).then(result => {
      if (result.isConfirmed && result.value) {
        const payload = {
          name: result.value.name,
          age: result.value.age,
          gender: result.value.gender,
          allergies: result.value.allergies
        };
        db.collection('users').doc(user.uid).set(payload, { merge: true })
          .then(() => Swal.fire('Saved', 'Account updated', 'success'))
          .catch(err => Swal.fire('Error', err.message, 'error'));
      }
    });
  });

  // Save allergies
  saveAllergiesBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;
    const arr = allergyInput.value.split(',').map(a => a.trim()).filter(a => a);
    await db.collection('users').doc(user.uid).set({ allergies: arr }, { merge: true });
    Swal.fire('Saved', 'Allergies updated', 'success');
  });

  // History: load from Firestore subcollection users/{uid}/history
  async function loadHistory() {
    const user = auth.currentUser;
    historyList.innerHTML = '<div style="color:#9aaed0">Loading...</div>';
    if (!user) return;
    const snap = await db.collection('users').doc(user.uid).collection('history').orderBy('timestamp','desc').limit(50).get();
    if (snap.empty) {
      historyList.innerHTML = '<div style="color:#9aaed0">No scans yet</div>';
      return;
    }
    historyList.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      const node = document.createElement('div');
      node.className = 'history-item';
      node.innerHTML = `<strong>${new Date(d.timestamp?.toMillis?.() || d.timestamp).toLocaleString()}</strong>
                        <div>${(d.ingredients||'').slice(0,250)}</div>
                        <div style="margin-top:6px;color:#a9cfe8">${(d.notes||'')}</div>`;
      historyList.appendChild(node);
    });
  }

  clearHistoryBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;
    const ok = await Swal.fire({
      title: 'Clear history?',
      text: 'This will remove all saved scans.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Clear'
    });
    if (!ok.isConfirmed) return;
    // delete docs in the subcollection (simple approach)
    const snap = await db.collection('users').doc(user.uid).collection('history').get();
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    loadHistory();
    Swal.fire('Cleared', 'History cleared', 'success');
  });

  // Expose loadHistory to global (scanner can call it after saving)
  window.appLoadHistory = loadHistory;

  // initial screen
  showScreen('home');
});
