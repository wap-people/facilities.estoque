(function () {
  const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const CAT_ORDER = ['Alimento', 'Higiene', 'Limpeza'];
  const CAT_CLASS = { Alimento: 'alimento', Higiene: 'higiene', Limpeza: 'limpeza' };
  const UNITS = [
    { id: 'SM', label: 'WAP UN. SM' },
    { id: 'AFP', label: 'WAP UN. AFP' },
    { id: 'SERRA', label: 'WAP UN. SERRA' },
    { id: 'LINHARES', label: 'WAP UN. LINHARES' },
    { id: 'EUSEBIO', label: 'WAP UN. EUSÉBIO' },
  ];
  const DEFAULT_UNIT = UNITS[0].id;
  const CFG = window.APP_CONFIG || {};

  const state = {
    sb: null,
    user: null,        // supabase auth user
    myName: '',
    started: false,
    unit: loadUnit(),
    page: 'dashboard', // dashboard | estoque
    channel: null,
    products: [],
    counts: {},        // code -> {code, month, qty, updatedAt}
    month: currentMonthStr(),
    search: '',
    category: 'all',
    stateFilter: 'all', // all | critical | coverage | uncounted | zero
    sortBy: 'code',     // code | coverage | minStock | avgConsumption
    openHistory: {},    // code -> array of {month, qty} or 'loading'
    activity: [],       // recent movements for the dashboard feed
    collapsedCats: {},  // category name -> true when collapsed
    isAdmin: false,
    members: [],        // public.members (página Usuários)
  };

  function loadUnit() {
    try {
      const raw = localStorage.getItem('estoqueWapUnit');
      if (raw && UNITS.some(function (u) { return u.id === raw; })) return raw;
    } catch (e) { /* ignore */ }
    return DEFAULT_UNIT;
  }
  function saveUnit(unitId) {
    try { localStorage.setItem('estoqueWapUnit', unitId); } catch (e) { /* ignore */ }
  }
  function unitLabel(unitId) {
    const u = UNITS.find(function (x) { return x.id === unitId; });
    return u ? u.label : unitId;
  }

  function loadCollapsedCats() {
    try {
      const raw = localStorage.getItem('estoqueWapCollapsedCats');
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveCollapsedCats() {
    try { localStorage.setItem('estoqueWapCollapsedCats', JSON.stringify(state.collapsedCats)); } catch (e) { /* ignore */ }
  }
  function toggleCategory(cat) {
    state.collapsedCats[cat] = !state.collapsedCats[cat];
    saveCollapsedCats();
    render();
  }

  function currentMonthStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function monthLabel(m) {
    const parts = m.split('-');
    return MONTH_NAMES[parseInt(parts[1], 10) - 1] + ' de ' + parts[0];
  }
  function monthShort(m) {
    const parts = m.split('-');
    return MONTH_NAMES[parseInt(parts[1], 10) - 1].slice(0, 3) + '/' + parts[0].slice(2);
  }
  // Meses disponíveis no seletor do topo: do mês atual até dezembro do mesmo ano.
  function monthsThroughDecember() {
    const out = [];
    const now = new Date();
    for (let m = now.getMonth(); m <= 11; m++) {
      out.push(currentMonthStr(new Date(now.getFullYear(), m, 1)));
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function debounce(fn, wait) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  function updateStickyOffset() {
    const headerEl = document.querySelector('.topbar');
    if (!headerEl) return;
    const h = headerEl.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--sticky-offset', h + 'px');
  }

  function showBanner(msg) {
    document.getElementById('banner').innerHTML = msg ? '<div class="page" style="padding-bottom:0"><div class="banner">' + escapeHtml(msg) + '</div></div>' : '';
  }

  // ---------------- data layer (Supabase) ----------------

  function rowToProduct(r) {
    return {
      id: r.code,
      code: r.code,
      name: r.name,
      category: r.category,
      unit: r.unit || '',
      minStock: Number(r.min_stock) || 0,
      avgConsumption: Number(r.avg_consumption) || 0,
    };
  }
  function rowToCount(r) {
    return { code: r.code, month: r.month, qty: r.qty == null ? null : Number(r.qty), updatedAt: r.updated_at };
  }

  async function loadProducts() {
    const unit = state.unit;
    const { data, error } = await state.sb.from('products').select('*').eq('unit_id', unit);
    if (state.unit !== unit) return;
    if (error) { console.error('products error', error); showBanner('Erro ao carregar o catálogo: ' + error.message); return; }
    state.products = (data || []).map(rowToProduct);
    populateCategorySelect();
    render();
  }

  async function loadCounts() {
    const unit = state.unit;
    const month = state.month;
    const { data, error } = await state.sb.from('counts').select('*').eq('unit_id', unit).eq('month', month);
    if (state.unit !== unit || state.month !== month) return;
    if (error) { console.error('counts error', error); return; }
    const map = {};
    (data || []).forEach(function (r) { map[r.code] = rowToCount(r); });
    state.counts = map;
    render();
  }

  async function loadActivity() {
    const unit = state.unit;
    const { data, error } = await state.sb.from('activity').select('*')
      .eq('unit_id', unit).order('created_at', { ascending: false }).limit(8);
    if (state.unit !== unit) return;
    if (error) { console.error('activity error', error); return; }
    state.activity = data || [];
    renderActivityFeed();
  }

  const reloadProducts = debounce(loadProducts, 300);
  const reloadCounts = debounce(loadCounts, 300);
  const reloadActivity = debounce(loadActivity, 300);

  function subscribeUnit() {
    if (state.channel) { state.sb.removeChannel(state.channel); state.channel = null; }
    const unit = state.unit;
    const filter = 'unit_id=eq.' + unit;
    state.channel = state.sb.channel('unit-' + unit)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: filter }, function () { reloadProducts(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'counts', filter: filter }, function () { reloadCounts(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity', filter: filter }, function () { reloadActivity(); })
      .subscribe(function (status) {
        // ao reconectar, recarrega tudo para não perder nada
        if (status === 'SUBSCRIBED') { loadProducts(); loadCounts(); loadActivity(); }
      });
  }

  function switchUnit(unitId) {
    if (unitId === state.unit) return;
    state.unit = unitId;
    saveUnit(unitId);
    state.products = [];
    state.counts = {};
    state.openHistory = {};
    state.activity = [];
    populateCategorySelect();
    render();
    subscribeUnit();
  }

  function showPage(page) {
    state.page = page;
    const dashEl = document.getElementById('page-dashboard');
    const estEl = document.getElementById('page-estoque');
    const usersEl = document.getElementById('page-usuarios');
    if (dashEl) dashEl.hidden = page !== 'dashboard';
    if (estEl) estEl.hidden = page !== 'estoque';
    if (usersEl) usersEl.hidden = page !== 'usuarios';
    document.querySelectorAll('.nav-item[data-page]').forEach(function (btn) {
      if (btn.dataset.page === page) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    updateStickyOffset();
    if (page === 'dashboard') renderDashboard();
    if (page === 'usuarios') loadMembers();
  }

  function goToEstoque(opts) {
    opts = opts || {};
    if (opts.category !== undefined) {
      state.category = opts.category;
      const sel = document.getElementById('categorySelect');
      if (sel) sel.value = opts.category;
    }
    if (opts.stateFilter !== undefined) {
      state.stateFilter = opts.stateFilter;
    }
    showPage('estoque');
    render();
  }

  // ---------------- auth (e-mail + senha) ----------------

  function showLoginMsg(msg, kind) {
    const el = document.getElementById('loginMsg');
    el.textContent = msg;
    el.className = 'auth-msg ' + (kind || 'err');
    el.hidden = !msg;
  }

  function showLogin() {
    document.getElementById('appShell').hidden = true;
    document.getElementById('authScreen').hidden = false;
  }

  async function onLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    showLoginMsg('');
    const { error } = await state.sb.auth.signInWithPassword({ email: email, password: password });
    btn.disabled = false;
    if (error) {
      let msg = 'Não foi possível entrar: ' + error.message;
      if (/invalid login credentials/i.test(error.message)) msg = 'E-mail ou senha incorretos.';
      else if (/banned/i.test(error.message)) msg = 'Seu usuário está desativado. Fale com o administrador.';
      else if (/rate|too many/i.test(error.message)) msg = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
      showLoginMsg(msg);
      return;
    }
    document.getElementById('loginPassword').value = '';
  }

  async function onSession(session) {
    if (!session) {
      state.user = null;
      state.isAdmin = false;
      showLogin();
      return;
    }
    const user = session.user;
    const { data: member, error } = await state.sb.from('members')
      .select('full_name, is_admin, active').eq('user_id', user.id).maybeSingle();
    if (error || !member || !member.active) {
      await state.sb.auth.signOut();
      showLogin();
      showLoginMsg(error ? ('Não foi possível verificar seu acesso: ' + error.message)
        : 'Seu usuário não tem acesso a este sistema. Fale com o administrador.');
      return;
    }
    state.user = user;
    state.myName = member.full_name || user.email;
    state.isAdmin = !!member.is_admin;
    document.getElementById('navUsersBtn').hidden = !state.isAdmin;
    document.getElementById('authScreen').hidden = true;
    document.getElementById('appShell').hidden = false;
    renderUserChip();
    if (!state.started) {
      state.started = true;
      subscribeUnit();
      updateStickyOffset();
    }
  }

  function renderUserChip() {
    const nameEl = document.getElementById('userName');
    const slot = document.getElementById('userAvatarSlot');
    const displayName = state.myName || (state.user && state.user.email) || '—';
    nameEl.textContent = displayName;
    nameEl.title = state.user ? state.user.email : '';
    slot.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'user-avatar-fallback';
    span.textContent = displayName ? displayName.charAt(0).toUpperCase() : '?';
    slot.appendChild(span);
  }

  // ---------------- trocar minha senha ----------------

  function openPasswordForm() {
    document.getElementById('pwForm').reset();
    document.getElementById('pwError').hidden = true;
    document.getElementById('pwFeedback').textContent = '';
    document.getElementById('pwOverlay').hidden = false;
    setTimeout(function () { document.getElementById('pwNew').focus(); }, 0);
  }
  function closePasswordForm() { document.getElementById('pwOverlay').hidden = true; }

  async function onPasswordSubmit(e) {
    e.preventDefault();
    const a = document.getElementById('pwNew').value;
    const b = document.getElementById('pwNew2').value;
    const err = document.getElementById('pwError');
    err.hidden = true;
    if (a.length < 8) { err.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; err.hidden = false; return; }
    if (a !== b) { err.textContent = 'As duas senhas não são iguais.'; err.hidden = false; return; }
    const btn = document.getElementById('pwSaveBtn');
    btn.disabled = true;
    document.getElementById('pwFeedback').textContent = 'Salvando…';
    const { error } = await state.sb.auth.updateUser({ password: a });
    btn.disabled = false;
    document.getElementById('pwFeedback').textContent = '';
    if (error) {
      err.textContent = /different|same/i.test(error.message) ? 'A nova senha precisa ser diferente da atual.' : ('Não foi possível trocar a senha: ' + error.message);
      err.hidden = false;
      return;
    }
    closePasswordForm();
    showBanner('Senha alterada com sucesso.');
    setTimeout(function () { showBanner(''); }, 4000);
  }

  // ---------------- usuários (administradores) ----------------

  async function callAdmin(payload) {
    const { data, error } = await state.sb.functions.invoke('admin-users', { body: payload });
    if (error) {
      let msg = error.message || 'erro';
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e2) { /* ignore */ }
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  async function loadMembers() {
    const { data, error } = await state.sb.from('members').select('*').order('full_name');
    if (error) { document.getElementById('usersFeedback').textContent = 'Erro ao carregar usuários: ' + error.message; return; }
    state.members = data || [];
    renderUsers();
  }

  function renderUsers() {
    const body = document.getElementById('usersBody');
    const list = state.members || [];
    if (!list.length) { body.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum usuário.</td></tr>'; return; }
    body.innerHTML = list.map(function (m) {
      const me = state.user && m.user_id === state.user.id;
      const actions = [
        '<button class="hist-btn" type="button" data-act="reset" data-id="' + m.user_id + '">redefinir senha</button>',
      ];
      if (!me) {
        actions.push('<button class="hist-btn" type="button" data-act="admin" data-id="' + m.user_id + '">' + (m.is_admin ? 'tirar admin' : 'tornar admin') + '</button>');
        actions.push('<button class="hist-btn" type="button" data-act="active" data-id="' + m.user_id + '">' + (m.active ? 'desativar' : 'reativar') + '</button>');
      }
      return '<tr' + (m.active ? '' : ' class="inactive"') + '>' +
        '<td>' + escapeHtml(m.full_name) + (me ? ' <span class="badge neutral">você</span>' : '') + '</td>' +
        '<td class="mono">' + escapeHtml(m.email) + '</td>' +
        '<td>' + (m.is_admin ? '<span class="badge ok">administrador</span>' : '<span class="badge neutral">usuário</span>') + '</td>' +
        '<td>' + (m.active ? '<span class="badge ok"><span class="dot"></span>ativo</span>' : '<span class="badge danger"><span class="dot"></span>desativado</span>') + '</td>' +
        '<td class="last-count">' + (m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR') : '—') + '</td>' +
        '<td><div class="actions">' + actions.join('') + '</div></td>' +
        '</tr>';
    }).join('');
  }

  function randomPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const arr = new Uint32Array(10);
    crypto.getRandomValues(arr);
    return Array.from(arr, function (n) { return chars[n % chars.length]; }).join('');
  }

  function openUserForm(mode, member) {
    state.userFormMode = mode;
    state.userFormTarget = member || null;
    const isCreate = mode === 'create';
    document.getElementById('userForm').reset();
    document.getElementById('userError').hidden = true;
    document.getElementById('userFeedback').textContent = '';
    document.getElementById('userNameField').hidden = !isCreate;
    document.getElementById('userEmailField').hidden = !isCreate;
    document.getElementById('userAdminField').hidden = !isCreate;
    document.getElementById('userTitle').textContent = isCreate ? 'Novo usuário' : 'Redefinir senha';
    document.getElementById('userSub').textContent = isCreate
      ? 'Passe o e-mail e a senha provisória para a pessoa. Ela pode trocar a senha depois, em "senha", no topo da tela.'
      : ('Nova senha para ' + member.full_name + ' (' + member.email + '). Passe a senha para a pessoa.');
    document.getElementById('userPasswordLabel').textContent = isCreate ? 'Senha provisória' : 'Nova senha';
    document.getElementById('userSaveBtn').textContent = isCreate ? 'Cadastrar' : 'Salvar nova senha';
    document.getElementById('userPassword').value = randomPassword();
    document.getElementById('userOverlay').hidden = false;
    setTimeout(function () { document.getElementById(isCreate ? 'userFullName' : 'userPassword').focus(); }, 0);
  }
  function closeUserForm() { document.getElementById('userOverlay').hidden = true; }

  async function onUserSubmit(e) {
    e.preventDefault();
    const err = document.getElementById('userError');
    err.hidden = true;
    const password = document.getElementById('userPassword').value;
    let payload;
    if (state.userFormMode === 'create') {
      payload = {
        action: 'create',
        full_name: document.getElementById('userFullName').value.trim(),
        email: document.getElementById('userEmail').value.trim().toLowerCase(),
        password: password,
        is_admin: document.getElementById('userIsAdmin').checked,
      };
      if (!payload.full_name) { err.textContent = 'Informe o nome.'; err.hidden = false; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) { err.textContent = 'Informe um e-mail válido.'; err.hidden = false; return; }
    } else {
      payload = { action: 'update', user_id: state.userFormTarget.user_id, password: password };
    }
    if (password.length < 8) { err.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; err.hidden = false; return; }
    const btn = document.getElementById('userSaveBtn');
    btn.disabled = true;
    document.getElementById('userFeedback').textContent = 'Salvando…';
    try {
      await callAdmin(payload);
      closeUserForm();
      document.getElementById('usersFeedback').textContent = state.userFormMode === 'create'
        ? ('Usuário ' + payload.email + ' cadastrado.') : 'Senha redefinida.';
      loadMembers();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      document.getElementById('userFeedback').textContent = '';
    }
  }

  async function onUsersTableClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const m = (state.members || []).find(function (x) { return x.user_id === btn.dataset.id; });
    if (!m) return;
    const fb = document.getElementById('usersFeedback');
    if (btn.dataset.act === 'reset') { openUserForm('reset', m); return; }
    let payload, question;
    if (btn.dataset.act === 'active') {
      payload = { action: 'update', user_id: m.user_id, active: !m.active };
      question = m.active ? ('Desativar ' + m.full_name + '? A pessoa não conseguirá mais entrar.') : ('Reativar ' + m.full_name + '?');
    } else {
      payload = { action: 'update', user_id: m.user_id, is_admin: !m.is_admin };
      question = m.is_admin ? ('Tirar o acesso de administrador de ' + m.full_name + '?') : ('Tornar ' + m.full_name + ' administrador?');
    }
    if (!window.confirm(question)) return;
    btn.disabled = true;
    fb.textContent = 'Salvando…';
    try {
      await callAdmin(payload);
      fb.textContent = 'Alteração salva.';
      loadMembers();
    } catch (ex) {
      fb.textContent = ex.message;
      btn.disabled = false;
    }
  }

  // ---------------- init ----------------

  async function init() {
    document.getElementById('loginForm').addEventListener('submit', onLoginSubmit);

    const configured = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/COLE_AQUI/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY);
    if (!window.supabase || !configured) {
      showLogin();
      document.getElementById('loginBtn').disabled = true;
      showLoginMsg(!window.supabase
        ? 'Não foi possível carregar a biblioteca do Supabase. Verifique sua conexão.'
        : 'Sistema ainda não configurado: preencha SUPABASE_URL e SUPABASE_ANON_KEY em config.js.');
      return;
    }

    state.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    initUi();

    state.sb.auth.onAuthStateChange(function (event, session) {
      // adia para fora do callback (recomendação do supabase-js)
      setTimeout(function () { onSession(session); }, 0);
    });
  }

  function initUi() {
    state.collapsedCats = loadCollapsedCats();
    const unitSel = document.getElementById('unitSelect');
    unitSel.innerHTML = UNITS.map(function (u) {
      return '<option value="' + u.id + '">' + escapeHtml(u.label) + '</option>';
    }).join('');
    unitSel.value = state.unit;
    unitSel.addEventListener('change', function (e) { switchUnit(e.target.value); });
    populateMonthSelect();
    document.getElementById('monthSelect').value = state.month;
    document.getElementById('monthSelect').addEventListener('change', function (e) {
      state.month = e.target.value;
      state.openHistory = {};
      state.counts = {};
      render();
      loadCounts();
    });
    document.getElementById('searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim().toLowerCase();
      if (state.search && state.page !== 'estoque') showPage('estoque');
      render();
    });
    document.getElementById('categorySelect').addEventListener('change', function (e) {
      state.category = e.target.value;
      render();
    });
    document.getElementById('stateFilter').addEventListener('change', function (e) {
      state.stateFilter = e.target.value;
      render();
    });
    document.getElementById('sortSelect').addEventListener('change', function (e) {
      state.sortBy = e.target.value;
      render();
    });
    const kpisEl = document.getElementById('kpis');
    kpisEl.addEventListener('click', function (e) {
      const tile = e.target.closest('[data-filter]');
      if (!tile) return;
      state.stateFilter = tile.dataset.filter;
      render();
    });
    kpisEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tile = e.target.closest('[data-filter]');
      if (!tile) return;
      e.preventDefault();
      state.stateFilter = tile.dataset.filter;
      render();
    });
    document.getElementById('poBtn').addEventListener('click', openPurchaseOrder);
    document.getElementById('poCloseBtn').addEventListener('click', closePurchaseOrder);
    document.getElementById('poOverlay').addEventListener('click', function (e) {
      if (e.target === this) closePurchaseOrder();
    });
    document.getElementById('poCopyBtn').addEventListener('click', copyPurchaseOrderText);
    document.getElementById('poCsvBtn').addEventListener('click', downloadPurchaseOrderCsv);
    document.getElementById('addItemBtn').addEventListener('click', openItemForm);
    document.getElementById('itemCloseBtn').addEventListener('click', closeItemForm);
    document.getElementById('itemCancelBtn').addEventListener('click', closeItemForm);
    document.getElementById('itemOverlay').addEventListener('click', function (e) {
      if (e.target === this) closeItemForm();
    });
    document.getElementById('itemForm').addEventListener('submit', function (e) {
      e.preventDefault();
      submitNewItem();
    });
    document.getElementById('passwordBtn').addEventListener('click', openPasswordForm);
    document.getElementById('pwForm').addEventListener('submit', onPasswordSubmit);
    document.getElementById('pwCloseBtn').addEventListener('click', closePasswordForm);
    document.getElementById('pwCancelBtn').addEventListener('click', closePasswordForm);
    document.getElementById('addUserBtn').addEventListener('click', function () { openUserForm('create'); });
    document.getElementById('userForm').addEventListener('submit', onUserSubmit);
    document.getElementById('userCloseBtn').addEventListener('click', closeUserForm);
    document.getElementById('userCancelBtn').addEventListener('click', closeUserForm);
    document.getElementById('usersBody').addEventListener('click', onUsersTableClick);
    document.getElementById('logoutBtn').addEventListener('click', async function () {
      await state.sb.auth.signOut();
      window.location.reload();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePurchaseOrder(); closeItemForm(); closePasswordForm(); closeUserForm(); }
    });

    const sectionsEl = document.getElementById('sections');
    sectionsEl.addEventListener('change', function (e) {
      const el = e.target;
      if (!el || !el.dataset) return;
      if (el.dataset.role === 'minstock') onMinStockInput(el.dataset.code, el.value);
      else if (el.dataset.role === 'consumption') onAvgConsumptionInput(el.dataset.code, el.value);
      else if (el.dataset.role === 'qty') onQtyInput(el.dataset.code, el.value);
    });
    sectionsEl.addEventListener('click', function (e) {
      const histBtn = e.target.closest('[data-role="history"]');
      if (histBtn) { toggleHistory(histBtn.dataset.code); return; }
      const head = e.target.closest('[data-role="toggle-cat"]');
      if (head) { toggleCategory(head.dataset.cat); return; }
    });
    sectionsEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const head = e.target.closest('[data-role="toggle-cat"]');
      if (head) { e.preventDefault(); toggleCategory(head.dataset.cat); }
    });

    document.querySelectorAll('.nav-item[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () { showPage(btn.dataset.page); });
    });
    document.getElementById('navPoBtn').addEventListener('click', openPurchaseOrder);
    document.getElementById('dashKpis').addEventListener('click', function (e) {
      const tile = e.target.closest('[data-filter]');
      if (!tile) return;
      goToEstoque({ stateFilter: tile.dataset.filter });
    });
    document.getElementById('dashKpis').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tile = e.target.closest('[data-filter]');
      if (!tile) return;
      e.preventDefault();
      goToEstoque({ stateFilter: tile.dataset.filter });
    });
    document.getElementById('dashCategories').addEventListener('click', function (e) {
      const card = e.target.closest('[data-cat]');
      if (!card) return;
      goToEstoque({ category: card.dataset.cat, stateFilter: 'all' });
    });
    const criticalLink = document.getElementById('dashCriticalLink');
    criticalLink.addEventListener('click', function () { goToEstoque({ stateFilter: 'critical' }); });
    criticalLink.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToEstoque({ stateFilter: 'critical' }); }
    });

    window.addEventListener('resize', debounce(updateStickyOffset, 150));
    render();
  }

  function populateMonthSelect() {
    const sel = document.getElementById('monthSelect');
    sel.innerHTML = monthsThroughDecember().map(function (m) {
      return '<option value="' + m + '">' + monthLabel(m) + '</option>';
    }).join('');
  }

  function populateCategorySelect() {
    const cats = Array.from(new Set(state.products.map(function (p) { return p.category; }))).filter(Boolean);
    cats.sort(function (a, b) {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    const sel = document.getElementById('categorySelect');
    const current = sel.value || 'all';
    sel.innerHTML = '<option value="all">Todas as categorias</option>' + cats.map(function (c) {
      return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>';
    }).join('');
    sel.value = cats.indexOf(current) === -1 ? 'all' : current;
    if (sel.value !== current) state.category = 'all';
  }

  // ---------------- edits ----------------

  function saveFailed(e) {
    console.error(e);
    showBanner('Não foi possível salvar a última alteração (' + (e && e.message ? e.message : 'erro') + '). Verifique sua conexão e tente de novo.');
  }

  function updateProductField(code, field, column, value) {
    const n = value === '' ? 0 : parseFloat(value);
    if (isNaN(n) || n < 0) return;
    const unit = state.unit;
    const p = state.products.find(function (x) { return x.code === code; });
    if (p) p[field] = n; // atualização otimista
    render();
    const patch = {}; patch[column] = n;
    state.sb.from('products').update(patch).eq('unit_id', unit).eq('code', code).then(function (res) {
      if (res.error) { saveFailed(res.error); reloadProducts(); } else showBanner('');
    });
  }

  const minStockTimers = {};
  function onMinStockInput(code, value) {
    clearTimeout(minStockTimers[code]);
    minStockTimers[code] = setTimeout(function () { updateProductField(code, 'minStock', 'min_stock', value); }, 500);
  }

  const avgConsumptionTimers = {};
  function onAvgConsumptionInput(code, value) {
    clearTimeout(avgConsumptionTimers[code]);
    avgConsumptionTimers[code] = setTimeout(function () { updateProductField(code, 'avgConsumption', 'avg_consumption', value); }, 500);
  }

  const qtyTimers = {};
  function onQtyInput(code, value) {
    clearTimeout(qtyTimers[code]);
    const unit = state.unit;
    const month = state.month;
    qtyTimers[code] = setTimeout(function () {
      const n = value === '' ? null : parseFloat(value);
      if (value !== '' && (isNaN(n) || n < 0)) return;
      const now = new Date().toISOString();
      if (state.unit === unit && state.month === month) {
        state.counts[code] = { code: code, month: month, qty: n, updatedAt: now }; // otimista
        render();
      }
      state.sb.from('counts').upsert({
        unit_id: unit,
        code: code,
        month: month,
        qty: n,
        updated_at: now,
        updated_by: state.user ? state.user.id : null,
      }, { onConflict: 'unit_id,code,month' }).then(function (res) {
        if (res.error) { saveFailed(res.error); reloadCounts(); return; }
        showBanner('');
        if (n != null) logActivity(unit, 'count', code, n, undefined, month);
      });
    }, 500);
  }

  async function toggleHistory(code) {
    if (state.openHistory.hasOwnProperty(code)) {
      delete state.openHistory[code];
      render();
      return;
    }
    state.openHistory[code] = 'loading';
    render();
    const unit = state.unit;
    const month = state.month;
    const { data, error } = await state.sb.from('counts').select('month, qty')
      .eq('unit_id', unit).eq('code', code).order('month', { ascending: false }).limit(7);
    if (state.unit !== unit || !state.openHistory.hasOwnProperty(code)) return;
    if (error) {
      console.error(error);
      state.openHistory[code] = [];
    } else {
      state.openHistory[code] = (data || [])
        .map(function (d) { return { month: d.month, qty: d.qty == null ? null : Number(d.qty) }; })
        .filter(function (d) { return d.month !== month; })
        .slice(0, 6);
    }
    render();
  }

  // ---------------- purchase order ----------------

  function computePurchaseOrder() {
    const rows = [];
    const skipped = [];
    state.products.forEach(function (p) {
      const c = state.counts[p.code];
      const min = p.minStock || 0;
      if (!c || c.qty == null) {
        if (min > 0) skipped.push(p);
        return;
      }
      const need = min - c.qty;
      if (need > 0) {
        rows.push({ code: p.code, name: p.name, category: p.category, unit: p.unit || '', qty: c.qty, min: min, order: need });
      }
    });
    rows.sort(function (a, b) {
      const ia = CAT_ORDER.indexOf(a.category), ib = CAT_ORDER.indexOf(b.category);
      const ca = (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      if (ca !== 0) return ca;
      return a.code.localeCompare(b.code);
    });
    skipped.sort(function (a, b) { return a.code.localeCompare(b.code); });
    return { rows: rows, skipped: skipped };
  }

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    if (/[;"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function purchaseOrderToCsv(rows) {
    const header = ['Codigo', 'Descricao', 'Categoria', 'Unidade', 'Estoque atual', 'Estoque de seguranca', 'Quantidade a pedir'];
    const lines = [header.join(';')];
    rows.forEach(function (r) {
      lines.push([csvEscape(r.code), csvEscape(r.name), csvEscape(r.category), csvEscape(r.unit), r.qty, r.min, r.order].join(';'));
    });
    return lines.join('\r\n');
  }

  function openPurchaseOrder() {
    const result = computePurchaseOrder();
    state.poRows = result.rows;
    state.poSkipped = result.skipped;
    document.getElementById('poFeedback').textContent = '';
    renderPurchaseOrderModal();
    document.getElementById('poOverlay').hidden = false;
  }

  function closePurchaseOrder() {
    document.getElementById('poOverlay').hidden = true;
  }

  function renderPurchaseOrderModal() {
    const rows = state.poRows || [];
    const skipped = state.poSkipped || [];
    document.getElementById('poSub').textContent =
      unitLabel(state.unit) + ' · baseado na contagem de ' + monthLabel(state.month) + ' · itens abaixo do estoque de segurança';
    document.getElementById('poTotal').textContent =
      rows.length + (rows.length === 1 ? ' item para pedir' : ' itens para pedir');

    const body = document.getElementById('poBody');
    if (rows.length === 0) {
      body.innerHTML = '<div class="po-empty">Nenhum item abaixo do estoque de segurança em ' + monthLabel(state.month) + '. Nada a pedir por enquanto.</div>';
      document.getElementById('poCsvBtn').disabled = true;
      document.getElementById('poCopyBtn').disabled = true;
    } else {
      document.getElementById('poCsvBtn').disabled = false;
      document.getElementById('poCopyBtn').disabled = false;
      const byCat = {};
      rows.forEach(function (r) { (byCat[r.category] = byCat[r.category] || []).push(r); });
      const cats = Object.keys(byCat).sort(function (a, b) {
        const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
      let html = '';
      cats.forEach(function (cat) {
        html += '<div class="po-cat">' + escapeHtml(cat) + '</div>';
        html += '<div class="po-table-wrap"><table class="po-table"><thead><tr>' +
          '<th>Código</th><th>Descrição</th><th>Un.</th><th>Atual</th><th>Segurança</th><th>Pedir</th>' +
          '</tr></thead><tbody>';
        byCat[cat].forEach(function (r) {
          html += '<tr>' +
            '<td class="mono">' + escapeHtml(r.code) + '</td>' +
            '<td class="desc">' + escapeHtml(r.name) + '</td>' +
            '<td>' + escapeHtml(r.unit) + '</td>' +
            '<td class="num mono">' + r.qty + '</td>' +
            '<td class="num mono">' + r.min + '</td>' +
            '<td class="num mono po-order-qty">' + r.order + '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
      });
      if (skipped.length) {
        html += '<div class="po-skipped">Sem contagem em ' + monthLabel(state.month) + ' (não incluídos automaticamente, confira à parte): ' +
          skipped.map(function (p) { return escapeHtml(p.code); }).join(', ') + '.</div>';
      }
      body.innerHTML = html;
    }
  }

  function copyPurchaseOrderText() {
    const rows = state.poRows || [];
    if (!rows.length) return;
    const lines = ['Pedido de compra — ' + unitLabel(state.unit) + ' — ' + monthLabel(state.month)];
    let currentCat = null;
    rows.forEach(function (r) {
      if (r.category !== currentCat) { currentCat = r.category; lines.push(''); lines.push(currentCat + ':'); }
      lines.push('- ' + r.code + ' ' + r.name + ' (' + r.unit + '): pedir ' + r.order + ' (atual ' + r.qty + ', segurança ' + r.min + ')');
    });
    const text = lines.join('\n');
    const feedback = document.getElementById('poFeedback');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        feedback.textContent = 'Copiado!';
        setTimeout(function () { feedback.textContent = ''; }, 2500);
      }).catch(function () {
        feedback.textContent = 'Não foi possível copiar aqui.';
      });
    } else {
      feedback.textContent = 'Cópia não suportada neste navegador.';
    }
  }

  function downloadPurchaseOrderCsv() {
    const rows = state.poRows || [];
    if (!rows.length) return;
    const csv = '﻿' + purchaseOrderToCsv(rows);
    const filename = 'pedido-compra-estoque-wap-' + state.unit.toLowerCase() + '-' + state.month + '.csv';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    const feedback = document.getElementById('poFeedback');
    feedback.textContent = 'Arquivo salvo.';
    setTimeout(function () { feedback.textContent = ''; }, 2500);
  }

  // ---------------- new item ----------------

  function openItemForm() {
    const form = document.getElementById('itemForm');
    form.reset();
    document.getElementById('itemMinStock').value = 0;
    document.getElementById('itemAvgConsumption').value = 0;
    const errorEl = document.getElementById('itemError');
    errorEl.hidden = true;
    errorEl.textContent = '';
    document.getElementById('itemFeedback').textContent = '';
    document.getElementById('itemSub').textContent = unitLabel(state.unit);
    populateCategoryDatalist();
    document.getElementById('itemOverlay').hidden = false;
    setTimeout(function () {
      const codeInput = document.getElementById('itemCode');
      if (codeInput) codeInput.focus();
    }, 0);
  }

  function closeItemForm() {
    document.getElementById('itemOverlay').hidden = true;
  }

  function populateCategoryDatalist() {
    const cats = Array.from(new Set(
      CAT_ORDER.concat(state.products.map(function (p) { return p.category; }))
    )).filter(Boolean);
    document.getElementById('categoryList').innerHTML = cats.map(function (c) {
      return '<option value="' + escapeHtml(c) + '"></option>';
    }).join('');
  }

  function showItemError(msg) {
    const el = document.getElementById('itemError');
    el.textContent = msg;
    el.hidden = false;
  }

  async function submitNewItem() {
    const errorEl = document.getElementById('itemError');
    errorEl.hidden = true;
    errorEl.textContent = '';

    const rawCode = document.getElementById('itemCode').value.trim().toUpperCase();
    const name = document.getElementById('itemName').value.trim();
    const category = document.getElementById('itemCategory').value.trim();
    const unit = document.getElementById('itemUnit').value.trim();
    const minStock = parseFloat(document.getElementById('itemMinStock').value);
    const avgConsumption = parseFloat(document.getElementById('itemAvgConsumption').value);

    if (!rawCode) { showItemError('Informe o código do produto.'); return; }
    if (!/^[A-Za-z0-9_\-.~:@+]+$/.test(rawCode)) {
      showItemError('O código só pode ter letras, números e os símbolos _ - . ~ : @ +, sem espaços.');
      return;
    }
    if (rawCode.length > 100) { showItemError('Código muito longo.'); return; }
    if (!name) { showItemError('Informe a descrição do item.'); return; }
    if (!category) { showItemError('Informe a categoria.'); return; }
    if (isNaN(minStock) || minStock < 0) { showItemError('Estoque de segurança inválido.'); return; }
    if (isNaN(avgConsumption) || avgConsumption < 0) { showItemError('Consumo médio mensal inválido.'); return; }

    const exists = state.products.some(function (p) { return String(p.code).toUpperCase() === rawCode; });
    if (exists) {
      showItemError('Já existe um item com o código "' + rawCode + '" nesta unidade.');
      return;
    }

    const saveBtn = document.getElementById('itemSaveBtn');
    saveBtn.disabled = true;
    document.getElementById('itemFeedback').textContent = 'Salvando…';
    const unitAtSubmit = state.unit;
    try {
      const { error } = await state.sb.from('products').insert({
        unit_id: unitAtSubmit,
        code: rawCode,
        name: name,
        category: category,
        unit: unit,
        min_stock: minStock,
        avg_consumption: avgConsumption,
      });
      if (error) throw error;
      logActivity(unitAtSubmit, 'add', rawCode, category, name);
      if (state.unit === unitAtSubmit) {
        document.getElementById('itemFeedback').textContent = '';
        closeItemForm();
        loadProducts();
      }
    } catch (e) {
      console.error(e);
      if (state.unit === unitAtSubmit) {
        document.getElementById('itemFeedback').textContent = '';
        showItemError(e && e.code === '23505'
          ? 'Já existe um item com o código "' + rawCode + '" nesta unidade.'
          : 'Não foi possível salvar o item agora. Tente novamente.');
      }
    } finally {
      saveBtn.disabled = false;
    }
  }

  // ---------------- filters / sort ----------------

  function matchesStateFilter(p) {
    const c = state.counts[p.code];
    const min = p.minStock || 0;
    switch (state.stateFilter) {
      case 'critical':
        return !!(c && c.qty != null && c.qty < min);
      case 'coverage':
        return !!(c && c.qty != null && p.avgConsumption > 0 && (c.qty / p.avgConsumption) < 1);
      case 'uncounted':
        return !(c && c.qty != null);
      case 'zero':
        return !!(c && c.qty === 0);
      default:
        return true;
    }
  }

  function filteredProducts() {
    return state.products.filter(function (p) {
      if (state.category !== 'all' && p.category !== state.category) return false;
      if (state.search) {
        const hay = (p.code + ' ' + p.name).toLowerCase();
        if (hay.indexOf(state.search) === -1) return false;
      }
      if (!matchesStateFilter(p)) return false;
      return true;
    });
  }

  function sortValue(p, field) {
    const c = state.counts[p.code];
    if (field === 'coverage') {
      if (c && c.qty != null && p.avgConsumption > 0) return c.qty / p.avgConsumption;
      return Infinity; // itens sem dado suficiente ficam por último
    }
    if (field === 'minStock') return p.minStock || 0;
    if (field === 'avgConsumption') return p.avgConsumption || 0;
    return null;
  }

  function compareProducts(a, b) {
    const field = state.sortBy || 'code';
    if (field === 'code') return a.code.localeCompare(b.code);
    const va = sortValue(a, field), vb = sortValue(b, field);
    let cmp;
    if (va === vb) cmp = 0;
    else cmp = field === 'coverage' ? (va < vb ? -1 : 1) : (vb < va ? -1 : 1);
    return cmp !== 0 ? cmp : a.code.localeCompare(b.code);
  }

  // ---------------- activity log ----------------

  function productNameFor(code) {
    const p = state.products.find(function (x) { return x.code === code; });
    return p ? p.name : '';
  }

  async function logActivity(unitId, type, code, detail, explicitName, month) {
    if (!state.sb || !state.user) return;
    const { error } = await state.sb.from('activity').insert({
      unit_id: unitId,
      type: type, // 'count' | 'add'
      code: code,
      name: explicitName || productNameFor(code),
      detail: detail == null ? '' : String(detail),
      month: month || null, // mês de referência da contagem ('count'); null para 'add'
      actor_id: state.user.id,
      actor_name: state.myName || null,
      actor_email: state.user.email || null,
    });
    if (error) { console.error('activity log error', error); return; }
    if (unitId === state.unit) reloadActivity();
  }

  function renderActivityFeed() {
    const el = document.getElementById('dashActivity');
    if (!el) return;
    const items = state.activity || [];
    if (!items.length) {
      el.innerHTML = '<div class="empty-state">Nenhuma movimentação registrada ainda.</div>';
      return;
    }
    el.innerHTML = items.map(function (a) {
      const verb = a.type === 'add' ? 'cadastrou' : 'registrou contagem de';
      const extra = (a.type === 'count' && a.detail !== '') ? (' (' + escapeHtml(String(a.detail)) + ' un.)') : '';
      const unitTxt = a.unit_id ? escapeHtml(unitLabel(a.unit_id)) : '';
      const monthTxt = a.month ? escapeHtml(monthLabel(a.month)) : '';
      const context = [unitTxt, monthTxt].filter(Boolean).join(' · ');
      const who = a.actor_name || a.actor_email || 'Alguém';
      const when = a.created_at ? new Date(a.created_at).toLocaleString('pt-BR') : '';
      return '<div class="activity-row"><span class="activity-dot ' + (a.type === 'add' ? 'add' : 'count') + '"></span>' +
        '<div class="activity-body"><span class="who">' + escapeHtml(who) + '</span> ' + verb + ' <span class="mono">' + escapeHtml(a.code || '') + '</span>' +
        (a.name ? ' — ' + escapeHtml(a.name) : '') + extra +
        (context ? '<div class="activity-context">' + context + '</div>' : '') +
        '<div class="when">' + escapeHtml(when) + '</div></div></div>';
    }).join('');
  }

  // ---------------- dashboard ----------------

  function classifyProduct(p) {
    const c = state.counts[p.code];
    const min = p.minStock || 0;
    if (!c || c.qty == null) return 'warn';
    if (c.qty < min) return 'crit';
    if (p.avgConsumption > 0) {
      const cov = c.qty / p.avgConsumption;
      if (cov < 1) return 'crit';
      if (cov < 2) return 'warn';
    }
    return 'ok';
  }

  function computeDashboardMetrics() {
    const total = state.products.length;
    let counted = 0, belowMin = 0, criticalCoverage = 0, zeroCount = 0;
    let okCount = 0, warnCount = 0, critCount = 0;
    let coverageSum = 0, coverageN = 0;
    const byCat = {};
    state.products.forEach(function (p) {
      const c = state.counts[p.code];
      const cat = p.category || 'Outro';
      if (!byCat[cat]) byCat[cat] = { total: 0, crit: 0 };
      byCat[cat].total++;
      const bucket = classifyProduct(p);
      if (bucket === 'ok') okCount++;
      else if (bucket === 'warn') warnCount++;
      else { critCount++; byCat[cat].crit++; }
      if (c && c.qty != null) {
        counted++;
        if (c.qty < (p.minStock || 0)) belowMin++;
        if (c.qty === 0) zeroCount++;
        if (p.avgConsumption > 0) {
          const cov = c.qty / p.avgConsumption;
          coverageSum += cov;
          coverageN++;
          if (cov < 1) criticalCoverage++;
        }
      }
    });
    return {
      total: total,
      counted: counted,
      pending: total - counted,
      belowMin: belowMin,
      criticalCoverage: criticalCoverage,
      zeroCount: zeroCount,
      ok: okCount,
      warn: warnCount,
      crit: critCount,
      avgCoverage: coverageN ? (coverageSum / coverageN) : null,
      byCat: byCat,
    };
  }

  function renderDashboard() {
    const m = computeDashboardMetrics();
    const sub = document.getElementById('dashSubtitle');
    if (sub) sub.textContent = unitLabel(state.unit) + ' · referência: ' + monthLabel(state.month);
    renderDashboardKpis(m);
    renderStatusBar(m);
    renderCoverageCard(m);
    renderCategoryCards(m);
    renderCriticalTable(m);
    renderDonut(m);
    renderTopConsumption();
    renderActivityFeed();
  }

  function renderDashboardKpis(m) {
    const el = document.getElementById('dashKpis');
    if (!el) return;
    el.innerHTML =
      '<div class="kpi" data-filter="all" role="button" tabindex="0"><div class="num mono">' + m.total + '</div><div class="label">Itens no catálogo</div></div>' +
      '<div class="kpi' + (m.belowMin > 0 ? ' warn' : '') + '" data-filter="critical" role="button" tabindex="0"><div class="num mono">' + m.belowMin + '</div><div class="label">Abaixo da segurança</div></div>' +
      '<div class="kpi' + (m.criticalCoverage > 0 ? ' warn' : '') + '" data-filter="coverage" role="button" tabindex="0"><div class="num mono">' + m.criticalCoverage + '</div><div class="label">Cobertura &lt; 1 mês</div></div>' +
      '<div class="kpi' + (m.zeroCount > 0 ? ' warn' : '') + '" data-filter="zero" role="button" tabindex="0"><div class="num mono">' + m.zeroCount + '</div><div class="label">Zerados</div></div>' +
      '<div class="kpi' + (m.pending > 0 ? ' warn' : '') + '" data-filter="uncounted" role="button" tabindex="0"><div class="num mono">' + m.pending + '</div><div class="label">Sem contagem</div></div>';
  }

  function renderStatusBar(m) {
    const total = m.total || 0;
    const track = document.getElementById('dashStatusBar');
    const sub = document.getElementById('dashStatusSub');
    if (sub) sub.textContent = total + (total === 1 ? ' item' : ' itens');
    if (!track) return;
    if (!total) { track.innerHTML = '<div class="empty-state">Nenhum item cadastrado ainda.</div>'; return; }
    const okPct = (m.ok / total) * 100;
    const warnPct = (m.warn / total) * 100;
    const critPct = (m.crit / total) * 100;
    track.innerHTML =
      '<div class="status-bar-track">' +
        (m.ok ? '<div class="status-bar-seg ok" style="width:' + okPct + '%"></div>' : '') +
        (m.warn ? '<div class="status-bar-seg warn" style="width:' + warnPct + '%"></div>' : '') +
        (m.crit ? '<div class="status-bar-seg crit" style="width:' + critPct + '%"></div>' : '') +
      '</div>' +
      '<div class="status-legend" style="margin-top:10px;">' +
        '<span class="item"><span class="dot ok"></span>Saudável <span class="n">' + m.ok + '</span></span>' +
        '<span class="item"><span class="dot warn"></span>Atenção <span class="n">' + m.warn + '</span></span>' +
        '<span class="item"><span class="dot crit"></span>Crítico <span class="n">' + m.crit + '</span></span>' +
      '</div>';
  }

  function renderCoverageCard(m) {
    const el = document.getElementById('dashCoverage');
    if (!el) return;
    if (m.avgCoverage == null) {
      el.innerHTML = '<div class="empty-state">Sem dados de consumo suficientes ainda.</div>';
      return;
    }
    el.innerHTML = '<div class="coverage-big">' + m.avgCoverage.toFixed(1).replace('.', ',') + '<span class="unit-lbl">meses</span></div>' +
      '<div class="card-sub">média entre os itens com consumo médio mensal e contagem cadastrados</div>';
  }

  function renderCategoryCards(m) {
    const el = document.getElementById('dashCategories');
    if (!el) return;
    const cats = Object.keys(m.byCat).sort(function (a, b) {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    if (!cats.length) { el.innerHTML = '<div class="empty-state">Nenhuma categoria cadastrada ainda.</div>'; return; }
    el.innerHTML = cats.map(function (cat) {
      const info = m.byCat[cat];
      const cls = CAT_CLASS[cat] || 'outro';
      return '<button class="cat-card" type="button" data-cat="' + escapeHtml(cat) + '">' +
        '<span class="cat-head"><span class="cat-dot" style="background:var(--cat-' + cls + ', var(--text-muted))"></span>' + escapeHtml(cat) + '</span>' +
        '<span class="cat-count mono">' + info.total + '</span>' +
        '<span class="cat-detail">' + info.crit + (info.crit === 1 ? ' item crítico' : ' itens críticos') + '</span>' +
        '</button>';
    }).join('');
  }

  function renderCriticalTable() {
    const el = document.getElementById('dashCritical');
    if (!el) return;
    const rows = state.products.filter(function (p) { return classifyProduct(p) === 'crit'; })
      .map(function (p) {
        const c = state.counts[p.code];
        const cov = (c && c.qty != null && p.avgConsumption > 0) ? (c.qty / p.avgConsumption) : null;
        return { p: p, cov: cov, qty: c && c.qty != null ? c.qty : null };
      })
      .sort(function (a, b) {
        const av = a.cov == null ? -1 : a.cov, bv = b.cov == null ? -1 : b.cov;
        return av - bv;
      })
      .slice(0, 8);
    if (!rows.length) { el.innerHTML = '<div class="empty-state">Nenhum item crítico agora.</div>'; return; }
    el.innerHTML = '<div class="table-scroll mini"><table><thead><tr><th>Código</th><th>Descrição</th><th>Atual</th><th>Segurança</th><th>Cobertura</th></tr></thead><tbody>' +
      rows.map(function (r) {
        const covText = r.cov == null ? '—' : (r.cov.toFixed(1).replace('.', ',') + ' m');
        return '<tr><td class="code mono">' + escapeHtml(r.p.code) + '</td><td class="desc">' + escapeHtml(r.p.name) + '</td>' +
          '<td class="num-cell mono">' + (r.qty == null ? '—' : r.qty) + '</td><td class="num-cell mono">' + (r.p.minStock || 0) + '</td>' +
          '<td class="coverage crit">' + covText + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderDonut(m) {
    const el = document.getElementById('dashDonut');
    if (!el) return;
    const total = m.total || 0;
    if (!total) { el.innerHTML = '<div class="empty-state">Sem dados ainda.</div>'; return; }
    const r = 46, circumference = 2 * Math.PI * r;
    let offset = 0;
    function seg(count, color) {
      const len = circumference * (count / total);
      const rotate = (offset / circumference) * 360 - 90;
      offset += len;
      return '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="16" ' +
        'stroke-dasharray="' + len + ' ' + (circumference - len) + '" transform="rotate(' + rotate + ' 60 60)"></circle>';
    }
    const svg = '<svg width="120" height="120" viewBox="0 0 120 120">' +
      '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="var(--surface-2)" stroke-width="16"></circle>' +
      (m.ok ? seg(m.ok, 'var(--ok)') : '') +
      (m.warn ? seg(m.warn, 'var(--warn)') : '') +
      (m.crit ? seg(m.crit, 'var(--danger)') : '') +
      '</svg>';
    el.innerHTML = '<div class="donut-wrap">' + svg +
      '<div class="donut-legend">' +
        '<span class="item"><span class="dot ok"></span>Saudável — ' + Math.round((m.ok / total) * 100) + '%</span>' +
        '<span class="item"><span class="dot warn"></span>Atenção — ' + Math.round((m.warn / total) * 100) + '%</span>' +
        '<span class="item"><span class="dot crit"></span>Crítico — ' + Math.round((m.crit / total) * 100) + '%</span>' +
      '</div></div>';
  }

  function renderTopConsumption() {
    const el = document.getElementById('dashTopConsumption');
    if (!el) return;
    const items = state.products.filter(function (p) { return (p.avgConsumption || 0) > 0; })
      .sort(function (a, b) { return (b.avgConsumption || 0) - (a.avgConsumption || 0); })
      .slice(0, 5);
    if (!items.length) { el.innerHTML = '<div class="empty-state">Nenhum item com consumo médio cadastrado.</div>'; return; }
    const max = items[0].avgConsumption || 1;
    el.innerHTML = items.map(function (p) {
      const pct = Math.max(4, Math.round((p.avgConsumption / max) * 100));
      return '<div class="bl-row"><span class="bl-code mono">' + escapeHtml(p.code) + '</span>' +
        '<span class="bl-track"><span class="bl-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="bl-val mono">' + p.avgConsumption + '</span></div>';
    }).join('');
  }

  // ---------------- estoque page ----------------

  function render() {
    syncControlsWithState();
    renderSubtitle();
    renderKpis();
    renderSections();
    renderDashboard();
  }

  function syncControlsWithState() {
    const sf = document.getElementById('stateFilter');
    if (sf && sf.value !== state.stateFilter) sf.value = state.stateFilter;
  }

  function renderSubtitle() {
    document.getElementById('subtitle').textContent =
      state.products.length + ' itens no catálogo · ' + unitLabel(state.unit) + ' · referência: ' + monthLabel(state.month);
  }

  function kpiTile(filterValue, value, label, warn) {
    const active = state.stateFilter === filterValue;
    const cls = 'kpi' + (warn ? ' warn' : '') + (active ? ' kpi-active' : '');
    return '<div class="' + cls + '" data-filter="' + filterValue + '" role="button" tabindex="0">' +
      '<div class="num mono">' + value + '</div><div class="label">' + label + '</div></div>';
  }

  function renderKpis() {
    const total = state.products.length;
    let counted = 0, belowMin = 0, criticalCoverage = 0, zeroCount = 0;
    state.products.forEach(function (p) {
      const c = state.counts[p.code];
      if (c && c.qty != null) {
        counted++;
        if (c.qty < (p.minStock || 0)) belowMin++;
        if (p.avgConsumption > 0 && (c.qty / p.avgConsumption) < 1) criticalCoverage++;
        if (c.qty === 0) zeroCount++;
      }
    });
    const pending = total - counted;
    const el = document.getElementById('kpis');
    el.innerHTML =
      kpiTile('all', total, 'Itens no catálogo', false) +
      kpiTile('all', counted, 'Contados em ' + monthShort(state.month), false) +
      kpiTile('uncounted', pending, 'Ainda sem contagem', pending > 0) +
      kpiTile('critical', belowMin, 'Abaixo da segurança', belowMin > 0) +
      kpiTile('coverage', criticalCoverage, 'Cobertura &lt; 1 mês', criticalCoverage > 0) +
      kpiTile('zero', zeroCount, 'Zerados', zeroCount > 0);
  }

  function renderSections() {
    const container = document.getElementById('sections');

    // Preserva o campo em edição quando a tabela é redesenhada (ex.: alguém
    // salvou uma contagem em outro computador enquanto você digitava).
    const active = document.activeElement;
    let focusInfo = null;
    if (active && container.contains(active) && active.dataset && active.dataset.role && active.dataset.code) {
      focusInfo = { role: active.dataset.role, code: active.dataset.code, value: active.value };
    }

    const products = filteredProducts();
    if (state.products.length === 0) {
      container.innerHTML = '<div class="section"><div class="empty-state">Nenhum produto cadastrado ainda no catálogo.</div></div>';
      return;
    }
    if (products.length === 0) {
      container.innerHTML = '<div class="section"><div class="empty-state">Nenhum item corresponde ao filtro atual.</div></div>';
      return;
    }
    const byCat = {};
    products.forEach(function (p) {
      (byCat[p.category] = byCat[p.category] || []).push(p);
    });
    const cats = Object.keys(byCat).sort(function (a, b) {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    container.innerHTML = cats.map(function (cat) {
      return renderSection(cat, byCat[cat].sort(compareProducts));
    }).join('');

    if (focusInfo) {
      const sel = '[data-role="' + focusInfo.role + '"][data-code="' + (window.CSS && CSS.escape ? CSS.escape(focusInfo.code) : focusInfo.code) + '"]';
      const el = container.querySelector(sel);
      if (el) { el.value = focusInfo.value; el.focus(); }
    }
    updateStickyOffset();
  }

  function renderSection(cat, items) {
    const cls = CAT_CLASS[cat] || 'outro';
    const collapsed = !!state.collapsedCats[cat];
    const rows = items.map(renderRow).join('');
    return (
      '<div class="section">' +
        '<div class="section-head" role="button" tabindex="0" aria-expanded="' + (!collapsed) + '" ' +
          'data-role="toggle-cat" data-cat="' + escapeHtml(cat) + '">' +
          '<span class="cat-dot" style="background: var(--cat-' + cls + ', var(--text-muted))"></span>' +
          '<h2>' + escapeHtml(cat) + '</h2>' +
          '<span class="count">' + items.length + ' itens</span>' +
          '<span class="chevron">▾</span>' +
        '</div>' +
        (collapsed ? '' :
        '<div class="table-scroll">' +
          '<table>' +
            '<thead><tr>' +
              '<th>Código</th><th>Descrição</th><th>Un.</th><th>Segurança</th><th>Consumo/mês</th><th>Contado</th><th>Cobertura</th><th>Situação</th><th>Última contagem</th><th></th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>') +
      '</div>'
    );
  }

  function renderRow(p) {
    const c = state.counts[p.code];
    const min = p.minStock || 0;
    const consumption = p.avgConsumption || 0;
    const qtyVal = c && c.qty != null ? c.qty : '';
    let badge = '<span class="badge neutral"><span class="dot"></span>sem contagem</span>';
    if (c && c.qty != null) {
      if (c.qty === 0) badge = '<span class="badge zero"><span class="dot"></span>zerado</span>';
      else if (c.qty < min) badge = '<span class="badge danger"><span class="dot"></span>abaixo da segurança</span>';
      else badge = '<span class="badge ok"><span class="dot"></span>ok</span>';
    }
    const rowClass = (c && c.qty === 0) ? ' class="row-zero"' : '';
    let coverageHtml = '<span class="coverage muted">—</span>';
    if (c && c.qty != null && consumption > 0) {
      const months = c.qty / consumption;
      const cls = months < 1 ? 'crit' : (months < 2 ? '' : 'muted');
      coverageHtml = '<span class="coverage ' + cls + '">' + months.toFixed(1).replace('.', ',') + ' meses</span>';
    }
    const lastDate = c && c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('pt-BR') : '—';
    const hist = state.openHistory[p.code];
    let histRow = '';
    if (hist !== undefined) {
      let body;
      if (hist === 'loading') {
        body = '<span class="hist-empty">Carregando histórico…</span>';
      } else if (!hist.length) {
        body = '<span class="hist-empty">Sem contagens anteriores registradas.</span>';
      } else {
        body = '<div class="hist-list">' + hist.map(function (h) {
          return '<span><span class="m">' + monthShort(h.month) + ':</span> <span class="mono">' + (h.qty == null ? '—' : h.qty) + '</span></span>';
        }).join('') + '</div>';
      }
      histRow = '<tr class="hist-row"><td colspan="10">' + body + '</td></tr>';
    }
    return (
      '<tr' + rowClass + '>' +
        '<td class="code mono">' + escapeHtml(p.code) + '</td>' +
        '<td class="desc">' + escapeHtml(p.name) + '</td>' +
        '<td class="unit">' + escapeHtml(p.unit || '') + '</td>' +
        '<td class="num-cell"><input class="num-input" type="number" min="0" step="1" value="' + min + '" aria-label="Estoque de segurança de ' + escapeHtml(p.name) + '" data-role="minstock" data-code="' + escapeHtml(p.code) + '"></td>' +
        '<td class="num-cell"><input class="num-input" type="number" min="0" step="1" value="' + consumption + '" aria-label="Consumo médio mensal de ' + escapeHtml(p.name) + '" data-role="consumption" data-code="' + escapeHtml(p.code) + '"></td>' +
        '<td class="num-cell"><input class="num-input qty" type="number" min="0" step="1" value="' + qtyVal + '" placeholder="—" aria-label="Quantidade contada de ' + escapeHtml(p.name) + '" data-role="qty" data-code="' + escapeHtml(p.code) + '"></td>' +
        '<td class="num-cell">' + coverageHtml + '</td>' +
        '<td>' + badge + '</td>' +
        '<td class="last-count">' + lastDate + '</td>' +
        '<td><button class="hist-btn" type="button" data-role="history" data-code="' + escapeHtml(p.code) + '">' + (hist !== undefined ? 'ocultar' : 'histórico') + '</button></td>' +
      '</tr>' + histRow
    );
  }

  init();
})();
