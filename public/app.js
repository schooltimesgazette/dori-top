(function () {
  'use strict';

  const TOKEN_KEY = 'dori_top_jwt_token';

  const state = {
    page: 'search',
    authTab: 'login',
    user: null,
    token: null,
    query: '',
    selectedMedId: null,
    city: 'all',
    userLocation: { lat: 40.7821, lng: 72.3442 },
    filters: { availableOnly: false, openNow: false, is247: false },
    sortBy: 'price',
    viewMode: 'list',
    myPharmacies: [],
    activePharmacyId: null,
    activeInventory: [],
    lastOffers: [],
    activeCallPhone: ''
  };

  let leafletMap = null;
  let mapMarkersLayer = null;
  let markerByPharmacyId = {};
  let applyPickerMap = null;
  let applyPickerMarker = null;

  function loadToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function saveToken(t) {
    state.token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token && !path.startsWith('/api/auth/')) {
      // Sessiya tugagan: mehmon rejimiga qaytamiz
      saveToken(null);
      state.user = null;
      enterApp();
      showToast('Sessiya tugadi. Qayta kiring.', 'info');
      throw new Error('Sessiya tugadi.');
    }
    if (!res.ok) {
      const err = new Error(data.error || 'Server xatoligi yuz berdi.');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatPrice(num) {
    if (num === null || num === undefined || Number.isNaN(Number(num))) return '—';
    return Math.round(Number(num)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so‘m';
  }

  function formatDistance(km) {
    if (km === null || km === undefined) return '';
    if (km < 1) return Math.max(50, Math.round(km * 1000 / 10) * 10) + ' m';
    return km < 50 ? km.toFixed(1) + ' km' : Math.round(km) + ' km';
  }

  function formatHours(p) {
    return p.is_247 ? '24/7' : `${p.open_time} – ${p.close_time}`;
  }

  function roleLabel(role) {
    if (role === 'admin') return 'Administrator';
    if (role === 'pharmacy_owner') return 'Dorixona egasi';
    return 'Foydalanuvchi';
  }

  function statusMeta(status) {
    if (status === 'available') return { label: 'Mavjud', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
    if (status === 'low') return { label: 'Kam qoldi', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
    return { label: 'Tugagan', cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' };
  }

  function showToast(msg, type = 'success', ms = 3200) {
    const c = document.getElementById('toastContainer');
    const el = document.createElement('div');
    const cls = type === 'error' ? 'bg-rose-600 text-white' : type === 'info' ? 'bg-brand-blue text-white' : 'bg-slate-900 text-white';
    el.className = `pointer-events-auto px-4 py-3 rounded-2xl shadow-lg text-sm font-medium animate-fade-up ${cls}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // =========================================================================
  // AUTH BOOTSTRAP & SESSION
  // =========================================================================
  async function initSession() {
    state.token = loadToken();
    state.user = null;
    if (state.token) {
      try {
        const me = await api('/api/auth/me');
        state.user = me.user;
      } catch (e) {
        saveToken(null);
      }
    }
    // Qidiruv hamma uchun ochiq: login qilmagan foydalanuvchi ham sayt bilan ishlay oladi
    enterApp();
  }

  async function showAuthGate() {
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('authGate').classList.remove('hidden');
    try {
      const res = await fetch('/api/auth/bootstrap-status').then(r => r.json());
      const banner = document.getElementById('bootstrapBanner');
      if (!res.hasAdmin && res.bootstrapOpen) {
        banner.classList.remove('hidden');
        setAuthTab('register');
      } else {
        banner.classList.add('hidden');
      }
    } catch (e) {}
    lucide.createIcons();
  }

  function setAuthTab(tab) {
    state.authTab = tab;
    const isReg = tab === 'register';
    document.getElementById('registerNameWrap').classList.toggle('hidden', !isReg);
    document.getElementById('authSubmitBtn').textContent = isReg ? 'Ro‘yxatdan o‘tish' : 'Tizimga kirish';
    document.getElementById('authLoginTab').className = !isReg
      ? 'py-2.5 rounded-xl text-sm font-bold transition bg-white text-slate-900 shadow-sm'
      : 'py-2.5 rounded-xl text-sm font-bold transition text-slate-600 hover:text-slate-900';
    document.getElementById('authRegisterTab').className = isReg
      ? 'py-2.5 rounded-xl text-sm font-bold transition bg-white text-slate-900 shadow-sm'
      : 'py-2.5 rounded-xl text-sm font-bold transition text-slate-600 hover:text-slate-900';
  }

  function enterApp() {
    document.getElementById('authGate').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');

    const user = state.user;
    const role = user ? user.role : 'guest';
    document.getElementById('userRoleLabel').textContent = user ? `${user.full_name} • ${roleLabel(role)}` : 'Mehmon';

    document.getElementById('navApplyBtn').classList.toggle('hidden', !(role === 'user' || role === 'pharmacy_owner'));
    document.getElementById('navPharmacyBtn').classList.toggle('hidden', !(role === 'pharmacy_owner' || role === 'admin'));
    document.getElementById('navAdminBtn').classList.toggle('hidden', role !== 'admin');
    document.getElementById('navLoginBtn').classList.toggle('hidden', Boolean(user));
    document.getElementById('navLogoutBtn').classList.toggle('hidden', !user);

    switchPage(role === 'admin' ? 'admin' : 'search');
  }

  function switchPage(page) {
    state.page = page;
    ['search', 'apply', 'pharmacy', 'admin'].forEach(p => {
      document.getElementById(p + 'Page').classList.toggle('hidden', p !== page);
    });

    const navMap = [
      ['navSearchBtn', 'search'],
      ['navApplyBtn', 'apply'],
      ['navPharmacyBtn', 'pharmacy'],
      ['navAdminBtn', 'admin']
    ];
    navMap.forEach(([id, p]) => {
      const btn = document.getElementById(id);
      if (btn.classList.contains('hidden')) return;
      btn.className = p === page
        ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition whitespace-nowrap bg-white text-brand-blue shadow-sm'
        : 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition whitespace-nowrap text-slate-600 hover:bg-white/70';
    });

    if (page === 'search') loadSearchOverview();
    else if (page === 'apply') loadMyRequests();
    else if (page === 'pharmacy') loadPharmacyCabinet();
    else if (page === 'admin') loadAdminPanel();
    lucide.createIcons();
  }

  // =========================================================================
  // SEARCH PAGE
  // =========================================================================
  async function loadSearchOverview() {
    try {
      const [health, citiesRes, popRes] = await Promise.all([
        api('/api/health'),
        api('/api/cities'),
        api('/api/medicines/popular')
      ]);
      const { pharmacies, medicines, inventory } = health.counts;
      document.getElementById('liveStatsBadge').innerHTML =
        `<i data-lucide="database" class="w-3.5 h-3.5"></i><span>${pharmacies} tasdiqlangan dorixona • ${medicines} dori • ${inventory} narx</span>`;

      const citySelect = document.getElementById('citySelect');
      const prev = state.city;
      citySelect.innerHTML = '<option value="all">Barcha shaharlar</option>' +
        citiesRes.cities.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      if (citiesRes.cities.includes(prev)) citySelect.value = prev;

      const wrap = document.getElementById('popularChipsWrap');
      const chips = document.getElementById('popularChips');
      if (popRes.medicines.length) {
        wrap.classList.remove('hidden');
        chips.innerHTML = popRes.medicines.map(m => `
          <button type="button" data-action="select-med" data-med-id="${m.id}"
            class="px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              state.selectedMedId === m.id
                ? 'bg-brand-green text-white border-brand-green'
                : 'bg-white/80 text-slate-700 border-slate-200 hover:border-brand-blue'
            }">${escapeHtml(m.name)}</button>
        `).join('');
        if (!state.selectedMedId) {
          state.selectedMedId = popRes.medicines[0].id;
          document.getElementById('searchInput').value = popRes.medicines[0].name;
          await loadSelectedMedicineOffers();
        }
      } else {
        wrap.classList.add('hidden');
        renderEmptySearch();
      }
      lucide.createIcons();
    } catch (err) { showToast(err.message, 'error'); }
  }

  function renderEmptySearch() {
    document.getElementById('medicinePassport').innerHTML = '';
    document.getElementById('controlsBar').classList.add('hidden');
    document.getElementById('resultSummaryBar').innerHTML = '';
    document.getElementById('mapViewContainer').classList.add('hidden');
    document.getElementById('analogsSection').innerHTML = '';
    const listEl = document.getElementById('listViewContainer');
    listEl.classList.remove('hidden');
    const cta = state.user.role === 'admin'
      ? `<button type="button" data-action="switch-page" data-page="admin" class="px-5 py-3 rounded-xl bg-brand-blue text-white text-sm font-bold">Admin panelga o‘tish</button>`
      : state.user.role === 'pharmacy_owner'
        ? `<button type="button" data-action="switch-page" data-page="pharmacy" class="px-5 py-3 rounded-xl bg-brand-green text-white text-sm font-bold">Dorixonamga dori qo‘shish</button>`
        : `<button type="button" data-action="switch-page" data-page="apply" class="px-5 py-3 rounded-xl bg-brand-blue text-white text-sm font-bold">Dorixona ochishga ariza berish</button>`;

    listEl.innerHTML = `
      <div class="glass-strong rounded-3xl p-10 text-center">
        <div class="w-14 h-14 rounded-2xl bg-sky-50 text-brand-blue flex items-center justify-center mx-auto mb-3">
          <i data-lucide="database" class="w-7 h-7"></i>
        </div>
        <h3 class="text-xl font-extrabold text-slate-900 mb-2">Hozircha dorilar bazasi bo‘sh</h3>
        <p class="text-sm text-slate-600 max-w-md mx-auto mb-5">Tasdiqlangan dorixonalar tomonidan dori va narxlar kiritilgach, bu yerda qidiruv natijalari ko‘rinadi.</p>
        ${cta}
      </div>
    `;
    lucide.createIcons();
  }

  async function loadAutocomplete(q) {
    const list = document.getElementById('autocompleteList');
    try {
      const data = await api(`/api/medicines/autocomplete?q=${encodeURIComponent(q)}&city=${encodeURIComponent(state.city)}`);
      if (!data.medicines.length) {
        list.innerHTML = '<div class="p-4 text-center text-sm text-slate-500">Mos dori topilmadi</div>';
        list.classList.remove('hidden');
        return;
      }
      list.innerHTML = data.medicines.map(m => `
        <button type="button" data-action="select-med" data-med-id="${m.id}"
          class="w-full px-4 py-3 text-left hover:bg-white/90 flex items-center justify-between gap-3 border-b border-slate-200/60 last:border-0">
          <div class="min-w-0">
            <div class="font-bold text-slate-900 text-sm truncate">${escapeHtml(m.name)}</div>
            <div class="text-xs text-slate-500 truncate">${escapeHtml(m.active_ingredient)} ${m.dosage ? '• ' + escapeHtml(m.dosage) : ''}</div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-sm font-bold text-brand-green">${m.min_price ? formatPrice(m.min_price) + ' dan' : 'Mavjud emas'}</div>
            <div class="text-[11px] text-slate-400">${m.available_count} dorixonada</div>
          </div>
        </button>
      `).join('');
      list.classList.remove('hidden');
    } catch (e) {}
  }

  async function loadSelectedMedicineOffers(focusPharmacyId = null) {
    if (!state.selectedMedId) return;
    const params = new URLSearchParams({
      city: state.city,
      availableOnly: String(state.filters.availableOnly),
      openNow: String(state.filters.openNow),
      is247: String(state.filters.is247),
      sort: state.sortBy,
      lat: String(state.userLocation.lat),
      lng: String(state.userLocation.lng)
    });
    try {
      const data = await api(`/api/medicines/${state.selectedMedId}/offers?${params.toString()}`);
      state.lastOffers = data.offers;
      renderOffers(data, focusPharmacyId);
    } catch (err) { showToast(err.message, 'error'); }
  }

  function renderOffers(data, focusPharmacyId = null) {
    const { medicine: med, stats, offers, analogs } = data;
    document.getElementById('controlsBar').classList.remove('hidden');

    [
      ['filterAvailableBtn', state.filters.availableOnly],
      ['filterOpenBtn', state.filters.openNow],
      ['filter247Btn', state.filters.is247]
    ].forEach(([id, active]) => {
      document.getElementById(id).className = active
        ? 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition bg-brand-green text-white border-brand-green'
        : 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition bg-white/80 text-slate-700 border-slate-200 hover:bg-white';
    });

    document.getElementById('sortPriceBtn').className = state.sortBy === 'price' ? 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-brand-green shadow-sm' : 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600';
    document.getElementById('sortDistanceBtn').className = state.sortBy === 'distance' ? 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-brand-green shadow-sm' : 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600';
    document.getElementById('viewListBtn').className = state.viewMode === 'list' ? 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-brand-blue shadow-sm' : 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600';
    document.getElementById('viewMapBtn').className = state.viewMode === 'map' ? 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-brand-blue shadow-sm' : 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600';

    document.getElementById('medicinePassport').innerHTML = `
      <div class="glass-strong rounded-3xl p-5 sm:p-6">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-brand-blue">${escapeHtml(med.category)}</span>
            <h2 class="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1.5">${escapeHtml(med.name)}</h2>
            <div class="mt-1.5 text-sm text-slate-600">
              <strong>Ta'sir etuvchi modda:</strong> ${escapeHtml(med.active_ingredient)}
              ${med.manufacturer ? ' • ' + escapeHtml(med.manufacturer) : ''}
              ${med.dosage ? ' • ' + escapeHtml(med.dosage) : ''}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3 shrink-0 md:min-w-[260px]">
            <div class="bg-emerald-50/80 border border-emerald-200/80 rounded-2xl p-3">
              <div class="text-[11px] font-semibold text-emerald-700 uppercase">Eng arzon</div>
              <div class="text-lg font-extrabold text-brand-green mt-0.5">${stats.min_price ? formatPrice(stats.min_price) : 'Mavjud emas'}</div>
            </div>
            <div class="bg-white/80 border border-slate-200/80 rounded-2xl p-3">
              <div class="text-[11px] font-semibold text-slate-500 uppercase">O‘rtacha</div>
              <div class="text-lg font-extrabold text-slate-800 mt-0.5">${stats.avg_price ? formatPrice(stats.avg_price) : '—'}</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('resultSummaryBar').innerHTML = `<strong>${offers.length} ta dorixona</strong> topildi`;
    const inStock = offers.filter(o => o.status !== 'out');
    const cheapest = inStock.length ? Math.min(...inStock.map(o => o.price)) : null;

    const listEl = document.getElementById('listViewContainer');
    const mapWrap = document.getElementById('mapViewContainer');

    if (state.viewMode === 'map') {
      listEl.classList.add('hidden');
      mapWrap.classList.remove('hidden');
      renderMap(offers, cheapest, focusPharmacyId);
    } else {
      mapWrap.classList.add('hidden');
      listEl.classList.remove('hidden');
      listEl.innerHTML = offers.length ? offers.map(o => {
        const isCheapest = cheapest !== null && o.status !== 'out' && o.price === cheapest;
        const st = statusMeta(o.status);
        return `
          <article class="glass rounded-3xl p-5 ${isCheapest ? 'ring-2 ring-brand-green/50' : ''} animate-fade-up">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div class="flex flex-wrap items-center gap-2 mb-1.5">
                  ${isCheapest ? '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand-green text-white">Eng arzon</span>' : ''}
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${st.cls}">
                    <span class="w-1.5 h-1.5 rounded-full ${st.dot}"></span>${st.label}
                  </span>
                  <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${o.open_now ? 'bg-sky-50 text-brand-blue' : 'bg-slate-200/70 text-slate-600'}">
                    ${formatHours(o)} • ${o.open_now ? 'Ochiq' : 'Yopiq'}
                  </span>
                </div>
                <h3 class="text-lg font-bold text-slate-900">${escapeHtml(o.pharmacy_name)}</h3>
                <div class="text-sm text-slate-600 mt-1">
                  ${escapeHtml(o.city)}, ${escapeHtml(o.address)}
                  ${o.distance_km !== null ? `<span class="ml-2 font-semibold text-brand-blue">${formatDistance(o.distance_km)}</span>` : ''}
                </div>
                ${Number(o.updated_days) >= 7 ? `<div class="text-xs text-amber-600 mt-1">Narx ${Number(o.updated_days)} kun oldin yangilangan — dorixonadan aniqlashtiring</div>` : ''}
              </div>
              <div class="flex flex-row md:flex-col items-center md:items-end justify-between gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-slate-200/70">
                <div class="text-2xl font-extrabold ${o.status === 'out' ? 'text-slate-400 line-through' : isCheapest ? 'text-brand-green' : 'text-slate-900'}">
                  ${formatPrice(o.price)}
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" data-action="open-call" data-pharmacy-id="${o.pharmacy_id}" class="px-3.5 py-2 rounded-xl bg-brand-green text-white text-xs sm:text-sm font-semibold">Qo‘ng‘iroq</button>
                  <button type="button" data-action="focus-on-map" data-pharmacy-id="${o.pharmacy_id}" class="px-3.5 py-2 rounded-xl bg-sky-50 text-brand-blue text-xs sm:text-sm font-semibold">Xaritada</button>
                  <a href="https://www.google.com/maps/dir/?api=1&destination=${Number(o.lat)},${Number(o.lng)}" target="_blank" rel="noopener noreferrer" class="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs sm:text-sm font-semibold">Yo‘nalish</a>
                </div>
              </div>
            </div>
          </article>
        `;
      }).join('') : '<div class="glass rounded-3xl p-8 text-center text-sm text-slate-600">Tanlangan filtrlarga mos dorixona topilmadi.</div>';
    }

    const analogsEl = document.getElementById('analogsSection');
    analogsEl.innerHTML = analogs.length ? `
      <div class="glass rounded-3xl p-5">
        <h3 class="text-base font-extrabold text-slate-900 mb-3">Muqobil (analog) dorilar</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${analogs.map(a => `
            <button type="button" data-action="select-med" data-med-id="${a.id}" class="text-left bg-white/80 hover:bg-white rounded-2xl border border-slate-200/80 p-4 transition">
              <div class="font-bold text-slate-900">${escapeHtml(a.name)}</div>
              <div class="text-xs text-slate-500 mt-0.5">${escapeHtml(a.manufacturer || a.active_ingredient)}</div>
              <div class="mt-2.5 flex items-center justify-between text-sm">
                <span class="font-extrabold text-brand-green">${a.min_price ? formatPrice(a.min_price) + ' dan' : 'Mavjud emas'}</span>
                <span class="text-xs font-semibold text-brand-blue">${a.available_count} dorixona →</span>
              </div>
            </button>
          `).join('')}
        </div>
      </div>
    ` : '';
    lucide.createIcons();
  }

  function renderMap(offers, cheapest, focusPharmacyId = null) {
    if (!leafletMap) {
      leafletMap = L.map('pharmacyMap').setView([40.7821, 72.3442], 12);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri', maxZoom: 18
      }).addTo(leafletMap);
      mapMarkersLayer = L.layerGroup().addTo(leafletMap);
    }
    setTimeout(() => {
      leafletMap.invalidateSize();
      mapMarkersLayer.clearLayers();
      markerByPharmacyId = {};
      const bounds = [];
      offers.forEach(o => {
        const isCheapest = cheapest !== null && o.status !== 'out' && o.price === cheapest;
        const pinCls = o.status === 'out' ? 'price-pin-out' : isCheapest ? 'price-pin-cheapest' : o.status === 'low' ? 'price-pin-low' : 'price-pin-normal';
        const icon = L.divIcon({
          className: 'leaflet-div-icon',
          html: `<div class="price-pin ${pinCls}">${formatPrice(o.price)}</div>`,
          iconSize: [110, 32], iconAnchor: [55, 16]
        });
        const m = L.marker([o.lat, o.lng], { icon }).bindPopup(`<b>${escapeHtml(o.pharmacy_name)}</b><br>${escapeHtml(o.address)}<br><b style="color:#059669">${formatPrice(o.price)}</b>`);
        m.addTo(mapMarkersLayer);
        markerByPharmacyId[o.pharmacy_id] = m;
        bounds.push([o.lat, o.lng]);
      });
      if (focusPharmacyId && markerByPharmacyId[focusPharmacyId]) {
        const t = offers.find(x => x.pharmacy_id === Number(focusPharmacyId));
        if (t) { leafletMap.setView([t.lat, t.lng], 15); markerByPharmacyId[focusPharmacyId].openPopup(); return; }
      }
      if (bounds.length === 1) leafletMap.setView(bounds[0], 14);
      else if (bounds.length > 1) leafletMap.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
    }, 60);
  }

  // =========================================================================
  // APPLY PAGE (Regular User submits pharmacy request)
  // =========================================================================
  async function loadMyRequests() {
    setTimeout(() => {
      if (!applyPickerMap) {
        applyPickerMap = L.map('applyPickerMap').setView([40.7821, 72.3442], 12);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri', maxZoom: 18
        }).addTo(applyPickerMap);
        applyPickerMarker = L.marker([40.7821, 72.3442]).addTo(applyPickerMap);
        applyPickerMap.on('click', (e) => {
          document.getElementById('reqPhLat').value = e.latlng.lat.toFixed(6);
          document.getElementById('reqPhLng').value = e.latlng.lng.toFixed(6);
          applyPickerMarker.setLatLng(e.latlng);
        });
      } else {
        applyPickerMap.invalidateSize();
      }
    }, 80);

    try {
      const res = await api('/api/my/pharmacy-requests');
      const el = document.getElementById('myRequestsList');
      el.innerHTML = res.requests.length ? res.requests.map(r => {
        const badge = r.status === 'approved'
          ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-brand-green">Tasdiqlandi</span>'
          : r.status === 'rejected'
            ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-600">Rad etildi</span>'
            : '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700">Admin tekshiruvida</span>';
        return `
          <div class="bg-white/80 rounded-2xl border border-slate-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div class="font-bold text-slate-900">${escapeHtml(r.name)} <span class="text-xs font-normal text-slate-500">(${escapeHtml(r.license_number)})</span></div>
              <div class="text-xs text-slate-600">${escapeHtml(r.city)}, ${escapeHtml(r.address)} • ${escapeHtml(r.phone)}</div>
              ${r.admin_note ? `<div class="text-xs text-slate-500 mt-1">Izoh: ${escapeHtml(r.admin_note)}</div>` : ''}
            </div>
            ${badge}
          </div>
        `;
      }).join('') : '<div class="text-sm text-slate-500">Siz hali ariza yubormagansiz.</div>';
    } catch (err) { showToast(err.message, 'error'); }
  }

  // =========================================================================
  // PHARMACY OWNER CABINET
  // =========================================================================
  async function loadPharmacyCabinet() {
    try {
      const phRes = await api('/api/my/pharmacies');
      state.myPharmacies = phRes.pharmacies;
      const container = document.getElementById('pharmacyCabinetContent');

      if (!state.myPharmacies.length) {
        container.innerHTML = `<div class="glass-strong rounded-3xl p-8 text-center text-sm text-slate-600">Sizga biriktirilgan tasdiqlangan dorixona yo‘q.</div>`;
        return;
      }
      if (!state.myPharmacies.some(p => p.id === state.activePharmacyId)) {
        state.activePharmacyId = state.myPharmacies[0].id;
      }
      const invRes = await api(`/api/pharmacies/${state.activePharmacyId}/inventory`);
      state.activeInventory = invRes.inventory;
      const ph = state.myPharmacies.find(p => p.id === state.activePharmacyId);

      container.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div class="lg:col-span-5 glass rounded-3xl p-5">
            <label class="block text-xs font-bold text-slate-500 uppercase mb-2">Dorixonani tanlang</label>
            <select id="myPharmacySelect" class="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm font-bold">
              ${state.myPharmacies.map(p => `<option value="${p.id}" ${p.id === ph.id ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.city)})</option>`).join('')}
            </select>
            <div class="mt-3 text-xs text-slate-600 space-y-1">
              <div><strong>Manzil:</strong> ${escapeHtml(ph.city)}, ${escapeHtml(ph.address)}</div>
              <div><strong>Telefon:</strong> ${escapeHtml(ph.phone)}</div>
              ${ph.license_number ? `<div><strong>Litsenziya:</strong> ${escapeHtml(ph.license_number)}</div>` : ''}
            </div>
          </div>

          <div class="lg:col-span-7 glass rounded-3xl p-5">
            <h3 class="text-sm font-bold text-slate-800 mb-3">Dorixona ma'lumotlari va ish vaqti</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <input type="tel" id="editPhPhone" value="${escapeHtml(ph.phone)}" placeholder="Telefon" class="px-3.5 py-2.5 rounded-xl glass-input text-sm" />
              <input type="text" id="editPhAddress" value="${escapeHtml(ph.address)}" placeholder="Manzil" class="px-3.5 py-2.5 rounded-xl glass-input text-sm" />
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <label class="inline-flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" id="editPh247" ${ph.is_247 ? 'checked' : ''} class="w-4 h-4 rounded" /> 24/7
              </label>
              <input type="time" id="editPhOpen" value="${escapeHtml(ph.open_time)}" class="px-3 py-2 rounded-xl glass-input text-sm font-semibold" />
              <input type="time" id="editPhClose" value="${escapeHtml(ph.close_time)}" class="px-3 py-2 rounded-xl glass-input text-sm font-semibold" />
              <button type="button" data-action="update-ph-hours" class="px-4 py-2 rounded-xl bg-brand-blue text-white text-sm font-semibold">Saqlash</button>
            </div>
          </div>
        </div>

        <div class="glass-strong rounded-3xl p-5">
          <h3 class="text-base font-bold text-slate-900 mb-4">Omborga dori qo‘shish</h3>
          <form id="addMedAndInvForm" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="text" id="invMedName" required placeholder="Dori nomi *" class="px-3.5 py-2.5 rounded-xl glass-input text-sm" />
            <input type="text" id="invMedActive" required placeholder="Ta'sir etuvchi modda *" class="px-3.5 py-2.5 rounded-xl glass-input text-sm" />
            <input type="text" id="invMedMfr" placeholder="Ishlab chiqaruvchi" class="px-3.5 py-2.5 rounded-xl glass-input text-sm" />
            <input type="text" id="invMedDose" placeholder="Doza (500 mg)" class="px-3.5 py-2.5 rounded-xl glass-input text-sm" />
            <input type="text" id="invMedCat" placeholder="Kategoriya" class="px-3.5 py-2.5 rounded-xl glass-input text-sm" />
            <input type="number" id="invMedPrice" required min="0" step="100" placeholder="Narxi (so‘m) *" class="px-3.5 py-2.5 rounded-xl glass-input text-sm font-bold" />
            <select id="invMedStatus" class="px-3.5 py-2.5 rounded-xl glass-input text-sm font-semibold">
              <option value="available">Mavjud</option>
              <option value="low">Kam qoldi</option>
              <option value="out">Tugagan</option>
            </select>
            <button type="submit" class="py-2.5 px-4 rounded-xl bg-brand-green hover:bg-brand-greenDark text-white text-sm font-bold">Qo‘shish</button>
          </form>

          <details class="mt-4 pt-3 border-t border-slate-200/70">
            <summary class="text-xs font-bold text-brand-blue cursor-pointer">CSV orqali ko‘plab dorilarni yuklash</summary>
            <div class="mt-2.5 space-y-2">
              <textarea id="csvImportText" rows="3" placeholder="name,active_ingredient,manufacturer,dosage,category,price,status" class="w-full p-3 rounded-xl glass-input text-xs font-mono"></textarea>
              <button type="button" data-action="import-csv" class="px-4 py-2 rounded-xl bg-brand-blue text-white text-xs font-bold">CSV import</button>
            </div>
          </details>
        </div>

        <div class="glass rounded-3xl overflow-hidden">
          <div class="p-4 border-b border-slate-200/70 font-bold text-slate-900">Dorixona ombori (${state.activeInventory.length})</div>
          <div class="divide-y divide-slate-200/60">
            ${state.activeInventory.length ? state.activeInventory.map(item => `
              <div class="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3" data-inv-id="${item.id}">
                <div>
                  <div class="font-bold text-slate-900">${escapeHtml(item.name)}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(item.active_ingredient)} ${item.dosage ? '• ' + escapeHtml(item.dosage) : ''}</div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <input type="number" min="0" step="100" value="${item.price}" data-field="price" class="w-32 px-3 py-2 rounded-xl glass-input text-sm font-bold" />
                  <select data-field="status" class="px-3 py-2 rounded-xl glass-input text-sm font-semibold">
                    <option value="available" ${item.status === 'available' ? 'selected' : ''}>Mavjud</option>
                    <option value="low" ${item.status === 'low' ? 'selected' : ''}>Kam qoldi</option>
                    <option value="out" ${item.status === 'out' ? 'selected' : ''}>Tugagan</option>
                  </select>
                  <button type="button" data-action="save-inv" data-inv-id="${item.id}" class="px-3 py-2 rounded-xl bg-brand-green text-white text-xs font-bold">Saqlash</button>
                  <button type="button" data-action="delete-inv" data-inv-id="${item.id}" class="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">O‘chirish</button>
                </div>
              </div>
            `).join('') : '<div class="p-6 text-center text-sm text-slate-500">Omborda hali dori yo‘q.</div>'}
          </div>
        </div>
      `;

      document.getElementById('myPharmacySelect').addEventListener('change', (e) => {
        state.activePharmacyId = Number(e.target.value);
        loadPharmacyCabinet();
      });

      document.getElementById('addMedAndInvForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const medRes = await api('/api/medicines', {
            method: 'POST',
            body: JSON.stringify({
              name: document.getElementById('invMedName').value,
              active_ingredient: document.getElementById('invMedActive').value,
              manufacturer: document.getElementById('invMedMfr').value,
              dosage: document.getElementById('invMedDose').value,
              category: document.getElementById('invMedCat').value || 'Umumiy'
            })
          });
          await api(`/api/pharmacies/${state.activePharmacyId}/inventory`, {
            method: 'POST',
            body: JSON.stringify({
              medicine_id: medRes.medicine.id,
              price: parseInt(document.getElementById('invMedPrice').value, 10),
              status: document.getElementById('invMedStatus').value
            })
          });
          showToast('Dori va narx saqlandi!');
          loadPharmacyCabinet();
        } catch (err) { showToast(err.message, 'error'); }
      });
    } catch (err) { showToast(err.message, 'error'); }
  }

  // =========================================================================
  // ADMIN PANEL
  // =========================================================================
  async function loadAdminPanel() {
    try {
      const data = await api('/api/admin/overview');
      const s = data.stats;
      document.getElementById('adminStatsGrid').innerHTML = [
        ['Foydalanuvchilar', s.users, 'text-slate-900'],
        ['Kutilayotgan arizalar', s.pending_requests, 'text-amber-600'],
        ['Dorixonalar', s.pharmacies, 'text-brand-green'],
        ['Dorilar', s.medicines, 'text-brand-blue'],
        ['Narx yozuvlari', s.inventory, 'text-slate-900']
      ].map(([label, val, cls]) => `
        <div class="glass rounded-2xl p-4">
          <div class="text-xs font-semibold text-slate-500">${label}</div>
          <div class="text-2xl font-extrabold mt-1 ${cls}">${val}</div>
        </div>
      `).join('');

      document.getElementById('admPhOwner').innerHTML = data.users.map(u =>
        `<option value="${u.id}">${escapeHtml(u.full_name)} (${escapeHtml(u.phone)})</option>`
      ).join('');

      document.getElementById('adminRequestsList').innerHTML = data.requests.length ? data.requests.map(r => `
        <div class="bg-white/80 rounded-2xl border border-slate-200/80 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div class="font-bold text-slate-900">${escapeHtml(r.name)} <span class="text-xs font-semibold text-brand-blue">• Litsenziya: ${escapeHtml(r.license_number)}</span></div>
            <div class="text-xs text-slate-600 mt-0.5">${escapeHtml(r.city)}, ${escapeHtml(r.address)} • ${escapeHtml(r.phone)}</div>
            <div class="text-xs text-slate-500 mt-0.5">Ariza beruvchi: ${escapeHtml(r.owner_name)} (${escapeHtml(r.owner_phone)})</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${r.status === 'pending' ? `
              <button type="button" data-action="approve-req" data-req-id="${r.id}" class="px-3.5 py-2 rounded-xl bg-brand-green text-white text-xs font-bold">Tasdiqlash</button>
              <button type="button" data-action="reject-req" data-req-id="${r.id}" class="px-3.5 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">Rad etish</button>
            ` : `<span class="px-3 py-1 rounded-full text-xs font-bold ${r.status === 'approved' ? 'bg-emerald-50 text-brand-green' : 'bg-rose-50 text-rose-600'}">${r.status === 'approved' ? 'Tasdiqlangan' : 'Rad etilgan'}</span>`}
          </div>
        </div>
      `).join('') : '<div class="text-sm text-slate-500">Hozircha dorixona ochish arizalari yo‘q.</div>';

      document.getElementById('adminUsersList').innerHTML = data.users.map(u => `
        <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div class="font-bold text-slate-900 text-sm">${escapeHtml(u.full_name)}</div>
            <div class="text-xs text-slate-500">${escapeHtml(u.phone)}${Number(u.pharmacy_count) > 0 ? ` • Dorixonalar: ${Number(u.pharmacy_count)}` : (u.role === 'pharmacy_owner' ? ' • <span class="text-amber-600 font-semibold">dorixona biriktirilmagan</span>' : '')}</div>
          </div>
          <div class="flex items-center gap-2">
            <select data-role-user-id="${u.id}" class="px-3 py-1.5 rounded-xl glass-input text-xs font-bold">
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>Foydalanuvchi</option>
              <option value="pharmacy_owner" ${u.role === 'pharmacy_owner' ? 'selected' : ''}>Dorixona egasi</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option>
            </select>
            <button type="button" data-action="save-user-role" data-user-id="${u.id}" class="px-3 py-1.5 rounded-xl bg-brand-blue text-white text-xs font-bold">Saqlash</button>
          </div>
        </div>
      `).join('');

      document.getElementById('adminPharmaciesList').innerHTML = data.pharmacies.length ? data.pharmacies.map(p => `
        <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div class="font-bold text-slate-900 text-sm">${escapeHtml(p.name)} <span class="text-xs font-normal text-slate-500">(${escapeHtml(p.city)})</span></div>
            <div class="text-xs text-slate-500">${escapeHtml(p.address)} • Ega: ${escapeHtml(p.owner_name)} (${escapeHtml(p.owner_phone)})</div>
          </div>
          <div class="flex items-center gap-2 self-start">
            <button type="button" data-action="transfer-ph" data-ph-id="${p.id}" class="px-3 py-1.5 rounded-xl bg-sky-50 text-brand-blue text-xs font-bold">Egasini o‘zgartirish</button>
            <button type="button" data-action="admin-delete-ph" data-ph-id="${p.id}" class="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">O‘chirish</button>
          </div>
        </div>
      `).join('') : '<div class="text-sm text-slate-500 py-2">Hozircha tasdiqlangan dorixonalar yo‘q.</div>';
      loadAdminMedicines();
    } catch (err) { showToast(err.message, 'error'); }
  }

  // ---- Admin: dorilarni boshqarish
  async function loadAdminMedicines() {
    const el = document.getElementById('adminMedicinesList');
    try {
      const q = document.getElementById('admMedSearch').value.trim();
      const data = await api(`/api/medicines?limit=30&q=${encodeURIComponent(q)}`);
      state.adminMeds = data.medicines;
      el.innerHTML = data.medicines.length ? data.medicines.map(m => `
        <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div class="font-bold text-slate-900 text-sm"><span class="text-xs font-semibold text-slate-400">#${m.id}</span> ${escapeHtml(m.name)} ${m.dosage ? `<span class="text-xs font-normal text-slate-500">${escapeHtml(m.dosage)}</span>` : ''}</div>
            <div class="text-xs text-slate-500">${escapeHtml(m.active_ingredient)}${m.manufacturer ? ' • ' + escapeHtml(m.manufacturer) : ''} • Narx yozuvlari: ${Number(m.offers_count)}</div>
          </div>
          <div class="flex items-center gap-2 self-start">
            <button type="button" data-action="adm-med-edit" data-med-id="${m.id}" class="px-3 py-1.5 rounded-xl bg-sky-50 text-brand-blue text-xs font-bold">Tahrirlash</button>
            <button type="button" data-action="adm-med-merge" data-med-id="${m.id}" class="px-3 py-1.5 rounded-xl bg-amber-50 text-amber-700 text-xs font-bold">Birlashtirish</button>
            <button type="button" data-action="adm-med-delete" data-med-id="${m.id}" class="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">O‘chirish</button>
          </div>
        </div>
      `).join('') + (data.total > data.medicines.length ? `<div class="pt-3 text-xs text-slate-500">Jami ${data.total} ta dori. Qidiruv orqali toraytiring.</div>` : '')
        : '<div class="text-sm text-slate-500 py-2">Dori topilmadi.</div>';
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function saveUserRole(uid, role, extra = {}) {
    try {
      const r = await api(`/api/admin/users/${uid}/role`, { method: 'PATCH', body: JSON.stringify({ role, ...extra }) });
      if (r.warning === 'no_pharmacy') {
        showToast('Rol berildi, lekin hali dorixona biriktirilmagan. Pastdagi dorixonalar ro‘yxatidan “Egasini o‘zgartirish” orqali biriktiring.', 'info', 7000);
      } else showToast('Foydalanuvchi roli yangilandi!');
      loadAdminPanel();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.needs_decision) {
        const choice = prompt(`${err.message}\n\n1 — Dorixonalar qolsin (admin boshqaradi)\n2 — Dorixonalar o‘chirilsin\n3 — Boshqa foydalanuvchiga o‘tkazilsin\n\nRaqamni kiriting:`);
        if (choice === '1') return saveUserRole(uid, role, { pharmacy_action: 'keep' });
        if (choice === '2') {
          if (!confirm('Dorixonalar va ularning barcha narxlari o‘chiriladi. Davom etasizmi?')) return;
          return saveUserRole(uid, role, { pharmacy_action: 'delete' });
        }
        if (choice === '3') {
          const phone = prompt('Dorixonalar o‘tkaziladigan foydalanuvchi telefon raqami (+998...):');
          if (phone) return saveUserRole(uid, role, { pharmacy_action: 'transfer', transfer_to_phone: phone });
        }
        return;
      }
      showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // GLOBAL EVENT LISTENERS
  // =========================================================================
  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const endpoint = state.authTab === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = {
      phone: document.getElementById('authPhone').value,
      password: document.getElementById('authPassword').value
    };
    if (state.authTab === 'register') payload.full_name = document.getElementById('authFullName').value;
    try {
      const data = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      saveToken(data.token);
      state.user = data.user;
      e.target.reset();
      showToast(`Xush kelibsiz, ${data.user.full_name} (${roleLabel(data.user.role)})!`);
      enterApp();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('applyPharmacyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/pharmacy-requests', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('reqPhName').value,
          license_number: document.getElementById('reqPhLicense').value,
          city: document.getElementById('reqPhCity').value,
          address: document.getElementById('reqPhAddress').value,
          phone: document.getElementById('reqPhPhone').value,
          lat: parseFloat(document.getElementById('reqPhLat').value),
          lng: parseFloat(document.getElementById('reqPhLng').value),
          is_247: document.getElementById('reqPh247').checked,
          open_time: document.getElementById('reqPhOpen').value,
          close_time: document.getElementById('reqPhClose').value
        })
      });
      e.target.reset();
      showToast('Arizangiz yuborildi! Admin tasdiqlashini kuting.');
      loadMyRequests();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('adminCreatePharmacyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/pharmacies', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('admPhName').value,
          license_number: document.getElementById('admPhLicense').value,
          city: document.getElementById('admPhCity').value,
          address: document.getElementById('admPhAddress').value,
          phone: document.getElementById('admPhPhone').value,
          lat: parseFloat(document.getElementById('admPhLat').value),
          lng: parseFloat(document.getElementById('admPhLng').value),
          owner_id: parseInt(document.getElementById('admPhOwner').value, 10),
          is_247: document.getElementById('admPh247').checked,
          open_time: document.getElementById('admPhOpen').value,
          close_time: document.getElementById('admPhClose').value
        })
      });
      e.target.reset();
      document.getElementById('adminAddPhCard').classList.add('hidden');
      showToast('Dorixona qo‘shildi!');
      loadAdminPanel();
    } catch (err) { showToast(err.message, 'error'); }
  });

  const searchInput = document.getElementById('searchInput');
  let searchTimer = null;
  searchInput.addEventListener('input', (e) => {
    state.query = e.target.value;
    document.getElementById('clearSearchBtn').classList.toggle('hidden', !state.query.length);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadAutocomplete(state.query), 180);
  });
  searchInput.addEventListener('focus', () => loadAutocomplete(searchInput.value));
  document.getElementById('citySelect').addEventListener('change', (e) => {
    state.city = e.target.value;
    loadSelectedMedicineOffers();
  });

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#searchInput') && !e.target.closest('#autocompleteList')) {
      document.getElementById('autocompleteList').classList.add('hidden');
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'auth-tab') setAuthTab(btn.dataset.tab);
    else if (action === 'show-auth') showAuthGate();
    else if (action === 'back-to-search') enterApp();
    else if (action === 'switch-page') switchPage(btn.dataset.page);
    else if (action === 'logout') {
      saveToken(null);
      state.user = null;
      state.selectedMedId = null;
      enterApp();
      showToast('Tizimdan chiqdingiz', 'info');
    } else if (action === 'select-med') {
      state.selectedMedId = Number(btn.dataset.medId);
      document.getElementById('autocompleteList').classList.add('hidden');
      await loadSelectedMedicineOffers();
      await loadSearchOverview();
    } else if (action === 'clear-search') {
      searchInput.value = '';
      state.query = '';
      document.getElementById('clearSearchBtn').classList.add('hidden');
      loadAutocomplete('');
    } else if (action === 'toggle-filter') {
      state.filters[btn.dataset.filter] = !state.filters[btn.dataset.filter];
      loadSelectedMedicineOffers();
    } else if (action === 'set-sort') {
      state.sortBy = btn.dataset.sort;
      loadSelectedMedicineOffers();
    } else if (action === 'set-view') {
      state.viewMode = btn.dataset.view;
      loadSelectedMedicineOffers();
    } else if (action === 'find-nearby') {
      state.sortBy = 'distance';
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => { state.userLocation = { lat: p.coords.latitude, lng: p.coords.longitude }; loadSelectedMedicineOffers(); showToast('Eng yaqin dorixonalar saralandi!'); },
          () => { loadSelectedMedicineOffers(); showToast('Masofa bo‘yicha saralandi', 'info'); },
          { timeout: 3000 }
        );
      } else loadSelectedMedicineOffers();
    } else if (action === 'open-call') {
      const o = state.lastOffers.find(x => String(x.pharmacy_id) === String(btn.dataset.pharmacyId));
      if (!o) return;
      state.activeCallPhone = o.phone;
      document.getElementById('callModalTitle').textContent = o.pharmacy_name;
      document.getElementById('callModalAddress').textContent = `${o.city}, ${o.address}`;
      document.getElementById('callModalPhone').textContent = o.phone;
      document.getElementById('callModalHours').textContent = `Ish vaqti: ${formatHours(o)}`;
      document.getElementById('callModalTelLink').href = 'tel:' + o.phone.replace(/\s+/g, '');
      document.getElementById('callModal').classList.remove('hidden');
    } else if (action === 'close-call-modal') {
      document.getElementById('callModal').classList.add('hidden');
    } else if (action === 'copy-phone') {
      navigator.clipboard?.writeText(state.activeCallPhone).then(() => showToast('Nusxalandi: ' + state.activeCallPhone));
    } else if (action === 'focus-on-map') {
      state.viewMode = 'map';
      loadSelectedMedicineOffers(btn.dataset.pharmacyId);
    } else if (action === 'update-ph-hours') {
      try {
        await api(`/api/pharmacies/${state.activePharmacyId}`, {
          method: 'PUT',
          body: JSON.stringify({
            phone: document.getElementById('editPhPhone').value,
            address: document.getElementById('editPhAddress').value,
            is_247: document.getElementById('editPh247').checked,
            open_time: document.getElementById('editPhOpen').value,
            close_time: document.getElementById('editPhClose').value
          })
        });
        showToast('Dorixona ma‘lumotlari yangilandi!');
        loadPharmacyCabinet();
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'save-inv') {
      const row = btn.closest('[data-inv-id]');
      try {
        await api(`/api/inventory/${btn.dataset.invId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            price: parseInt(row.querySelector('[data-field="price"]').value, 10),
            status: row.querySelector('[data-field="status"]').value
          })
        });
        showToast('Yangilandi!');
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'delete-inv') {
      if (!confirm('Bu dorini ombordan o‘chirasizmi?')) return;
      try {
        await api(`/api/inventory/${btn.dataset.invId}`, { method: 'DELETE' });
        showToast('O‘chirildi', 'info');
        loadPharmacyCabinet();
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'import-csv') {
      try {
        const res = await api(`/api/pharmacies/${state.activePharmacyId}/inventory/import-csv`, {
          method: 'POST',
          body: JSON.stringify({ csv: document.getElementById('csvImportText').value })
        });
        showToast(`${res.imported} ta dori yuklandi!` + (res.skipped ? ` (${res.skipped} ta qator noto‘g‘ri bo‘lgani uchun o‘tkazib yuborildi)` : ''), res.skipped ? 'info' : 'success', res.skipped ? 6000 : 3200);
        loadPharmacyCabinet();
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'toggle-admin-add-ph') {
      document.getElementById('adminAddPhCard').classList.toggle('hidden');
    } else if (action === 'approve-req') {
      try {
        await api(`/api/admin/requests/${btn.dataset.reqId}/approve`, { method: 'POST' });
        showToast('Ariza tasdiqlandi va dorixona qo‘shildi!');
        loadAdminPanel();
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'reject-req') {
      const note = prompt('Rad etish sababi (ixtiyoriy):');
      if (note === null) return;
      try {
        await api(`/api/admin/requests/${btn.dataset.reqId}/reject`, { method: 'POST', body: JSON.stringify({ admin_note: note }) });
        showToast('Ariza rad etildi', 'info');
        loadAdminPanel();
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'save-user-role') {
      const uid = btn.dataset.userId;
      const role = document.querySelector(`[data-role-user-id="${uid}"]`).value;
      await saveUserRole(uid, role);
    } else if (action === 'admin-delete-ph') {
      if (!confirm('Dorixona va uning barcha narx yozuvlari o‘chiriladi. Davom etasizmi?')) return;
      try {
        await api(`/api/admin/pharmacies/${btn.dataset.phId}`, { method: 'DELETE' });
        showToast('Dorixona o‘chirildi', 'info');
        loadAdminPanel();
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'transfer-ph') {
      const phone = prompt('Dorixonaning yangi egasi telefon raqami (+998...). U avtomatik “Dorixona egasi” bo‘ladi:');
      if (!phone) return;
      try {
        await api(`/api/admin/pharmacies/${btn.dataset.phId}/owner`, { method: 'POST', body: JSON.stringify({ owner_phone: phone }) });
        showToast('Dorixona yangi egaga biriktirildi!');
        loadAdminPanel();
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'adm-med-edit') {
      const m = (state.adminMeds || []).find(x => String(x.id) === btn.dataset.medId);
      if (!m) return;
      const name = prompt('Dori nomi:', m.name); if (name === null) return;
      const active = prompt('Ta‘sir etuvchi modda:', m.active_ingredient); if (active === null) return;
      const mfr = prompt('Ishlab chiqaruvchi:', m.manufacturer); if (mfr === null) return;
      const dose = prompt('Doza:', m.dosage); if (dose === null) return;
      try {
        await api(`/api/admin/medicines/${m.id}`, { method: 'PUT', body: JSON.stringify({ name, active_ingredient: active, manufacturer: mfr, dosage: dose }) });
        showToast('Dori yangilandi!');
        loadAdminMedicines();
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'adm-med-delete') {
      if (!confirm('Dori va unga tegishli barcha narx yozuvlari o‘chiriladi. Davom etasizmi?')) return;
      try {
        await api(`/api/admin/medicines/${btn.dataset.medId}`, { method: 'DELETE' });
        showToast('Dori o‘chirildi', 'info');
        loadAdminPanel();
      } catch (err) { showToast(err.message, 'error'); }
    } else if (action === 'adm-med-merge') {
      const toId = prompt(`#${btn.dataset.medId} dorini qaysi dori (# raqami) bilan birlashtiramiz? Barcha narxlar o‘sha doriga ko‘chadi, bu dori o‘chiriladi.`);
      if (!toId) return;
      try {
        const r = await api('/api/admin/medicines/merge', { method: 'POST', body: JSON.stringify({ from_id: btn.dataset.medId, to_id: toId }) });
        showToast(`Birlashtirildi (${r.moved_offers} ta narx ko‘chirildi)`);
        loadAdminPanel();
      } catch (err) { showToast(err.message, 'error'); }
    }
  });

  let admMedTimer = null;
  document.getElementById('admMedSearch').addEventListener('input', () => {
    clearTimeout(admMedTimer);
    admMedTimer = setTimeout(loadAdminMedicines, 250);
  });

  initSession();
})();
