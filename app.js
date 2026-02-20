
// app.js (ES module) – supports root ("/") and sub-path (e.g., "/extoz") via window.__BASE__
// If window.__BASE__ is '/' we treat the base as '' (root). If absent, default to '/extoz'.

const PROVIDED = (window.__BASE__ ?? '').replace(/\/$/, '');
const BASE = (PROVIDED === '') ? '' : (PROVIDED || '/extoz');
const QS = new URLSearchParams(location.search);
// id used to identify building‑inspection service in configs
const BUILDING_SERVICE_ID = 'building';
const PREPURCH_SERVICE_ID = 'prepurchase';
const PEST_SERVICE_ID = 'pest';

function getTenantId() {
  const raw = (QS.get('tenant') || '').toLowerCase().trim();
  const ALLOWED = ['default', 'ulysses', 'extoz', 'freemano'];
  return ALLOWED.includes(raw) ? raw : 'default';
}
function getLang() { return QS.get('lang') || document.documentElement.lang || 'en'; }
function applyCssVars(vars = {}) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    if (!/^[a-zA-Z0-9-]+$/.test(k)) continue;
    root.style.setProperty(`--${k}`, String(v));
  }
}
function uuidv4() {
  // browsers with crypto support
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  // fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function setFavicon(href) { const link = document.querySelector('link#favicon[rel="icon"]'); if (link && href) link.href = href; }
function tFactory(cfg, lang) { return (key, fallback='') => cfg.text?.[key]?.[lang] ?? cfg.text?.[key]?.en ?? fallback; }
function pFactory(cfg, lang) { return (key, fallback='') => cfg.policy?.[key]?.[lang] ?? cfg.policy?.[key]?.en ?? fallback; }
function roundTo30Min(value) {
  if (!value) return value; const [h, m] = value.split(':').map(Number); if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const total = h*60 + m; const r = Math.round(total/30)*30; const hh = String(Math.floor(r/60)).padStart(2,'0'); const mm = String(r%60).padStart(2,'0'); return `${hh}:${mm}`;
}
function withBase(p) {
  if (!p) return p; if (/^https?:\/\//i.test(p)) return p; if (p.startsWith('/')) return BASE + p; return `${BASE}/${p.replace(/^\/+/, '')}`;
}
// show/hide building fields when appropriate
function updateBuildingFields() {
  const form = document.getElementById('inspection-form'); if (!form) return;
  const selected = Array.from(form.elements['service'].selectedOptions).map(opt => ({ code: opt.value, quantity: 1 }));
  const should = (selected.some(s => s.code === BUILDING_SERVICE_ID) || selected.some(s => s.code === PREPURCH_SERVICE_ID));
  const container = document.getElementById('building-details');
  if (container){ container.hidden = !should; container.setAttribute('aria-hidden', String(!should)); }
}

(async function boot(){
  const tenant = getTenantId(); const lang = getLang();
  document.documentElement.dataset.tenant = tenant; document.documentElement.lang = lang;

  // Load tenant config
  let cfg;
  let r;
  try { 
    r = await fetch(`${BASE}/tenants/${tenant}.json`, { cache: 'no-cache' });   
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }catch { 
    r = await fetch(`${BASE}/tenants/default.json`, { cache: 'no-cache' }); 
  }
  try{  
  if (r.ok) { 
    cfg = await r.json(); }
  }catch(e){ 
    console.error(e); 
    return; 
  }
  
  // Normalize asset paths to include BASE if JSON used root-relative
  if (cfg && cfg.assets) { if (cfg.assets.logo) cfg.assets.logo = withBase(cfg.assets.logo); if (cfg.assets.favicon) cfg.assets.favicon = withBase(cfg.assets.favicon); }

  // Theme & assets
  applyCssVars(cfg.cssVars);
  const logo = document.getElementById('logo'); if (logo && cfg.assets?.logo) logo.src = cfg.assets.logo;
  if (cfg.assets?.favicon) setFavicon(cfg.assets.favicon);
  // i18n
  const t = tFactory(cfg, lang);
  document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.getAttribute('data-i18n'); el.textContent = t(key, el.textContent); });
  const p = pFactory(cfg, lang);
  document.querySelectorAll('[data-policy]').forEach(el => { const key = el.getAttribute('data-policy'); el.href = p(key, el.href); });
  // Route per page
  const isVerify = !!document.getElementById('verification-cta');
  const isInspection = !!document.getElementById('inspection-form');
  if (isVerify) initVerifyPage(cfg, tenant, lang);
  if (isInspection) initInspectionPage(cfg, tenant, lang);
})();

