// Página Configurações (somente administradores): catálogo, cópia de catálogo,
// importação de planilha, unidades e usuários. Usa a interface window.EstoqueApp
// exposta por app.js.
(function () {
  const App = window.EstoqueApp;
  const esc = App.escapeHtml;
  const CODE_RE = /^[A-Za-z0-9_\-.~:@+]+$/;
  const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  const st = {
    tab: loadTab(),
    wired: false,
    catUnit: null,
    catItems: [],
    catSearch: '',
    editing: null,      // item em edição
    imp: null,          // { rows, unit } pré-visualização da importação
    unitCounts: {},
  };

  function $(id) { return document.getElementById(id); }
  function loadTab() { try { return localStorage.getItem('estoqueWapSettingsTab') || 'catalogo'; } catch (e) { return 'catalogo'; } }
  function saveTab(t) { try { localStorage.setItem('estoqueWapSettingsTab', t); } catch (e) { /* ignore */ } }
  function fmtNum(n) { return n == null ? '' : String(n).replace('.', ','); }
  function feedback(id, msg, keep) {
    const el = $(id);
    el.textContent = msg || '';
    if (msg && !keep) setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 5000);
  }
  function showErr(id, msg) { const el = $(id); el.textContent = msg; el.hidden = !msg; }
  function catSort(a, b) {
    const ia = App.catOrder.indexOf(a), ib = App.catOrder.indexOf(b);
    return ((ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)) || a.localeCompare(b);
  }
  function unitOptions(selected, exclude) {
    return App.units.filter(function (u) { return u.id !== exclude; }).map(function (u) {
      return '<option value="' + esc(u.id) + '"' + (u.id === selected ? ' selected' : '') + '>' + esc(u.label) + '</option>';
    }).join('');
  }
  function rowToItem(r) {
    return { code: r.code, name: r.name, category: r.category, unit: r.unit || '', minStock: Number(r.min_stock) || 0, avgConsumption: Number(r.avg_consumption) || 0 };
  }
  function parseNum(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    const t = String(v).trim().replace(/\s/g, '');
    if (!t) return 0;
    // aceita 1.234,5 / 1234,5 / 1234.5
    const norm = /,\d*$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t;
    const n = Number(norm);
    return isNaN(n) ? NaN : n;
  }
  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const CSV_HEADER = ['Código', 'Descrição', 'Categoria', 'Unidade', 'Estoque de segurança', 'Consumo médio'];

  // ================= abas =================

  function open() {
    if (!App.isAdmin) return;
    wire();
    selectTab(st.tab);
  }

  function selectTab(tab) {
    st.tab = tab; saveTab(tab);
    document.querySelectorAll('#settingsTabs .tab').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    document.querySelectorAll('#page-configuracoes .tab-panel').forEach(function (p) {
      p.hidden = p.dataset.panel !== tab;
    });
    if (tab === 'catalogo') openCatalog();
    else if (tab === 'copiar') openCopy();
    else if (tab === 'importar') openImport();
    else if (tab === 'unidades') openUnits();
    else if (tab === 'usuarios') App.loadMembers();
  }

  function wire() {
    if (st.wired) return;
    st.wired = true;
    $('settingsTabs').addEventListener('click', function (e) {
      const b = e.target.closest('[data-tab]');
      if (b) selectTab(b.dataset.tab);
    });
    document.addEventListener('click', function (e) {
      const c = e.target.closest('[data-close]');
      if (c) $(c.dataset.close).hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { $('catEditOverlay').hidden = true; $('catRenameOverlay').hidden = true; }
    });

    // catálogo
    $('catUnit').addEventListener('change', function (e) { st.catUnit = e.target.value; loadCatalog(); });
    $('catSearch').addEventListener('input', function (e) { st.catSearch = e.target.value.trim().toLowerCase(); renderCatalog(); });
    $('catBody').addEventListener('click', onCatalogClick);
    $('catEditForm').addEventListener('submit', onEditSubmit);
    $('catRenameBtn').addEventListener('click', openRename);
    $('catRenameForm').addEventListener('submit', onRenameSubmit);
    $('catExportBtn').addEventListener('click', exportCatalog);

    // copiar
    $('copyFrom').addEventListener('change', function () { renderCopyTargets(); updateCopyPreview(); });
    $('copyTo').addEventListener('change', updateCopyPreview);
    $('copyOverwrite').addEventListener('change', updateCopyPreview);
    $('copyBtn').addEventListener('click', runCopy);

    // importar
    $('impFile').addEventListener('change', onImportFile);
    $('impUnit').addEventListener('change', function () { if (st.imp) buildImportPreview(st.imp.raw); });
    $('impUpdate').addEventListener('change', function () { if (st.imp) buildImportPreview(st.imp.raw); });
    $('impTemplateBtn').addEventListener('click', function () {
      const lines = [CSV_HEADER.join(';'), 'A15;Café Extra Forte 500g;Alimento;UN;93;75', 'L40;Desinfetante 5L;Limpeza;UN;2;2'];
      downloadFile('modelo-catalogo-estoque.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    });
    $('impBtn').addEventListener('click', runImport);

    // unidades
    $('unitsBody').addEventListener('click', onUnitsClick);
    $('newUnitLabel').addEventListener('input', function (e) {
      if ($('newUnitId').dataset.touched) return;
      $('newUnitId').value = slugUnit(e.target.value.replace(/^\s*WAP\s+UN\.?\s*/i, ''));
    });
    $('newUnitId').addEventListener('input', function (e) { e.target.dataset.touched = '1'; });
    $('addUnitBtn').addEventListener('click', addUnit);
  }

  // ================= Catálogo =================

  function openCatalog() {
    if (!st.catUnit || !App.units.some(function (u) { return u.id === st.catUnit; })) st.catUnit = App.currentUnit;
    $('catUnit').innerHTML = unitOptions(st.catUnit);
    loadCatalog();
  }

  async function loadCatalog() {
    const unit = st.catUnit;
    $('catBody').innerHTML = '<tr><td colspan="7" class="empty-state">Carregando…</td></tr>';
    const { data, error } = await App.sb.from('products').select('*').eq('unit_id', unit).order('code');
    if (unit !== st.catUnit) return;
    if (error) { $('catBody').innerHTML = '<tr><td colspan="7" class="empty-state">Erro: ' + esc(error.message) + '</td></tr>'; return; }
    st.catItems = (data || []).map(rowToItem);
    renderCatalog();
  }

  function renderCatalog() {
    const q = st.catSearch;
    const items = st.catItems.filter(function (p) { return !q || (p.code + ' ' + p.name + ' ' + p.category).toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return catSort(a.category, b.category) || a.code.localeCompare(b.code); });
    if (!st.catItems.length) {
      $('catBody').innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum item nesta unidade. Use <strong>Copiar catálogo</strong> ou <strong>Importar planilha</strong> para começar.</td></tr>';
      return;
    }
    if (!items.length) { $('catBody').innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum item encontrado.</td></tr>'; return; }
    $('catBody').innerHTML = items.map(function (p) {
      return '<tr>' +
        '<td class="code mono">' + esc(p.code) + '</td>' +
        '<td>' + esc(p.name) + '</td>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td class="unit">' + esc(p.unit) + '</td>' +
        '<td class="num">' + fmtNum(p.minStock) + '</td>' +
        '<td class="num">' + fmtNum(p.avgConsumption) + '</td>' +
        '<td><div class="actions">' +
          '<button class="hist-btn" type="button" data-act="edit" data-code="' + esc(p.code) + '">editar</button>' +
          '<button class="hist-btn danger" type="button" data-act="delete" data-code="' + esc(p.code) + '">excluir</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function onCatalogClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const item = st.catItems.find(function (p) { return p.code === b.dataset.code; });
    if (!item) return;
    if (b.dataset.act === 'edit') openEdit(item);
    else deleteItem(item, b);
  }

  function openEdit(item) {
    st.editing = item;
    $('catEditSub').textContent = App.unitLabel(st.catUnit);
    $('ceCode').value = item.code;
    $('ceName').value = item.name;
    $('ceCategory').value = item.category;
    $('ceUnit').value = item.unit;
    $('ceMin').value = item.minStock;
    $('ceAvg').value = item.avgConsumption;
    const cats = Array.from(new Set(App.catOrder.concat(st.catItems.map(function (p) { return p.category; })))).sort(catSort);
    $('ceCategoryList').innerHTML = cats.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join('');
    showErr('catEditError', '');
    $('catEditFeedback').textContent = '';
    $('catEditOverlay').hidden = false;
    setTimeout(function () { $('ceName').focus(); }, 0);
  }

  async function onEditSubmit(e) {
    e.preventDefault();
    const old = st.editing;
    if (!old) return;
    const next = {
      code: $('ceCode').value.trim().toUpperCase(),
      name: $('ceName').value.trim(),
      category: $('ceCategory').value.trim(),
      unit: $('ceUnit').value.trim(),
      minStock: parseNum($('ceMin').value),
      avgConsumption: parseNum($('ceAvg').value),
    };
    if (!next.code || !CODE_RE.test(next.code)) return showErr('catEditError', 'Código inválido: use letras, números e _ - . sem espaços.');
    if (!next.name) return showErr('catEditError', 'Informe a descrição.');
    if (!next.category) return showErr('catEditError', 'Informe a categoria.');
    if (isNaN(next.minStock) || next.minStock < 0) return showErr('catEditError', 'Estoque de segurança inválido.');
    if (isNaN(next.avgConsumption) || next.avgConsumption < 0) return showErr('catEditError', 'Consumo médio inválido.');
    if (next.code !== old.code && st.catItems.some(function (p) { return p.code === next.code; })) {
      return showErr('catEditError', 'Já existe um item com o código "' + next.code + '" nesta unidade.');
    }
    const changes = [];
    if (next.code !== old.code) changes.push('código ' + old.code + ' → ' + next.code);
    if (next.name !== old.name) changes.push('descrição');
    if (next.category !== old.category) changes.push('categoria ' + old.category + ' → ' + next.category);
    if (next.unit !== old.unit) changes.push('unidade ' + (old.unit || '—') + ' → ' + (next.unit || '—'));
    if (next.minStock !== old.minStock) changes.push('segurança ' + fmtNum(old.minStock) + ' → ' + fmtNum(next.minStock));
    if (next.avgConsumption !== old.avgConsumption) changes.push('consumo ' + fmtNum(old.avgConsumption) + ' → ' + fmtNum(next.avgConsumption));
    if (!changes.length) { $('catEditOverlay').hidden = true; return; }

    $('catEditSave').disabled = true;
    $('catEditFeedback').textContent = 'Salvando…';
    const unit = st.catUnit;
    const { error } = await App.sb.from('products').update({
      code: next.code, name: next.name, category: next.category, unit: next.unit,
      min_stock: next.minStock, avg_consumption: next.avgConsumption,
    }).eq('unit_id', unit).eq('code', old.code);
    $('catEditSave').disabled = false;
    $('catEditFeedback').textContent = '';
    if (error) {
      return showErr('catEditError', error.code === '23505' ? ('Já existe um item com o código "' + next.code + '".') : ('Não foi possível salvar: ' + error.message));
    }
    $('catEditOverlay').hidden = true;
    App.logActivity(unit, 'edit', next.code, changes.join('; '), next.name);
    feedback('catFeedback', 'Item ' + next.code + ' atualizado.');
    loadCatalog();
    if (unit === App.currentUnit) App.reloadProducts();
  }

  async function deleteItem(item, btn) {
    const unit = st.catUnit;
    const { count } = await App.sb.from('counts').select('code', { count: 'exact', head: true })
      .eq('unit_id', unit).eq('code', item.code).not('qty', 'is', null);
    const hist = count ? ('\n\nAtenção: ' + count + (count === 1 ? ' contagem registrada deste item também será apagada.' : ' contagens registradas deste item também serão apagadas.')) : '';
    if (!window.confirm('Excluir ' + item.code + ' — ' + item.name + ' de ' + App.unitLabel(unit) + '?' + hist + '\n\nIsso não pode ser desfeito.')) return;
    btn.disabled = true;
    const { error } = await App.sb.from('products').delete().eq('unit_id', unit).eq('code', item.code);
    if (error) { btn.disabled = false; feedback('catFeedback', 'Não foi possível excluir: ' + error.message, true); return; }
    App.logActivity(unit, 'delete', item.code, item.category, item.name);
    feedback('catFeedback', 'Item ' + item.code + ' excluído.');
    loadCatalog();
    if (unit === App.currentUnit) App.reloadProducts();
  }

  function openRename() {
    const cats = Array.from(new Set(st.catItems.map(function (p) { return p.category; }))).sort(catSort);
    if (!cats.length) { feedback('catFeedback', 'Esta unidade ainda não tem categorias.'); return; }
    $('crFrom').innerHTML = cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    $('crTo').value = '';
    showErr('catRenameError', '');
    $('catRenameFeedback').textContent = '';
    $('catRenameOverlay').hidden = false;
    setTimeout(function () { $('crTo').focus(); }, 0);
  }

  async function onRenameSubmit(e) {
    e.preventDefault();
    const from = $('crFrom').value;
    const to = $('crTo').value.trim();
    if (!to) return showErr('catRenameError', 'Informe o novo nome.');
    if (to === from) { $('catRenameOverlay').hidden = true; return; }
    let q = App.sb.from('products').update({ category: to }).eq('category', from);
    if (!$('crAllUnits').checked) q = q.eq('unit_id', st.catUnit);
    $('catRenameFeedback').textContent = 'Salvando…';
    const { data, error } = await q.select('unit_id');
    $('catRenameFeedback').textContent = '';
    if (error) return showErr('catRenameError', 'Não foi possível renomear: ' + error.message);
    $('catRenameOverlay').hidden = true;
    feedback('catFeedback', 'Categoria "' + from + '" renomeada para "' + to + '" em ' + (data ? data.length : 0) + ' itens.');
    loadCatalog();
    App.reloadProducts();
  }

  function exportCatalog() {
    const items = st.catItems.slice().sort(function (a, b) { return catSort(a.category, b.category) || a.code.localeCompare(b.code); });
    const lines = [CSV_HEADER.join(';')].concat(items.map(function (p) {
      return [p.code, p.name, p.category, p.unit, fmtNum(p.minStock), fmtNum(p.avgConsumption)].map(csvCell).join(';');
    }));
    downloadFile('catalogo-' + st.catUnit.toLowerCase() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ================= Copiar catálogo =================

  function openCopy() {
    const from = $('copyFrom').value || App.currentUnit;
    $('copyFrom').innerHTML = unitOptions(from);
    renderCopyTargets();
    updateCopyPreview();
  }

  function renderCopyTargets() {
    const from = $('copyFrom').value;
    $('copyTo').innerHTML = App.units.filter(function (u) { return u.id !== from; }).map(function (u) {
      return '<label><input type="checkbox" value="' + esc(u.id) + '"> ' + esc(u.label) + '</label>';
    }).join('') || '<span class="cfg-help">Não há outras unidades.</span>';
  }

  function copyTargets() {
    return Array.from($('copyTo').querySelectorAll('input:checked')).map(function (i) { return i.value; });
  }

  let copyPreviewToken = 0;
  async function updateCopyPreview() {
    const token = ++copyPreviewToken;
    const from = $('copyFrom').value;
    const targets = copyTargets();
    const el = $('copyPreview');
    if (!targets.length) { el.textContent = 'Escolha pelo menos uma unidade de destino.'; return; }
    el.textContent = 'Calculando…';
    const { data, error } = await App.sb.from('products').select('unit_id, code').in('unit_id', [from].concat(targets));
    if (token !== copyPreviewToken) return;
    if (error) { el.textContent = 'Erro: ' + error.message; return; }
    const src = new Set(data.filter(function (r) { return r.unit_id === from; }).map(function (r) { return r.code; }));
    const overwrite = $('copyOverwrite').checked;
    el.innerHTML = '<strong>' + src.size + ' itens</strong> em ' + esc(App.unitLabel(from)) + '.<br>' + targets.map(function (t) {
      const existing = new Set(data.filter(function (r) { return r.unit_id === t; }).map(function (r) { return r.code; }));
      let novos = 0, iguais = 0;
      src.forEach(function (c) { if (existing.has(c)) iguais++; else novos++; });
      return esc(App.unitLabel(t)) + ': ' + novos + ' novos' + (iguais ? (', ' + iguais + (overwrite ? ' serão sobrescritos' : ' já existem e serão mantidos')) : '');
    }).join('<br>');
  }

  async function runCopy() {
    const from = $('copyFrom').value;
    const targets = copyTargets();
    if (!targets.length) { feedback('copyFeedback', 'Escolha pelo menos uma unidade de destino.'); return; }
    const withParams = $('copyParams').checked;
    const overwrite = $('copyOverwrite').checked;
    if (!window.confirm('Copiar o catálogo de ' + App.unitLabel(from) + ' para ' + targets.map(App.unitLabel).join(', ') + '?')) return;
    const { data, error } = await App.sb.from('products').select('*').eq('unit_id', from);
    if (error) { feedback('copyFeedback', 'Erro ao ler a origem: ' + error.message, true); return; }
    if (!data.length) { feedback('copyFeedback', 'A unidade de origem não tem itens.'); return; }
    $('copyBtn').disabled = true;
    feedback('copyFeedback', 'Copiando…', true);
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const rows = data.map(function (r) {
        return { unit_id: t, code: r.code, name: r.name, category: r.category, unit: r.unit,
          min_stock: withParams ? r.min_stock : 0, avg_consumption: withParams ? r.avg_consumption : 0 };
      });
      const res = await App.sb.from('products').upsert(rows, { onConflict: 'unit_id,code', ignoreDuplicates: !overwrite }).select('code');
      if (res.error) { results.push(App.unitLabel(t) + ': erro (' + res.error.message + ')'); continue; }
      const n = res.data ? res.data.length : 0;
      results.push(App.unitLabel(t) + ': ' + n + ' itens');
      App.logActivity(t, 'copy', '*', n + ' itens', 'de ' + App.unitLabel(from));
    }
    $('copyBtn').disabled = false;
    feedback('copyFeedback', 'Concluído — ' + results.join(' · '), true);
    updateCopyPreview();
    if (targets.indexOf(App.currentUnit) !== -1) App.reloadProducts();
  }

  // ================= Importar planilha =================

  function openImport() {
    const u = $('impUnit').value || App.currentUnit;
    $('impUnit').innerHTML = unitOptions(u);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('Falha ao carregar ' + src)); };
      document.head.appendChild(s);
    });
  }

  function decodeText(buf) {
    const utf8 = new TextDecoder('utf-8').decode(buf);
    return utf8.indexOf('�') === -1 ? utf8 : new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel em português
  }

  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const delim = [';', ',', '\t'].map(function (d) { return [d, first.split(d).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function readSheet(file) {
    const buf = await file.arrayBuffer();
    if (/\.(csv|txt)$/i.test(file.name)) return parseCsv(decodeText(buf));
    if (!window.XLSX) await loadScript(XLSX_URL);
    const wb = window.XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  }

  function norm(h) {
    return String(h || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  const HEADER_MAP = {
    code: ['codigo', 'cod', 'code', 'codigodoproduto', 'codproduto', 'sku'],
    name: ['descricao', 'produto', 'nome', 'item', 'name', 'descricaodoproduto'],
    category: ['categoria', 'category', 'grupo'],
    unit: ['unidade', 'un', 'und', 'um', 'unidadedemedida', 'unit', 'medida'],
    minStock: ['estoquedeseguranca', 'seguranca', 'estoqueminimo', 'minimo', 'min', 'minstock', 'estseguranca'],
    avgConsumption: ['consumomedio', 'consumomediomensal', 'consumo', 'consumomes', 'avgconsumption', 'consumomensal'],
  };

  async function onImportFile(e) {
    const file = e.target.files[0];
    $('impPreview').innerHTML = '';
    $('impBtn').disabled = true;
    st.imp = null;
    if (!file) return;
    feedback('impFeedback', 'Lendo arquivo…', true);
    let raw;
    try { raw = await readSheet(file); } catch (ex) { feedback('impFeedback', 'Não foi possível ler o arquivo: ' + ex.message, true); return; }
    feedback('impFeedback', '');
    buildImportPreview(raw);
  }

  async function buildImportPreview(raw) {
    st.imp = { raw: raw };
    const rows = (raw || []).filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (!rows.length) { $('impPreview').innerHTML = '<div class="item-error">A planilha está vazia.</div>'; return; }
    // acha a linha de cabeçalho (primeira com a coluna de código)
    let hIdx = rows.findIndex(function (r) { return r.some(function (c) { return HEADER_MAP.code.indexOf(norm(c)) !== -1; }); });
    if (hIdx === -1) {
      $('impPreview').innerHTML = '<div class="item-error">Não encontrei a coluna <strong>Código</strong>. Use o botão <strong>Baixar modelo</strong> para ver o formato esperado.</div>';
      return;
    }
    const header = rows[hIdx].map(norm);
    const col = {};
    Object.keys(HEADER_MAP).forEach(function (k) {
      col[k] = header.findIndex(function (h) { return HEADER_MAP[k].indexOf(h) !== -1; });
    });
    const missing = ['name', 'category'].filter(function (k) { return col[k] === -1; });
    if (missing.length) {
      $('impPreview').innerHTML = '<div class="item-error">Faltam as colunas: <strong>' + missing.map(function (k) { return k === 'name' ? 'Descrição' : 'Categoria'; }).join(', ') + '</strong>.</div>';
      return;
    }

    const unit = $('impUnit').value;
    const { data: existingRows, error } = await App.sb.from('products').select('*').eq('unit_id', unit);
    if (error) { $('impPreview').innerHTML = '<div class="item-error">Erro: ' + esc(error.message) + '</div>'; return; }
    const existing = {};
    existingRows.forEach(function (r) { existing[r.code] = rowToItem(r); });
    const allowUpdate = $('impUpdate').checked;

    const seen = {};
    const items = rows.slice(hIdx + 1).map(function (r, i) {
      function get(k) { return col[k] === -1 ? '' : r[col[k]]; }
      const it = {
        line: hIdx + i + 2,
        code: String(get('code')).trim().toUpperCase(),
        name: String(get('name')).trim(),
        category: String(get('category')).trim(),
        unit: String(get('unit')).trim(),
        minStock: parseNum(get('minStock')),
        avgConsumption: parseNum(get('avgConsumption')),
      };
      const errs = [];
      if (!it.code) errs.push('sem código');
      else if (!CODE_RE.test(it.code)) errs.push('código com espaço ou símbolo inválido');
      if (!it.name) errs.push('sem descrição');
      if (!it.category) errs.push('sem categoria');
      if (isNaN(it.minStock) || it.minStock < 0) errs.push('segurança inválida');
      if (isNaN(it.avgConsumption) || it.avgConsumption < 0) errs.push('consumo inválido');
      if (it.code && seen[it.code]) errs.push('código repetido (linha ' + seen[it.code] + ')');
      if (it.code) seen[it.code] = seen[it.code] || it.line;
      if (errs.length) { it.status = 'erro'; it.error = errs.join(', '); return it; }
      const ex = existing[it.code];
      if (!ex) it.status = 'novo';
      else if (ex.name === it.name && ex.category === it.category && ex.unit === it.unit && ex.minStock === it.minStock && ex.avgConsumption === it.avgConsumption) it.status = 'igual';
      else it.status = allowUpdate ? 'atualizar' : 'ignorar';
      return it;
    }).filter(function (it) { return it.code || it.name || it.category; });

    st.imp.items = items;
    st.imp.unit = unit;
    const c = { novo: 0, atualizar: 0, igual: 0, ignorar: 0, erro: 0 };
    items.forEach(function (it) { c[it.status]++; });
    const toWrite = c.novo + c.atualizar;
    const label = { novo: 'novo', atualizar: 'atualizar', igual: 'sem mudança', ignorar: 'já existe (ignorado)', erro: 'erro' };
    const badge = { novo: 'ok', atualizar: 'neutral', igual: 'neutral', ignorar: 'neutral', erro: 'danger' };
    $('impPreview').innerHTML =
      '<div class="imp-summary">' +
        '<span class="badge ok">' + c.novo + ' novos</span>' +
        '<span class="badge neutral">' + c.atualizar + ' a atualizar</span>' +
        '<span class="badge neutral">' + c.igual + ' sem mudança</span>' +
        (c.ignorar ? '<span class="badge neutral">' + c.ignorar + ' ignorados</span>' : '') +
        (c.erro ? '<span class="badge danger">' + c.erro + ' com erro (não serão importados)</span>' : '') +
      '</div>' +
      '<div class="imp-scroll"><table class="imp-table"><thead><tr><th>Linha</th><th>Situação</th><th>Código</th><th>Descrição</th><th>Categoria</th><th>Un.</th><th>Segurança</th><th>Consumo</th></tr></thead><tbody>' +
      items.map(function (it) {
        return '<tr' + (it.status === 'erro' ? ' class="err"' : '') + '>' +
          '<td class="mono">' + it.line + '</td>' +
          '<td><span class="badge ' + badge[it.status] + '">' + label[it.status] + '</span>' + (it.error ? '<div class="activity-context">' + esc(it.error) + '</div>' : '') + '</td>' +
          '<td class="mono">' + esc(it.code) + '</td><td>' + esc(it.name) + '</td><td>' + esc(it.category) + '</td><td>' + esc(it.unit) + '</td>' +
          '<td class="mono">' + (isNaN(it.minStock) ? '?' : fmtNum(it.minStock)) + '</td><td class="mono">' + (isNaN(it.avgConsumption) ? '?' : fmtNum(it.avgConsumption)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('impBtn').disabled = toWrite === 0;
    $('impBtn').textContent = toWrite ? ('Importar ' + toWrite + ' itens para ' + App.unitLabel(unit)) : 'Nada para importar';
  }

  async function runImport() {
    const imp = st.imp;
    if (!imp || !imp.items) return;
    const rows = imp.items.filter(function (it) { return it.status === 'novo' || it.status === 'atualizar'; }).map(function (it) {
      return { unit_id: imp.unit, code: it.code, name: it.name, category: it.category, unit: it.unit, min_stock: it.minStock, avg_consumption: it.avgConsumption };
    });
    if (!rows.length) return;
    $('impBtn').disabled = true;
    feedback('impFeedback', 'Importando…', true);
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await App.sb.from('products').upsert(rows.slice(i, i + 200), { onConflict: 'unit_id,code' });
      if (error) { feedback('impFeedback', 'Erro na importação: ' + error.message, true); $('impBtn').disabled = false; return; }
    }
    const novos = imp.items.filter(function (it) { return it.status === 'novo'; }).length;
    const upd = rows.length - novos;
    App.logActivity(imp.unit, 'import', '*', novos + ' novos, ' + upd + ' atualizados', '');
    feedback('impFeedback', 'Importado: ' + novos + ' novos e ' + upd + ' atualizados em ' + App.unitLabel(imp.unit) + '.', true);
    $('impFile').value = '';
    $('impPreview').innerHTML = '';
    $('impBtn').textContent = 'Importar';
    st.imp = null;
    if (imp.unit === App.currentUnit) App.reloadProducts();
  }

  // ================= Unidades =================

  function slugUnit(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  }

  async function openUnits() {
    const { data } = await App.sb.from('products').select('unit_id');
    st.unitCounts = {};
    (data || []).forEach(function (r) { st.unitCounts[r.unit_id] = (st.unitCounts[r.unit_id] || 0) + 1; });
    renderUnits();
    const maxSort = App.units.reduce(function (m, u) { return Math.max(m, u.sort || 0); }, 0);
    $('newUnitSort').value = maxSort + 1;
  }

  function renderUnits() {
    $('unitsBody').innerHTML = App.units.map(function (u) {
      return '<tr data-id="' + esc(u.id) + '">' +
        '<td class="code mono">' + esc(u.id) + '</td>' +
        '<td><input class="inline" type="text" maxlength="60" value="' + esc(u.label) + '" data-f="label"></td>' +
        '<td><input class="inline short" type="number" min="0" step="1" value="' + (u.sort || 0) + '" data-f="sort"></td>' +
        '<td class="num">' + (st.unitCounts[u.id] || 0) + '</td>' +
        '<td><div class="actions"><button class="hist-btn" type="button" data-act="save-unit">salvar</button></div></td>' +
        '</tr>';
    }).join('');
  }

  async function onUnitsClick(e) {
    const b = e.target.closest('[data-act="save-unit"]');
    if (!b) return;
    const tr = b.closest('tr');
    const label = tr.querySelector('[data-f="label"]').value.trim();
    const sort = parseInt(tr.querySelector('[data-f="sort"]').value, 10) || 0;
    if (!label) { feedback('unitsFeedback', 'O nome não pode ficar vazio.'); return; }
    b.disabled = true;
    const { error } = await App.sb.from('units').update({ label: label, sort: sort }).eq('id', tr.dataset.id);
    b.disabled = false;
    if (error) { feedback('unitsFeedback', 'Não foi possível salvar: ' + error.message, true); return; }
    await App.loadUnits();
    renderUnits();
    feedback('unitsFeedback', 'Unidade ' + tr.dataset.id + ' atualizada.');
  }

  async function addUnit() {
    const label = $('newUnitLabel').value.trim();
    const id = slugUnit($('newUnitId').value);
    const sort = parseInt($('newUnitSort').value, 10) || 0;
    if (!label) { feedback('unitsFeedback', 'Informe o nome exibido.'); return; }
    if (!id) { feedback('unitsFeedback', 'Informe o código (letras e números).'); return; }
    if (App.units.some(function (u) { return u.id === id; })) { feedback('unitsFeedback', 'Já existe uma unidade com o código ' + id + '.'); return; }
    $('addUnitBtn').disabled = true;
    const { error } = await App.sb.from('units').insert({ id: id, label: label, sort: sort });
    $('addUnitBtn').disabled = false;
    if (error) { feedback('unitsFeedback', 'Não foi possível adicionar: ' + error.message, true); return; }
    $('newUnitLabel').value = ''; $('newUnitId').value = ''; delete $('newUnitId').dataset.touched;
    await App.loadUnits();
    openUnits();
    feedback('unitsFeedback', 'Unidade ' + label + ' criada. Use "Copiar catálogo" para preenchê-la.', true);
  }

  window.EstoqueSettings = { open: open };
})();
