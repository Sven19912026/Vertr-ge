(() => {
  'use strict';

  const DB_NAME = 'contractManagerV1';
  const DB_VERSION = 1;
  const STORES = ['providers','contracts','categories','users','notes','cancellations','documents','audit','settings'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const uid = (prefix='id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const fmtDate = (value) => value ? new Intl.DateTimeFormat('de-DE').format(new Date(`${value}T00:00:00`)) : '—';
  const fmtDateTime = (value) => value ? new Intl.DateTimeFormat('de-DE', {dateStyle:'short', timeStyle:'short'}).format(new Date(value)) : '—';
  const todayISO = () => new Date().toISOString().slice(0,10);
  const euro = (n) => new Intl.NumberFormat('de-DE', {style:'currency', currency:'EUR'}).format(Number(n || 0));
  const escapeHtml = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  class IndexedDbStorage {
    constructor() { this.db = null; }
    async init() {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          STORES.forEach(name => {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, {keyPath:'id'});
          });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    store(name, mode='readonly') { return this.db.transaction(name, mode).objectStore(name); }
    async getAll(name) {
      return new Promise((resolve, reject) => {
        const req = this.store(name).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }
    async get(name, id) {
      return new Promise((resolve, reject) => {
        const req = this.store(name).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }
    async put(name, record) {
      return new Promise((resolve, reject) => {
        const req = this.store(name, 'readwrite').put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
      });
    }
    async del(name, id) {
      return new Promise((resolve, reject) => {
        const req = this.store(name, 'readwrite').delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
    async clear(name) {
      return new Promise((resolve, reject) => {
        const req = this.store(name, 'readwrite').clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }

  // Später kann dieser Adapter durch einen DashwiseApiStorage-Adapter ersetzt werden,
  // ohne die Oberfläche neu zu bauen.
  const storage = new IndexedDbStorage();

  const state = {
    view: 'dashboard',
    userId: null,
    data: Object.fromEntries(STORES.map(s => [s, []])),
    filters: {contractSearch:'', providerSearch:'', category:'', company:'', status:''}
  };

  const viewMeta = {
    dashboard: ['Dashboard', 'Verträge, Fristen und Kündigungen im Blick'],
    providers: ['Dienstleister', 'Dienstleister mit zugeordneten Verträgen und Notizen'],
    contracts: ['Verträge', 'Alle Verträge durchsuchen, filtern und verwalten'],
    cancellations: ['Kündigungen', 'Kündigungsvorgänge und letzte Aktivitäten'],
    categories: ['Kategorien', 'Frei verwaltbare Vertragskategorien'],
    users: ['Benutzer', 'Benutzer und Rollen verwalten'],
    settings: ['Daten & Export', 'Lokale Daten sichern und für Dashwise vorbereiten']
  };

  async function reload() {
    for (const s of STORES) state.data[s] = await storage.getAll(s);
    if (!state.userId || !state.data.users.some(u => u.id === state.userId)) {
      state.userId = state.data.users[0]?.id || null;
    }
    renderUserSelect();
  }

  function currentUser() { return state.data.users.find(u => u.id === state.userId) || null; }
  function canEdit() { return ['admin','editor'].includes(currentUser()?.role); }
  function isAdmin() { return currentUser()?.role === 'admin'; }

  function providerName(id) { return state.data.providers.find(x => x.id === id)?.name || '—'; }
  function categoryName(id) { return state.data.categories.find(x => x.id === id)?.name || '—'; }
  function userName(id) { return state.data.users.find(x => x.id === id)?.name || '—'; }
  function emailReminderEnabled(contract) { return contract?.emailReminder !== false; }
  function notificationRecipient(contract) {
    const direct = String(contract?.notificationEmail || '').trim();
    if (direct) return direct;
    return String(state.data.users.find(u => u.id === contract?.ownerId)?.email || '').trim();
  }
  function openOutlookDraft(contract) {
    const to = notificationRecipient(contract);
    if (!to) { toast('Kein Mail-Empfänger hinterlegt.'); return; }
    const deadline = cancellationDeadline(contract);
    const provider = providerName(contract.providerId);
    const subject = `Fristerinnerung: ${contract.name} – Kündigen bis ${fmtDate(deadline)}`;
    const body = [
      `Fristerinnerung für den Vertrag "${contract.name}".`,
      `Dienstleister: ${provider}`,
      contract.company ? `Gesellschaft: ${contract.company}` : '',
      contract.endDate ? `Vertragsende: ${fmtDate(contract.endDate)}` : '',
      deadline ? `Kündigen bis: ${fmtDate(deadline)}` : '',
      `Erinnerungsvorlauf: ${Number(contract.reminderDays || 0)} Tage`,
      '',
      'Diese Nachricht wurde im Vertragsmanager vorbereitet.'
    ].filter(Boolean).join('\n');
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function daysBetween(dateA, dateB) {
    const a = new Date(`${dateA}T00:00:00`);
    const b = new Date(`${dateB}T00:00:00`);
    return Math.ceil((b-a) / 86400000);
  }

  function addMonths(dateStr, delta) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T00:00:00`);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + delta);
    const max = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    d.setDate(Math.min(day, max));
    return d.toISOString().slice(0,10);
  }

  function cancellationDeadline(contract) {
    if (contract.cancellationDeadline) return contract.cancellationDeadline;
    if (!contract.endDate) return '';
    const months = Number(contract.noticeMonths || 0);
    return addMonths(contract.endDate, -months);
  }

  function contractStatusBadge(status) {
    const map = {
      active:['Aktiv','active'],
      planned:['Kündigung vorgesehen','pending'],
      cancelled:['Gekündigt','cancelled'],
      ended:['Beendet','ended']
    };
    const [label, cls] = map[status] || [status || 'Unbekannt','info'];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  async function audit(action, entityType, entityId, details='') {
    const u = currentUser();
    await storage.put('audit', {
      id: uid('aud'), action, entityType, entityId, details,
      userId: u?.id || null, userName: u?.name || 'System', createdAt: new Date().toISOString()
    });
  }

  async function seedIfEmpty() {
    const users = await storage.getAll('users');
    if (users.length) return;

    const admin = {id:'usr_admin', name:'Sven Odrich', role:'admin', email:'', active:true};
    const editor = {id:'usr_editor', name:'Max Mustermann', role:'editor', email:'', active:true};
    const viewer = {id:'usr_viewer', name:'Anna Beispiel', role:'viewer', email:'', active:true};
    for (const u of [admin, editor, viewer]) await storage.put('users', u);

    const cats = [
      ['cat_software','Software / IT'], ['cat_vehicles','Fahrzeuge / Leasing'], ['cat_insurance','Versicherungen'],
      ['cat_service','Wartung / Service'], ['cat_personnel','Personal / Recruiting'], ['cat_energy','Energie'], ['cat_other','Sonstige']
    ].map(([id,name]) => ({id,name,active:true}));
    for (const c of cats) await storage.put('categories', c);

    const p1 = {id:'prov_brz', name:'BRZ Deutschland GmbH', customerNo:'', street:'', zip:'', city:'', website:'', contactName:'', contactEmail:'', contactPhone:'', importantNote:'LohnMobil und Lohnabrechnung getrennt verwalten.', createdAt:new Date().toISOString()};
    const p2 = {id:'prov_assentio', name:'Assentio', customerNo:'', street:'', zip:'', city:'', website:'', contactName:'Herr Hopf', contactEmail:'', contactPhone:'', importantNote:'', createdAt:new Date().toISOString()};
    await storage.put('providers', p1); await storage.put('providers', p2);

    const c1 = {
      id:'ctr_brz_lohnmobil', providerId:p1.id, name:'BRZ LohnMobil', contractNo:'', categoryId:'cat_software', company:'OBG',
      startDate:'2024-03-01', endDate:'2027-02-28', noticeMonths:1, cancellationDeadline:'', reminderDays:90,
      autoRenew:false, renewalMonths:0, costAmount:0, costPeriod:'monthly', ownerId:admin.id,
      status:'active', importantNote:'Gewünschtes Vertragsende 28.02.2027 prüfen.', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
    };
    const c2 = {
      id:'ctr_assentio', providerId:p2.id, name:'Assentio Rahmenvertrag', contractNo:'', categoryId:'cat_personnel', company:'OBG',
      startDate:'2026-09-01', endDate:'2029-08-31', noticeMonths:3, cancellationDeadline:'', reminderDays:90,
      autoRenew:false, renewalMonths:0, costAmount:0, costPeriod:'oneoff', ownerId:admin.id,
      status:'active', importantNote:'55 Kontingente, Restkontingente auch nach Laufzeit nutzbar.', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
    };
    await storage.put('contracts', c1); await storage.put('contracts', c2);

    await storage.put('notes', {id:'note_seed', contractId:c1.id, providerId:p1.id, text:'Beispielnotiz: Kündigungsmodalitäten und gewünschten Beendigungstermin mit BRZ abstimmen.', userId:admin.id, userName:admin.name, createdAt:new Date().toISOString()});
  }

  function renderUserSelect() {
    const select = $('#currentUserSelect');
    if (!select) return;
    select.innerHTML = state.data.users.filter(u => u.active !== false).map(u => `<option value="${u.id}">${escapeHtml(u.name)} · ${roleLabel(u.role)}</option>`).join('');
    select.value = state.userId || '';
  }

  function roleLabel(role) { return ({admin:'Admin', editor:'Bearbeiter', viewer:'Leser'})[role] || role; }

  function setView(view) {
    state.view = view;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const [title, sub] = viewMeta[view];
    $('#viewTitle').textContent = title;
    $('#viewSubtitle').textContent = sub;
    render();
    $('#sidebar').classList.remove('open');
  }

  function render() {
    const target = $('#content');
    const renderers = {dashboard:renderDashboard, providers:renderProviders, contracts:renderContracts, cancellations:renderCancellations, categories:renderCategories, users:renderUsers, settings:renderSettings};
    target.innerHTML = renderers[state.view]();
    bindViewEvents();
  }

  function renderDashboard() {
    const today = todayISO();
    const active = state.data.contracts.filter(c => c.status === 'active');
    const alerts = active.map(c => {
      const deadline = cancellationDeadline(c);
      const days = deadline ? daysBetween(today, deadline) : null;
      return {c, deadline, days};
    }).filter(x => x.days !== null && x.days <= Number(x.c.reminderDays || 90)).sort((a,b) => a.days-b.days);
    const openCancels = state.data.cancellations.filter(c => c.status !== 'confirmed').length;

    const last10 = [...state.data.cancellations].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,10);

    return `
      <div class="grid grid-4">
        <div class="card metric"><div class="metric-label">Dienstleister</div><div class="metric-value">${state.data.providers.length}</div><div class="metric-sub">angelegte Anbieter</div></div>
        <div class="card metric ok"><div class="metric-label">Aktive Verträge</div><div class="metric-value">${active.length}</div><div class="metric-sub">laufende Verträge</div></div>
        <div class="card metric ${alerts.length ? 'warn' : ''}"><div class="metric-label">Fristen / Warnungen</div><div class="metric-value">${alerts.length}</div><div class="metric-sub">innerhalb Erinnerungsvorlauf</div></div>
        <div class="card metric ${openCancels ? 'danger' : ''}"><div class="metric-label">Offene Kündigungen</div><div class="metric-value">${openCancels}</div><div class="metric-sub">noch nicht bestätigt</div></div>
      </div>

      <div class="grid grid-2" style="margin-top:16px;align-items:start;">
        <div class="card card-pad">
          <div class="section-head"><h2 class="section-title">Fristen & Erinnerungen</h2><div class="actions"><button class="secondary-btn" data-go="contracts">Alle Verträge</button></div></div>
          ${alerts.length ? `<div class="alert-list">${alerts.slice(0,8).map(x => `
            <div class="alert-item">
              <div class="alert-dot ${x.days < 0 ? 'danger' : ''}"></div>
              <div>
                <div class="alert-title">${escapeHtml(x.c.name)}</div>
                <div class="alert-meta">${escapeHtml(providerName(x.c.providerId))} · Kündigungsfrist ${fmtDate(x.deadline)}</div>
              </div>
              <div class="alert-actions">
                <strong>${x.days < 0 ? `${Math.abs(x.days)} Tage überfällig` : `${x.days} Tage`}</strong>
                ${emailReminderEnabled(x.c) ? `<span class="badge mail">✉ ${escapeHtml(notificationRecipient(x.c) || 'Empfänger fehlt')}</span>` : ''}
                ${emailReminderEnabled(x.c) && notificationRecipient(x.c) ? `<button class="secondary-btn outlook-draft" data-id="${x.c.id}">Mail testen</button>` : ''}
              </div>
            </div>`).join('')}</div>` : `<div class="empty">Aktuell keine Fristen im Erinnerungsvorlauf.</div>`}
        </div>

        <div class="card card-pad">
          <div class="section-head"><h2 class="section-title">Letzte 10 Kündigungen</h2><div class="actions"><button class="secondary-btn" data-go="cancellations">Alle</button></div></div>
          ${last10.length ? `<div class="timeline">${last10.map(c => `
            <div class="timeline-item">
              <div class="timeline-date">${fmtDateTime(c.createdAt)}</div>
              <div class="timeline-main"><strong>${escapeHtml(state.data.contracts.find(x=>x.id===c.contractId)?.name || 'Vertrag')}</strong>${escapeHtml(userName(c.userId))} · ${escapeHtml(c.method || 'Kündigung')} · ${c.requestedEndDate ? `gewünscht ${fmtDate(c.requestedEndDate)}` : ''}</div>
            </div>`).join('')}</div>` : `<div class="empty">Noch keine Kündigungen hinterlegt.</div>`}
        </div>
      </div>`;
  }

  function renderProviders() {
    const q = state.filters.providerSearch.toLowerCase();
    const rows = state.data.providers.filter(p => !q || [p.name,p.customerNo,p.city,p.contactName].join(' ').toLowerCase().includes(q));
    return `
      <div class="toolbar">
        <input class="grow" id="providerSearch" placeholder="Dienstleister suchen …" value="${escapeHtml(state.filters.providerSearch)}" />
        <button class="primary-btn" id="addProviderBtn" ${canEdit()?'':'disabled'}>+ Dienstleister</button>
      </div>
      ${rows.length ? `<div class="provider-grid">${rows.sort((a,b)=>a.name.localeCompare(b.name,'de')).map(p => {
        const contracts = state.data.contracts.filter(c=>c.providerId===p.id);
        const open = contracts.filter(c=>c.status==='active').length;
        const cancels = state.data.cancellations.filter(c=>contracts.some(x=>x.id===c.contractId) && c.status!=='confirmed').length;
        return `<div class="card provider-card" data-provider-id="${p.id}">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="provider-stats"><span>${open} aktive Verträge</span><span>${cancels} offene Kündigungen</span></div>
          ${p.importantNote ? `<div class="note">${escapeHtml(p.importantNote)}</div>` : ''}
        </div>`;
      }).join('')}</div>` : `<div class="empty">Keine Dienstleister gefunden.</div>`}`;
  }

  function renderContracts() {
    let rows = [...state.data.contracts];
    const q = state.filters.contractSearch.toLowerCase();
    if (q) rows = rows.filter(c => [c.name,c.contractNo,c.company,providerName(c.providerId),categoryName(c.categoryId)].join(' ').toLowerCase().includes(q));
    if (state.filters.category) rows = rows.filter(c=>c.categoryId===state.filters.category);
    if (state.filters.company) rows = rows.filter(c=>c.company===state.filters.company);
    if (state.filters.status) rows = rows.filter(c=>c.status===state.filters.status);
    rows.sort((a,b)=>a.name.localeCompare(b.name,'de'));
    const companies = [...new Set(state.data.contracts.map(c=>c.company).filter(Boolean))].sort();

    return `
      <div class="toolbar">
        <input class="grow" id="contractSearch" placeholder="Vertrag, Dienstleister, Nummer …" value="${escapeHtml(state.filters.contractSearch)}" />
        <select id="categoryFilter" style="max-width:190px"><option value="">Alle Kategorien</option>${state.data.categories.map(c=>`<option value="${c.id}" ${state.filters.category===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select>
        <select id="companyFilter" style="max-width:150px"><option value="">Alle Firmen</option>${companies.map(x=>`<option ${state.filters.company===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select>
        <select id="statusFilter" style="max-width:180px"><option value="">Alle Status</option><option value="active" ${state.filters.status==='active'?'selected':''}>Aktiv</option><option value="planned" ${state.filters.status==='planned'?'selected':''}>Kündigung vorgesehen</option><option value="cancelled" ${state.filters.status==='cancelled'?'selected':''}>Gekündigt</option><option value="ended" ${state.filters.status==='ended'?'selected':''}>Beendet</option></select>
        <button class="primary-btn" id="addContractBtn" ${canEdit()?'':'disabled'}>+ Vertrag</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Vertrag</th><th>Dienstleister</th><th>Kategorie</th><th>Firma</th><th>Ende</th><th>Kündigen bis</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map(c => `<tr class="clickable" data-contract-id="${c.id}">
          <td><strong>${escapeHtml(c.name)}</strong><div class="muted">${escapeHtml(c.contractNo || '')}</div></td>
          <td>${escapeHtml(providerName(c.providerId))}</td><td>${escapeHtml(categoryName(c.categoryId))}</td><td>${escapeHtml(c.company || '—')}</td>
          <td>${fmtDate(c.endDate)}</td><td>${fmtDate(cancellationDeadline(c))}</td><td>${contractStatusBadge(c.status)}</td>
          <td class="right"><button class="secondary-btn open-contract" data-id="${c.id}">Öffnen</button></td>
        </tr>`).join('') : `<tr><td colspan="8"><div class="empty">Keine Verträge gefunden.</div></td></tr>`}</tbody>
      </table></div>`;
  }

  function renderCancellations() {
    const list = [...state.data.cancellations].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    return `
      <div class="card card-pad">
        <div class="section-head"><h2 class="section-title">Kündigungshistorie</h2></div>
        ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Vertrag</th><th>Dienstleister</th><th>durch</th><th>Art</th><th>gewünschtes Ende</th><th>Status</th></tr></thead><tbody>
          ${list.map(c => { const ctr = state.data.contracts.find(x=>x.id===c.contractId); return `<tr class="clickable" data-contract-id="${ctr?.id || ''}"><td>${fmtDate(c.cancelledOn)}</td><td><strong>${escapeHtml(ctr?.name || '—')}</strong></td><td>${escapeHtml(providerName(ctr?.providerId))}</td><td>${escapeHtml(userName(c.userId))}</td><td>${escapeHtml(c.method || '—')}</td><td>${fmtDate(c.requestedEndDate)}</td><td>${c.status==='confirmed'?'<span class="badge active">Bestätigt</span>':'<span class="badge pending">Offen</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>` : `<div class="empty">Noch keine Kündigungen hinterlegt.</div>`}
      </div>`;
  }

  function renderCategories() {
    const rows = [...state.data.categories].sort((a,b)=>a.name.localeCompare(b.name,'de'));
    return `
      <div class="card card-pad">
        <div class="section-head"><h2 class="section-title">Kategorien</h2><div class="actions"><button class="primary-btn" id="addCategoryBtn" ${isAdmin()?'':'disabled'}>+ Kategorie</button></div></div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Verträge</th><th>Status</th><th></th></tr></thead><tbody>
          ${rows.map(c=>`<tr><td><strong>${escapeHtml(c.name)}</strong></td><td>${state.data.contracts.filter(x=>x.categoryId===c.id).length}</td><td>${c.active!==false?'<span class="badge active">Aktiv</span>':'<span class="badge ended">Inaktiv</span>'}</td><td class="right"><button class="secondary-btn edit-category" data-id="${c.id}" ${isAdmin()?'':'disabled'}>Bearbeiten</button></td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
  }

  function renderUsers() {
    const rows = [...state.data.users].sort((a,b)=>a.name.localeCompare(b.name,'de'));
    return `
      <div class="notice info">Diese Benutzerverwaltung steuert in Version 2 weiterhin nur die lokale App. Die echte Anmeldung und zentrale Rechteverwaltung wird später an Dashwise angebunden.</div>
      <div class="card card-pad">
        <div class="section-head"><h2 class="section-title">Benutzer</h2><div class="actions"><button class="primary-btn" id="addUserBtn" ${isAdmin()?'':'disabled'}>+ Benutzer</button></div></div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Rolle</th><th>E-Mail</th><th>Status</th><th></th></tr></thead><tbody>
          ${rows.map(u=>`<tr><td><strong>${escapeHtml(u.name)}</strong></td><td>${roleLabel(u.role)}</td><td>${escapeHtml(u.email || '—')}</td><td>${u.active!==false?'<span class="badge active">Aktiv</span>':'<span class="badge ended">Inaktiv</span>'}</td><td class="right"><button class="secondary-btn edit-user" data-id="${u.id}" ${isAdmin()?'':'disabled'}>Bearbeiten</button></td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
  }

  function renderSettings() {
    const mailEnabled = state.data.contracts.filter(emailReminderEnabled);
    const mailReady = mailEnabled.filter(c => notificationRecipient(c));
    return `
      <div class="grid grid-2" style="align-items:start;">
        <div class="card card-pad">
          <div class="section-head"><h2 class="section-title">Outlook & Erinnerungen</h2></div>
          <div class="grid grid-2" style="margin-bottom:14px">
            <div class="detail-item"><div class="k">Mail-Erinnerungen aktiv</div><div class="v">${mailEnabled.length}</div></div>
            <div class="detail-item"><div class="k">Versandbereit</div><div class="v">${mailReady.length}</div></div>
          </div>
          <div class="notice info"><strong>Aktueller lokaler Modus:</strong> Die App berechnet die Fristen bereits und kann eine fertige Outlook-/Mail-Nachricht öffnen. Ein automatischer Versand im Hintergrund ist auf einer reinen GitHub-Pages-Seite nicht zuverlässig möglich.</div>
          <div class="notice success"><strong>Dashwise-Ziel:</strong> Später ruft ein täglicher Serverjob die fälligen Verträge ab und versendet die gleiche Erinnerung automatisch an die hinterlegte Outlook-Adresse – auch wenn niemand die App geöffnet hat.</div>
          <p class="muted">Empfänger: zuerst die im Vertrag hinterlegte Erinnerungsadresse; wenn diese leer ist, wird die E-Mail des Verantwortlichen verwendet.</p>
        </div>
        <div class="card card-pad">
          <div class="section-head"><h2 class="section-title">Datensicherung</h2></div>
          <p class="muted">Exportiert Stammdaten, Verträge, Notizen, Kündigungen und Verlauf als JSON. Dokumente bleiben derzeit separat im lokalen Browser gespeichert.</p>
          <div class="toolbar"><button class="primary-btn" id="exportBtn">JSON exportieren</button><label class="secondary-btn" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer"><input id="importFile" type="file" accept="application/json" style="display:none">JSON importieren</label></div>
        </div>
        <div class="card card-pad">
          <div class="section-head"><h2 class="section-title">Dashwise-Vorbereitung</h2></div>
          <ul class="muted" style="font-size:12px;line-height:1.9;margin:0;padding-left:18px">
            <li>keine Firebase-Abhängigkeit</li><li>lokale Dokumentablage in IndexedDB</li><li>Mail-Regeln bereits pro Vertrag gespeichert</li><li>IDs und Beziehungen cloud-tauglich</li><li>Benutzer, Rollen und Audit-Verlauf vorbereitet</li>
          </ul>
        </div>
      </div>`;
  }

  function bindViewEvents() {
    $$('[data-go]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.go)));
    $('#providerSearch')?.addEventListener('input', e=>{state.filters.providerSearch=e.target.value; render();});
    $('#contractSearch')?.addEventListener('input', e=>{state.filters.contractSearch=e.target.value; render();});
    $('#categoryFilter')?.addEventListener('change', e=>{state.filters.category=e.target.value; render();});
    $('#companyFilter')?.addEventListener('change', e=>{state.filters.company=e.target.value; render();});
    $('#statusFilter')?.addEventListener('change', e=>{state.filters.status=e.target.value; render();});

    $('#addProviderBtn')?.addEventListener('click',()=>openProviderModal());
    $('#addContractBtn')?.addEventListener('click',()=>openContractModal());
    $$('.provider-card').forEach(x=>x.addEventListener('click',()=>openProviderDetail(x.dataset.providerId)));
    $$('.open-contract').forEach(x=>x.addEventListener('click',e=>{e.stopPropagation();openContractDetail(x.dataset.id);}));
    $$('tr[data-contract-id]').forEach(x=>x.addEventListener('click',()=>{if(x.dataset.contractId) openContractDetail(x.dataset.contractId);}));
    $('#addCategoryBtn')?.addEventListener('click',()=>openCategoryModal());
    $$('.edit-category').forEach(x=>x.addEventListener('click',()=>openCategoryModal(x.dataset.id)));
    $('#addUserBtn')?.addEventListener('click',()=>openUserModal());
    $$('.edit-user').forEach(x=>x.addEventListener('click',()=>openUserModal(x.dataset.id)));
    $('#exportBtn')?.addEventListener('click', exportJson);
    $('#importFile')?.addEventListener('change', importJson);
    $$('.outlook-draft').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); const c=state.data.contracts.find(x=>x.id===b.dataset.id); if(c) openOutlookDraft(c); }));
  }

  function showModal(html, small=false) {
    const back = $('#modalBackdrop');
    back.innerHTML = `<div class="modal ${small?'small':''}">${html}</div>`;
    back.classList.remove('hidden');
    back.addEventListener('mousedown', ev => { if (ev.target === back) closeModal(); }, {once:true});
    $$('.close-modal', back).forEach(b=>b.addEventListener('click', closeModal));
  }
  function closeModal(){ $('#modalBackdrop').classList.add('hidden'); $('#modalBackdrop').innerHTML=''; }
  function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }

  function providerOptions(selected='') { return state.data.providers.sort((a,b)=>a.name.localeCompare(b.name,'de')).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${escapeHtml(p.name)}</option>`).join(''); }
  function categoryOptions(selected='') { return state.data.categories.filter(c=>c.active!==false).sort((a,b)=>a.name.localeCompare(b.name,'de')).map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${escapeHtml(c.name)}</option>`).join(''); }
  function userOptions(selected='') { return state.data.users.filter(u=>u.active!==false).map(u=>`<option value="${u.id}" ${u.id===selected?'selected':''}>${escapeHtml(u.name)}</option>`).join(''); }

  function openProviderModal(id=null) {
    const p = id ? state.data.providers.find(x=>x.id===id) : null;
    showModal(`
      <div class="modal-head"><h2>${p?'Dienstleister bearbeiten':'Dienstleister anlegen'}</h2><button class="icon-btn close close-modal">✕</button></div>
      <form id="providerForm"><div class="modal-body"><div class="form-grid">
        <label class="full"><span>Firmenname *</span><input name="name" required value="${escapeHtml(p?.name||'')}"></label>
        <label><span>Kundennummer</span><input name="customerNo" value="${escapeHtml(p?.customerNo||'')}"></label>
        <label><span>Website</span><input name="website" value="${escapeHtml(p?.website||'')}"></label>
        <label class="full"><span>Straße</span><input name="street" value="${escapeHtml(p?.street||'')}"></label>
        <label><span>PLZ</span><input name="zip" value="${escapeHtml(p?.zip||'')}"></label>
        <label><span>Ort</span><input name="city" value="${escapeHtml(p?.city||'')}"></label>
        <label><span>Ansprechpartner</span><input name="contactName" value="${escapeHtml(p?.contactName||'')}"></label>
        <label><span>E-Mail</span><input type="email" name="contactEmail" value="${escapeHtml(p?.contactEmail||'')}"></label>
        <label><span>Telefon</span><input name="contactPhone" value="${escapeHtml(p?.contactPhone||'')}"></label>
        <label class="full"><span>Wichtige interne Notiz</span><textarea name="importantNote">${escapeHtml(p?.importantNote||'')}</textarea></label>
      </div></div><div class="modal-foot"><button type="button" class="secondary-btn close-modal">Abbrechen</button><button class="primary-btn">Speichern</button></div></form>`);
    $('#providerForm').addEventListener('submit', async e=>{
      e.preventDefault(); const fd=new FormData(e.target); const rec={...(p||{}), id:p?.id||uid('prov'), createdAt:p?.createdAt||new Date().toISOString(), updatedAt:new Date().toISOString()};
      for (const [k,v] of fd.entries()) rec[k]=String(v).trim();
      await storage.put('providers', rec); await audit(p?'Dienstleister geändert':'Dienstleister angelegt','provider',rec.id,rec.name); await reload(); closeModal(); render(); toast('Dienstleister gespeichert');
    });
  }

  function openContractModal(id=null, presetProviderId='') {
    const c = id ? state.data.contracts.find(x=>x.id===id) : null;
    showModal(`
      <div class="modal-head"><h2>${c?'Vertrag bearbeiten':'Vertrag anlegen'}</h2><button class="icon-btn close close-modal">✕</button></div>
      <form id="contractForm"><div class="modal-body"><div class="form-grid">
        <label class="full"><span>Vertragsbezeichnung *</span><input name="name" required value="${escapeHtml(c?.name||'')}"></label>
        <label><span>Dienstleister *</span><select name="providerId" required><option value="">Bitte wählen</option>${providerOptions(c?.providerId||presetProviderId)}</select></label>
        <label><span>Kategorie *</span><select name="categoryId" required><option value="">Bitte wählen</option>${categoryOptions(c?.categoryId||'')}</select></label>
        <label><span>Gesellschaft / Firma</span><input name="company" placeholder="z. B. OBG" value="${escapeHtml(c?.company||'')}"></label>
        <label><span>Vertragsnummer</span><input name="contractNo" value="${escapeHtml(c?.contractNo||'')}"></label>
        <label><span>Vertragsbeginn</span><input type="date" name="startDate" value="${c?.startDate||''}"></label>
        <label><span>Vertragsende</span><input type="date" name="endDate" value="${c?.endDate||''}"></label>
        <label><span>Kündigungsfrist (Monate)</span><input type="number" min="0" name="noticeMonths" value="${c?.noticeMonths ?? 3}"></label>
        <label><span>Abweichendes Kündigungsdatum</span><input type="date" name="cancellationDeadline" value="${c?.cancellationDeadline||''}"></label>
        <label><span>Erinnerung (Tage vor Kündigungsfrist)</span><input type="number" min="0" name="reminderDays" value="${c?.reminderDays ?? 90}"></label>
        <label><span>Verantwortlicher</span><select name="ownerId"><option value="">—</option>${userOptions(c?.ownerId||state.userId)}</select></label>
        <label><span>Mail-Erinnerung</span><select name="emailReminder"><option value="true" ${emailReminderEnabled(c)?'selected':''}>Aktiv</option><option value="false" ${!emailReminderEnabled(c)?'selected':''}>Aus</option></select></label>
        <label><span>Mail-Empfänger</span><input type="email" name="notificationEmail" placeholder="leer = E-Mail des Verantwortlichen" value="${escapeHtml(c?.notificationEmail||'')}"></label>
        <label><span>Status</span><select name="status"><option value="active" ${c?.status==='active'||!c?'selected':''}>Aktiv</option><option value="planned" ${c?.status==='planned'?'selected':''}>Kündigung vorgesehen</option><option value="cancelled" ${c?.status==='cancelled'?'selected':''}>Gekündigt</option><option value="ended" ${c?.status==='ended'?'selected':''}>Beendet</option></select></label>
        <label><span>Kosten</span><input type="number" step="0.01" min="0" name="costAmount" value="${c?.costAmount ?? 0}"></label>
        <label><span>Kostenintervall</span><select name="costPeriod"><option value="monthly" ${c?.costPeriod==='monthly'?'selected':''}>monatlich</option><option value="yearly" ${c?.costPeriod==='yearly'?'selected':''}>jährlich</option><option value="oneoff" ${c?.costPeriod==='oneoff'?'selected':''}>einmalig</option></select></label>
        <label><span>Automatische Verlängerung</span><select name="autoRenew"><option value="false" ${!c?.autoRenew?'selected':''}>Nein</option><option value="true" ${c?.autoRenew?'selected':''}>Ja</option></select></label>
        <label><span>Verlängerung um Monate</span><input type="number" min="0" name="renewalMonths" value="${c?.renewalMonths ?? 0}"></label>
        <label class="full"><span>Wichtige interne Notiz</span><textarea name="importantNote">${escapeHtml(c?.importantNote||'')}</textarea></label>
      </div></div><div class="modal-foot"><button type="button" class="secondary-btn close-modal">Abbrechen</button><button class="primary-btn">Speichern</button></div></form>`);
    $('#contractForm').addEventListener('submit', async e=>{
      e.preventDefault(); const fd=new FormData(e.target); const rec={...(c||{}), id:c?.id||uid('ctr'), createdAt:c?.createdAt||new Date().toISOString(), updatedAt:new Date().toISOString()};
      for (const [k,v] of fd.entries()) rec[k]=String(v).trim();
      rec.noticeMonths=Number(rec.noticeMonths||0); rec.reminderDays=Number(rec.reminderDays||0); rec.costAmount=Number(rec.costAmount||0); rec.renewalMonths=Number(rec.renewalMonths||0); rec.autoRenew=rec.autoRenew==='true'; rec.emailReminder=rec.emailReminder==='true';
      await storage.put('contracts', rec); await audit(c?'Vertrag geändert':'Vertrag angelegt','contract',rec.id,rec.name); await reload(); closeModal(); render(); toast('Vertrag gespeichert');
    });
  }

  function openProviderDetail(id) {
    const p=state.data.providers.find(x=>x.id===id); if(!p) return;
    const contracts=state.data.contracts.filter(c=>c.providerId===id).sort((a,b)=>a.name.localeCompare(b.name,'de'));
    const notes=state.data.notes.filter(n=>n.providerId===id && !n.contractId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    showModal(`
      <div class="modal-head"><div><h2>${escapeHtml(p.name)}</h2><div class="kpi-line"><span>${contracts.filter(c=>c.status==='active').length} aktive Verträge</span><span>${contracts.length} gesamt</span></div></div><button class="icon-btn close close-modal">✕</button></div>
      <div class="modal-body">
        ${p.importantNote?`<div class="notice warn"><strong>Wichtige Notiz:</strong> ${escapeHtml(p.importantNote)}</div>`:''}
        <div class="detail-grid">
          <div class="detail-item"><div class="k">Kundennummer</div><div class="v">${escapeHtml(p.customerNo||'—')}</div></div>
          <div class="detail-item"><div class="k">Ansprechpartner</div><div class="v">${escapeHtml(p.contactName||'—')}</div></div>
          <div class="detail-item"><div class="k">Kontakt</div><div class="v">${escapeHtml(p.contactEmail||p.contactPhone||'—')}</div></div>
        </div>
        <div class="hr"></div>
        <div class="section-head"><h3>Verträge</h3><div class="actions"><button id="providerAddContract" class="primary-btn" ${canEdit()?'':'disabled'}>+ Vertrag</button></div></div>
        ${contracts.length?`<div class="table-wrap"><table><thead><tr><th>Vertrag</th><th>Kategorie</th><th>Ende</th><th>Status</th></tr></thead><tbody>${contracts.map(c=>`<tr class="clickable prov-contract" data-id="${c.id}"><td><strong>${escapeHtml(c.name)}</strong></td><td>${escapeHtml(categoryName(c.categoryId))}</td><td>${fmtDate(c.endDate)}</td><td>${contractStatusBadge(c.status)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">Noch keine Verträge.</div>`}
        <div class="hr"></div>
        <div class="section-head"><h3>Dienstleister-Notizen</h3></div>
        ${notes.map(n=>`<div class="note-entry"><div class="note-meta">${escapeHtml(n.userName)} · ${fmtDateTime(n.createdAt)}</div>${escapeHtml(n.text)}</div>`).join('') || '<div class="empty">Noch keine Dienstleister-Notizen.</div>'}
        ${canEdit()?`<form id="providerNoteForm" style="margin-top:12px"><textarea name="text" placeholder="Neue Notiz …" required></textarea><div class="right" style="margin-top:8px"><button class="primary-btn">Notiz speichern</button></div></form>`:''}
      </div>
      <div class="modal-foot"><button class="secondary-btn" id="editProviderBtn" ${canEdit()?'':'disabled'}>Dienstleister bearbeiten</button><button class="secondary-btn close-modal">Schließen</button></div>`);
    $('#providerAddContract')?.addEventListener('click',()=>{closeModal(); openContractModal(null,id);});
    $$('.prov-contract').forEach(x=>x.addEventListener('click',()=>{closeModal();openContractDetail(x.dataset.id);}));
    $('#editProviderBtn')?.addEventListener('click',()=>{closeModal();openProviderModal(id);});
    $('#providerNoteForm')?.addEventListener('submit',async e=>{e.preventDefault();const text=new FormData(e.target).get('text').trim(); if(!text)return; const u=currentUser(); const n={id:uid('note'),providerId:id,contractId:null,text,userId:u.id,userName:u.name,createdAt:new Date().toISOString()}; await storage.put('notes',n); await audit('Dienstleister-Notiz hinzugefügt','provider',id,text.slice(0,80)); await reload(); closeModal(); openProviderDetail(id);});
  }

  function openContractDetail(id, tab='overview') {
    const c=state.data.contracts.find(x=>x.id===id); if(!c) return;
    const p=state.data.providers.find(x=>x.id===c.providerId);
    const notes=state.data.notes.filter(n=>n.contractId===id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const cancels=state.data.cancellations.filter(x=>x.contractId===id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const docs=state.data.documents.filter(d=>d.contractId===id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const audits=state.data.audit.filter(a=>a.entityId===id || (a.entityType==='document' && docs.some(d=>d.id===a.entityId))).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const deadline=cancellationDeadline(c);

    const tabHtml = {
      overview:`
        ${c.importantNote?`<div class="notice warn"><strong>Wichtige Notiz:</strong> ${escapeHtml(c.importantNote)}</div>`:''}
        <div class="detail-grid">
          <div class="detail-item"><div class="k">Dienstleister</div><div class="v">${escapeHtml(p?.name||'—')}</div></div>
          <div class="detail-item"><div class="k">Kategorie</div><div class="v">${escapeHtml(categoryName(c.categoryId))}</div></div>
          <div class="detail-item"><div class="k">Gesellschaft</div><div class="v">${escapeHtml(c.company||'—')}</div></div>
          <div class="detail-item"><div class="k">Vertragsbeginn</div><div class="v">${fmtDate(c.startDate)}</div></div>
          <div class="detail-item"><div class="k">Vertragsende</div><div class="v">${fmtDate(c.endDate)}</div></div>
          <div class="detail-item"><div class="k">Kündigen bis</div><div class="v">${fmtDate(deadline)}</div></div>
          <div class="detail-item"><div class="k">Erinnerung</div><div class="v">${Number(c.reminderDays||0)} Tage vorher</div></div>
          <div class="detail-item"><div class="k">Verantwortlich</div><div class="v">${escapeHtml(userName(c.ownerId))}</div></div>
          <div class="detail-item"><div class="k">Mail-Erinnerung</div><div class="v">${emailReminderEnabled(c)?'Aktiv':'Aus'}</div></div>
          <div class="detail-item"><div class="k">Mail-Empfänger</div><div class="v">${escapeHtml(notificationRecipient(c)||'Noch nicht hinterlegt')}</div></div>
          <div class="detail-item"><div class="k">Kosten</div><div class="v">${euro(c.costAmount)} · ${c.costPeriod==='monthly'?'monatlich':c.costPeriod==='yearly'?'jährlich':'einmalig'}</div></div>
        </div>
        ${emailReminderEnabled(c) ? `<div class="notice info" style="margin-top:14px"><strong>Mail-Erinnerung:</strong> ${notificationRecipient(c)?`Empfänger ${escapeHtml(notificationRecipient(c))}. <button class="secondary-btn outlook-draft" data-id="${c.id}" style="margin-left:8px">Testmail öffnen</button>`:'Bitte im Vertrag oder beim Verantwortlichen eine E-Mail-Adresse hinterlegen.'}</div>` : ''}`,
      documents:`
        <div class="notice info">Dokumente werden in der aktuellen lokalen Version im Browser gespeichert. Sie sind nicht automatisch auf anderen Geräten verfügbar.</div>
        ${docs.length?docs.map(d=>`<div class="file-row"><div class="file-info"><div class="file-name">${escapeHtml(d.name)}</div><div class="file-meta">${escapeHtml(d.docType||'Dokument')} · ${escapeHtml(d.userName||'')} · ${fmtDateTime(d.createdAt)} · ${Math.round((d.size||0)/1024)} KB</div></div><button class="secondary-btn open-doc" data-id="${d.id}">Ansehen</button>${canEdit()?`<button class="danger-btn del-doc" data-id="${d.id}">Löschen</button>`:''}</div>`).join(''):'<div class="empty">Noch keine Dokumente hinterlegt.</div>'}
        ${canEdit()?`<form id="documentForm" style="margin-top:14px"><div class="form-grid"><label><span>Dokumenttyp</span><select name="docType"><option>Vertrag</option><option>Nachtrag</option><option>Kündigungsschreiben</option><option>Kündigungsbestätigung</option><option>Korrespondenz</option><option>Sonstiges</option></select></label><label><span>Datei</span><input type="file" name="file" required></label></div><div class="right" style="margin-top:10px"><button class="primary-btn">Dokument speichern</button></div></form>`:''}`,
      notes:`
        ${notes.length?notes.map(n=>`<div class="note-entry"><div class="note-meta">${escapeHtml(n.userName)} · ${fmtDateTime(n.createdAt)}</div>${escapeHtml(n.text)}</div>`).join(''):'<div class="empty">Noch keine Notizen.</div>'}
        ${canEdit()?`<form id="contractNoteForm" style="margin-top:12px"><textarea name="text" placeholder="Neue Notiz …" required></textarea><div class="right" style="margin-top:8px"><button class="primary-btn">Notiz speichern</button></div></form>`:''}`,
      cancellation:`
        ${cancels.length?`<div class="timeline">${cancels.map(x=>`<div class="timeline-item"><div class="timeline-date">${fmtDateTime(x.createdAt)}</div><div class="timeline-main"><strong>${x.status==='confirmed'?'Kündigung bestätigt':'Kündigung hinterlegt'}</strong>${escapeHtml(userName(x.userId))} · ${escapeHtml(x.method||'—')}<br>gekündigt am ${fmtDate(x.cancelledOn)} · gewünschtes Ende ${fmtDate(x.requestedEndDate)}${x.confirmedEndDate?` · bestätigt ${fmtDate(x.confirmedEndDate)}`:''}${x.note?`<br>${escapeHtml(x.note)}`:''}</div></div>`).join('')}</div>`:'<div class="empty">Noch keine Kündigung hinterlegt.</div>'}
        ${canEdit()?`<div class="hr"></div><form id="cancelForm"><div class="form-grid"><label><span>Kündigungsdatum</span><input type="date" name="cancelledOn" value="${todayISO()}" required></label><label><span>Kündigungsart</span><select name="method"><option>E-Mail</option><option>Brief</option><option>Portal</option><option>Persönlich</option><option>Sonstiges</option></select></label><label><span>Gewünschtes Vertragsende</span><input type="date" name="requestedEndDate" value="${c.endDate||''}"></label><label><span>Status</span><select name="status"><option value="sent">Versendet / offen</option><option value="confirmed">Bestätigt</option></select></label><label><span>Bestätigtes Vertragsende</span><input type="date" name="confirmedEndDate"></label><label><span>Kündigungsschreiben (optional)</span><input type="file" name="cancelFile" accept="application/pdf,image/*,.doc,.docx"></label><label class="full"><span>Bemerkung</span><textarea name="note"></textarea></label></div><div class="right" style="margin-top:10px"><button class="primary-btn">Kündigung hinterlegen</button></div></form>`:''}`,
      history:`${audits.length?`<div class="timeline">${audits.map(a=>`<div class="timeline-item"><div class="timeline-date">${fmtDateTime(a.createdAt)}</div><div class="timeline-main"><strong>${escapeHtml(a.action)}</strong>${escapeHtml(a.userName||'System')}${a.details?` · ${escapeHtml(a.details)}`:''}</div></div>`).join('')}</div>`:'<div class="empty">Noch kein Verlauf vorhanden.</div>'}`
    };

    showModal(`
      <div class="modal-head"><div><h2>${escapeHtml(c.name)}</h2><div class="kpi-line"><span>${contractStatusBadge(c.status)}</span><span>${escapeHtml(p?.name||'')}</span><span>${escapeHtml(c.company||'')}</span></div></div><button class="icon-btn close close-modal">✕</button></div>
      <div class="modal-body">
        <div class="tabs">${[['overview','Übersicht'],['documents','Dokumente'],['notes','Notizen'],['cancellation','Kündigung'],['history','Verlauf']].map(([k,l])=>`<button class="tab-btn ${tab===k?'active':''}" data-tab="${k}">${l}</button>`).join('')}</div>
        <div>${tabHtml[tab]}</div>
      </div>
      <div class="modal-foot"><button class="secondary-btn" id="editContractBtn" ${canEdit()?'':'disabled'}>Vertrag bearbeiten</button><button class="secondary-btn close-modal">Schließen</button></div>`);

    $$('.tab-btn').forEach(b=>b.addEventListener('click',()=>{closeModal();openContractDetail(id,b.dataset.tab);}));
    $('#editContractBtn')?.addEventListener('click',()=>{closeModal();openContractModal(id);});
    $$('.outlook-draft').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); openOutlookDraft(c); }));
    $('#contractNoteForm')?.addEventListener('submit',async e=>{e.preventDefault();const text=new FormData(e.target).get('text').trim();if(!text)return;const u=currentUser();await storage.put('notes',{id:uid('note'),contractId:id,providerId:c.providerId,text,userId:u.id,userName:u.name,createdAt:new Date().toISOString()});await audit('Notiz hinzugefügt','contract',id,text.slice(0,80));await reload();closeModal();openContractDetail(id,'notes');});
    $('#cancelForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const u=currentUser();const cancelFile=fd.get('cancelFile');const rec={id:uid('can'),contractId:id,userId:u.id,createdAt:new Date().toISOString()};for(const[k,v]of fd.entries()){if(k==='cancelFile')continue;rec[k]=String(v).trim();}await storage.put('cancellations',rec);if(cancelFile instanceof File && cancelFile.size){const doc={id:uid('doc'),contractId:id,providerId:c.providerId,cancellationId:rec.id,name:cancelFile.name,type:cancelFile.type,size:cancelFile.size,docType:'Kündigungsschreiben',blob:cancelFile,userId:u.id,userName:u.name,createdAt:new Date().toISOString()};await storage.put('documents',doc);await audit('Kündigungsschreiben hinterlegt','contract',id,doc.name);}const updated={...c,status:rec.status==='confirmed'?'cancelled':'planned',updatedAt:new Date().toISOString()};await storage.put('contracts',updated);await audit('Kündigung hinterlegt','contract',id,`${rec.method} · ${rec.cancelledOn}`);await reload();closeModal();openContractDetail(id,'cancellation');toast('Kündigung gespeichert');});
    $('#documentForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const file=fd.get('file');if(!(file instanceof File)||!file.size)return;const u=currentUser();const rec={id:uid('doc'),contractId:id,providerId:c.providerId,name:file.name,type:file.type,size:file.size,docType:String(fd.get('docType')),blob:file,userId:u.id,userName:u.name,createdAt:new Date().toISOString()};await storage.put('documents',rec);await audit('Dokument hinterlegt','contract',id,`${rec.docType}: ${rec.name}`);await reload();closeModal();openContractDetail(id,'documents');toast('Dokument lokal gespeichert');});
    $$('.open-doc').forEach(b=>b.addEventListener('click',async()=>{const d=await storage.get('documents',b.dataset.id);if(!d?.blob)return;const url=URL.createObjectURL(d.blob);window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);}));
    $$('.del-doc').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Dokument wirklich löschen?'))return;await storage.del('documents',b.dataset.id);await audit('Dokument gelöscht','contract',id,b.dataset.id);await reload();closeModal();openContractDetail(id,'documents');}));
  }

  function openCategoryModal(id=null){
    const c=id?state.data.categories.find(x=>x.id===id):null;
    showModal(`<div class="modal-head"><h2>${c?'Kategorie bearbeiten':'Kategorie anlegen'}</h2><button class="icon-btn close close-modal">✕</button></div><form id="catForm"><div class="modal-body"><div class="form-grid"><label class="full"><span>Name</span><input name="name" required value="${escapeHtml(c?.name||'')}"></label><label><span>Status</span><select name="active"><option value="true" ${c?.active!==false?'selected':''}>Aktiv</option><option value="false" ${c?.active===false?'selected':''}>Inaktiv</option></select></label></div></div><div class="modal-foot"><button type="button" class="secondary-btn close-modal">Abbrechen</button><button class="primary-btn">Speichern</button></div></form>`,true);
    $('#catForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const rec={...(c||{}),id:c?.id||uid('cat'),name:String(fd.get('name')).trim(),active:fd.get('active')==='true'};await storage.put('categories',rec);await audit(c?'Kategorie geändert':'Kategorie angelegt','category',rec.id,rec.name);await reload();closeModal();render();});
  }

  function openUserModal(id=null){
    const u=id?state.data.users.find(x=>x.id===id):null;
    showModal(`<div class="modal-head"><h2>${u?'Benutzer bearbeiten':'Benutzer anlegen'}</h2><button class="icon-btn close close-modal">✕</button></div><form id="userForm"><div class="modal-body"><div class="form-grid"><label class="full"><span>Name</span><input name="name" required value="${escapeHtml(u?.name||'')}"></label><label><span>E-Mail</span><input type="email" name="email" value="${escapeHtml(u?.email||'')}"></label><label><span>Rolle</span><select name="role"><option value="admin" ${u?.role==='admin'?'selected':''}>Admin</option><option value="editor" ${u?.role==='editor'||!u?'selected':''}>Bearbeiter</option><option value="viewer" ${u?.role==='viewer'?'selected':''}>Leser</option></select></label><label><span>Status</span><select name="active"><option value="true" ${u?.active!==false?'selected':''}>Aktiv</option><option value="false" ${u?.active===false?'selected':''}>Inaktiv</option></select></label></div></div><div class="modal-foot"><button type="button" class="secondary-btn close-modal">Abbrechen</button><button class="primary-btn">Speichern</button></div></form>`,true);
    $('#userForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const rec={...(u||{}),id:u?.id||uid('usr'),name:String(fd.get('name')).trim(),email:String(fd.get('email')).trim(),role:String(fd.get('role')),active:fd.get('active')==='true'};await storage.put('users',rec);await audit(u?'Benutzer geändert':'Benutzer angelegt','user',rec.id,rec.name);await reload();closeModal();render();});
  }

  async function exportJson(){
    const payload={version:2,exportedAt:new Date().toISOString(),data:{}};
    for(const s of STORES.filter(s=>s!=='documents')) payload.data[s]=await storage.getAll(s);
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`vertragsmanager-backup-${todayISO()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  async function importJson(e){
    const file=e.target.files?.[0]; if(!file)return;
    try{const payload=JSON.parse(await file.text());if(!payload?.data)throw new Error('Ungültiges Format');if(!confirm('Import überschreibt die lokalen Stammdaten (Dokumente bleiben erhalten). Fortfahren?'))return;for(const s of STORES.filter(s=>s!=='documents')){await storage.clear(s);for(const rec of payload.data[s]||[])await storage.put(s,rec);}await reload();render();toast('Import abgeschlossen');}catch(err){alert(`Import fehlgeschlagen: ${err.message}`);}finally{e.target.value='';}
  }

  async function boot(){
    await storage.init();
    await seedIfEmpty();
    await reload();

    $$('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
    $('#currentUserSelect').addEventListener('change',e=>{state.userId=e.target.value;render();});
    $('#quickAddContractBtn').addEventListener('click',()=>{if(canEdit())openContractModal();else toast('Dieser Benutzer hat nur Leserechte.');});
    $('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
    render();
  }

  boot().catch(err=>{
    console.error(err);
    $('#content').innerHTML=`<div class="notice warn"><strong>Startfehler:</strong> ${escapeHtml(err.message)}<br>Bitte Browserdaten prüfen oder die Seite neu laden.</div>`;
  });
})();