function initVerifyPage(cfg, tenant, lang) {
  const btn = document.getElementById('verification-cta');
  const msg = document.getElementById('verify-intro');
  const err = document.getElementById('verify-error');
  const showError = (m) => {
    if (err) {
      err.textContent = m || '';
      err.hidden = !m;
    }
  };

  // Helper to read query params
  const getParam = (k) => new URLSearchParams(location.search).get(k);
  // Pull values from URL
  const idempotencyKey = getParam('idempotencyKey'); // <-- NEW
  const target = getParam('target'); // optional param to indicate where user came from (e.g., "email-link", "sms-link", "dashboard", etc.) for better logging/analytics in your flow
  if (msg && target) {
    if (target.lastIndexOf('email', 0) === -1) {
      msg.textContent = 'When you click verify we will confirm you phone details you provided.';
    } else {
      msg.textContent = 'When you click verify we will confirm you email details you provided.';
    }
  }
  // Choose endpoint: explicit verify flow 
  var url = (cfg.endpoints?.verifyHttpFlow || '').trim();  
  if (btn) {
    btn.addEventListener('click', async () => {
      showError('');
      if (!url || (url.length <= 0)){
        showError('No verification endpoint is configured for this tenant.');
        return;
      }else{
        url = 'api/verify'; 
      }

      // Build payload with idempotencyKey included
      const payload = {
        tenant,
        lang,
        source: 'verify-page',
        target: target || null,
        idempotencyKey: idempotencyKey || null,          // <-- NEW
        submittedUtc: new Date().toISOString()
      };

      // Prepare headers. We also send Idempotency-Key as an HTTP header for handlers that prefer that model.
      const headers = {
        'content-type': 'application/json'
      };
      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;     // <-- OPTIONAL but useful
      }
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = 'Verifying…';
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        // Prefer JSON error message if available
        if (!r.ok) {
          let reason = '';
          try { reason = await r.text(); } catch {}
          throw new Error(reason || `HTTP ${r.status}`);
        }

        // Optionally inspect the JSON for a 'status'/'message' model from your flow
        // const data = await r.json().catch(() => ({}));
        alert('Thanks! We’ve verified your details.');
      } catch (e) {
        console.error(e);
        showError('Could not verify right now. Please try again.');
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  }
}

function initInspectionPage(cfg, tenant, lang) {
  const form = document.getElementById('inspection-form'); const saveDraftBtn = document.getElementById('saveDraftBtn'); const submitBtn = document.getElementById('submitBtn'); 
  const errorEl = document.getElementById('form-error');
  const showError = (m)=>{ if (errorEl) { errorEl.textContent = m; errorEl.hidden = !m; } };
  const serviceSel = document.getElementById('service'); if (serviceSel && Array.isArray(cfg.services)) { for (const s of cfg.services) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.label; serviceSel.appendChild(o);} }
  serviceSel?.addEventListener('change', updateBuildingFields);
  const DRAFT_KEY = `draft:${tenant}`; try { const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); if (d && form) { for (const [k,v] of Object.entries(d)) { const el = form.elements.namedItem(k); if (el && 'value' in el) el.value = v; } } } catch {}
  for (const id of ['time1','time2']) { const el = document.getElementById(id); el?.addEventListener('change', ()=>{ el.value = roundTo30Min(el.value); }); }
  saveDraftBtn?.addEventListener('click', ()=>{ if (!form) return; const data = Object.fromEntries(new FormData(form).entries()); sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); alert('Draft saved on this device.'); });
  form?.addEventListener('submit', async (e)=>{
    e.preventDefault(); showError(''); const website = form.website?.value?.trim(); if (website) { alert('Thank you! We will be in touch shortly.'); form.reset(); return; }
    if (!form.checkValidity()) { showError('Please fix the highlighted fields and try again.'); form.reportValidity?.(); return; }
    const fd = new FormData(form);
      // Multi-select services => array of { code, quantity: 1 }
    const services = Array.from(form.elements['service'].selectedOptions)
      .map(opt => ({ code: opt.value, quantity: 1 }));   
  
    const payload = {
      tenant, lang, source: 'inspection-form',
      idempotencyKey: uuidv4(),title: fd.get('title')?.toString().trim() || null,
      firstName: fd.get('firstName')?.toString().trim(), lastName: fd.get('lastName')?.toString().trim(),
      email: fd.get('email')?.toString().trim().toLowerCase(), phone: fd.get('phone')?.toString().trim(),
      prefMethod: fd.get('contactMethod')?.toString().trim(),
      address1: fd.get('address1')?.toString().trim(), address2: fd.get('address2')?.toString().trim() || null,
      suburb: fd.get('suburb')?.toString().trim(), state: fd.get('state')?.toString().trim(), postcode: fd.get('postcode')?.toString().trim(), country: 'AU',
      address3: fd.get('address3')?.toString().trim() || null,
      service: services,
      serviceNotes: fd.get('notes')?.toString().trim() || null,
      preferences: [ toPreference(fd.get('date1')?.toString(), fd.get('time1')?.toString()), toPreference(fd.get('date2')?.toString(), fd.get('time2')?.toString()) ].filter(Boolean),
      submittedUtc: new Date().toISOString(),
      metadata: {policyAccepted: !!fd.get('privacyPolicy'), termsAccepted: !!fd.get('termsConsent')}
    };
    // attach building numbers if relevant
    if (services.some(s => s.code === BUILDING_SERVICE_ID) || services.some(s => s.code === PREPURCH_SERVICE_ID)) {
      payload.building = {
        nbrBuildings: Number(fd.get('nbrBuildings') || 0),
        nbrLounge: Number(fd.get('nbrLounge') || 0),
        nbrKitchen: Number(fd.get('nbrKitchen') || 0),
        nbrBathroom: Number(fd.get('nbrBathroom') || 0),
        nbrBedroom: Number(fd.get('nbrBedroom') || 0),
        nbrToilet: Number(fd.get('nbrToilet') || 0),
        nbrLaundry: Number(fd.get('nbrLaundry') || 0),
        nbrOther: Number(fd.get('nbrOther') || 0)
      };
      if (payload.building.nbrBuildings <= 0) { showError('Please specify the number of buildings/structures to be inspected.'); return;}
    }
    if (payload.phone?.startsWith('0')) payload.phone = '+61' + payload.phone.slice(1).replace(/\s+/g, '');
    var url = cfg.endpoints?.inspectionRequestFlow || ''; 
    if (!url || (url.length <= 0)) { showError('Submission endpoint is not configured for this tenant.'); return; }else{ url = 'api/inspection'; }
    setBusy(true); try { const r = await fetch(url, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload) }); 
    if (!r.ok) throw new Error(await r.text().catch(()=>`HTTP ${r.status}`)); 
      sessionStorage.removeItem(DRAFT_KEY); alert('Thanks! Your inspection request has been submitted.'); 
      form.reset(); }
    catch(err){ console.error(err); showError('Something went wrong submitting your request. Please try again.'); }
    finally { setBusy(false); }
  });
  function setBusy(b){ if (!submitBtn) return; submitBtn.disabled = !!b; submitBtn.textContent = b ? 'Submitting…' : 'Submit request'; }
  function toPreference(d,t){ if (!d && !t) return null; const time = roundTo30Min(t || '09:00'); return { date: d || null, time, localDateTime: d ? `${d}T${time}` : null }; }
}
