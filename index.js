// TAMANHOS OFICIAIS & COLUNAS
const GRADE_TAMANHOS = ['PP', 'P', 'M', 'G'];
const COLUNAS = ['nao-chegou', 'separado', 'etiquetado', 'enviado'];

let envios = JSON.parse(localStorage.getItem('expedicao_matriz_data_v5')) || [];
let activeEnvioId = null;
let activeItemId = null; // Card aberto no Drawer lateral

function saveState() {
  localStorage.setItem('expedicao_matriz_data_v5', JSON.stringify(envios));
}

// ----------------------------------------------------
// BANCO DE DADOS LOCAL (IndexedDB) PARA ANEXOS DE NF
// ----------------------------------------------------
let db;
const dbRequest = indexedDB.open('ExpedicaoNFDB_v2', 1);

dbRequest.onupgradeneeded = function(e) {
  db = e.target.result;
  if (!db.objectStoreNames.contains('arquivos_nf')) {
    db.createObjectStore('arquivos_nf', { keyPath: 'id' });
  }
};

dbRequest.onsuccess = function(e) {
  db = e.target.result;
  if (activeEnvioId) renderNotasFiscais();
};

function salvarArquivoIndexedDB(id, blob, nomeOriginal, tipo) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['arquivos_nf'], 'readwrite');
    const store = transaction.objectStore('arquivos_nf');
    const item = { id, blob, nomeOriginal, tipo };
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function obterArquivoIndexedDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['arquivos_nf'], 'readonly');
    const store = transaction.objectStore('arquivos_nf');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function removerArquivoIndexedDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['arquivos_nf'], 'readwrite');
    const store = transaction.objectStore('arquivos_nf');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// NAVEGAÇÃO DE TELAS
function switchTab(screenId) {
  document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');

  if (screenId === 'screen-home') document.getElementById('nav-btn-home').classList.add('active');
  if (screenId === 'screen-list') {
    document.getElementById('nav-btn-list').classList.add('active');
    renderListaEnvios();
  }
  if (screenId === 'screen-kanban') {
    document.getElementById('nav-btn-kanban').classList.add('active');
    renderKanban();
  }
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// GESTÃO DE LOTES
function criarNovoLote() {
  const input = document.getElementById('input-nome-lote');
  const nome = input.value.trim();
  if (!nome) return alert('Digite um nome para identificar o envio.');

  const novo = {
    id: 'env_' + Date.now(),
    nome: nome,
    data: new Date().toLocaleDateString('pt-BR'),
    itens: [],
    notasFiscais: []
  };

  envios.unshift(novo);
  saveState();

  input.value = '';
  closeModal('modal-novo-lote');
  carregarEnvioNoKanban(novo.id);
}

function carregarEnvioNoKanban(id) {
  activeEnvioId = id;
  const envio = envios.find(e => e.id === id);
  if (!envio) return;

  if (!envio.notasFiscais) envio.notasFiscais = [];

  document.getElementById('kanban-title').innerText = envio.nome;
  document.getElementById('kanban-subtitle').innerText = `Lote criado em: ${envio.data}`;

  document.getElementById('nav-btn-kanban').style.display = 'inline-block';
  switchTab('screen-kanban');
}

function deletarLote(id) {
  if (!confirm('Deseja excluir este lote e todas as suas peças e NFs?')) return;
  
  const envio = envios.find(e => e.id === id);
  if (envio && envio.notasFiscais) {
    envio.notasFiscais.forEach(nf => {
      if (nf.arquivoId) removerArquivoIndexedDB(nf.arquivoId);
    });
  }

  envios = envios.filter(e => e.id !== id);
  saveState();

  if (activeEnvioId === id) {
    activeEnvioId = null;
    document.getElementById('nav-btn-kanban').style.display = 'none';
    switchTab('screen-list');
  } else {
    renderListaEnvios();
  }
}

function renderListaEnvios() {
  const container = document.getElementById('envios-grid');
  container.innerHTML = '';

  if (envios.length === 0) {
    container.innerHTML = '<p style="color: var(--text-sub); grid-column: 1/-1;">Nenhum envio criado ainda.</p>';
    return;
  }

  envios.forEach(e => {
    const card = document.createElement('div');
    card.className = 'envio-card';
    card.innerHTML = `
      <div class="envio-card-title">${escapeHTML(e.nome)}</div>
      <div class="envio-card-info">📅 Criado em: ${e.data}</div>
      <div class="envio-card-info">👕 Total de Peças: ${e.itens.length} | 📄 NFs: ${(e.notasFiscais || []).length}</div>
      <div class="envio-card-actions">
        <button class="btn btn-secondary" style="color: var(--danger);" onclick="deletarLote('${e.id}')">Excluir</button>
        <button class="btn btn-primary" onclick="carregarEnvioNoKanban('${e.id}')">Abrir</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ENTRADA EM LOTE (PP, P, M, G)
function processarItensEmLote() {
  const envio = envios.find(e => e.id === activeEnvioId);
  if (!envio) return;

  const rawText = document.getElementById('textarea-batch').value.trim();
  const destino = document.getElementById('select-destino').value;
  if (!rawText) return alert('Insira os dados dos produtos.');

  const linhas = rawText.split('\n');

  linhas.forEach(linha => {
    if (!linha.trim()) return;
    const partes = linha.split(';').map(p => p.trim());

    const ref = partes[0] || 'S/REF';
    const nome = partes[1] || 'Peça Sem Descrição';
    const pp = parseInt(partes[2]) || 0;
    const p = parseInt(partes[3]) || 0;
    const m = parseInt(partes[4]) || 0;
    const g = parseInt(partes[5]) || 0;

    function criarCard(filial) {
      return {
        id: 'card_' + Math.random().toString(36).substr(2, 9),
        filial: filial,
        status: 'nao-chegou',
        marker: '#cbd5e1',
        ref: ref,
        nome: nome,
        gradeCompleta: true,
        grade: { PP: pp, P: p, M: m, G: g },
        postits: [] // Lista de post-its
      };
    }

    if (destino === 'AMBOS' || destino === 'GYN') envio.itens.push(criarCard('GYN'));
    if (destino === 'AMBOS' || destino === 'BEL') envio.itens.push(criarCard('BEL'));
  });

  saveState();
  document.getElementById('textarea-batch').value = '';
  closeModal('modal-lote-itens');
  renderKanban();
}

// RENDERIZAR KANBAN & NFs
function renderKanban() {
  const envio = envios.find(e => e.id === activeEnvioId);
  if (!envio) return;

  ['GYN', 'BEL'].forEach(filial => {
    COLUNAS.forEach(col => {
      const box = document.getElementById(`${filial}-${col}`);
      if (box) box.innerHTML = '';
    });
  });

  let countGyn = 0;
  let countBel = 0;

  envio.itens.forEach(item => {
    if (item.filial === 'GYN') countGyn++;
    if (item.filial === 'BEL') countBel++;

    const colBox = document.getElementById(`${item.filial}-${item.status}`);
    if (colBox) colBox.appendChild(gerarCardHTML(item));
  });

  document.getElementById('count-gyn').innerText = `${countGyn} peças`;
  document.getElementById('count-bel').innerText = `${countBel} peças`;

  renderNotasFiscais();
}

// GERA O CARD ULTRA LIMPO (SEM CAMPO DE OBSERVAÇÃO)
function gerarCardHTML(item) {
  const el = document.createElement('div');
  el.className = 'kanban-card';
  el.draggable = true;
  el.id = item.id;

  // Clique no card abre o menu lateral
  el.onclick = (e) => {
    // Evita abrir se clicar em botões específicos dentro do card
    if (e.target.closest('button') || e.target.closest('.dot-color')) return;
    abrirDrawer(item.id);
  };

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', item.id);
    el.style.opacity = '0.5';
  });
  el.addEventListener('dragend', () => { el.style.opacity = '1'; });

  let badgesGrade = '';
  GRADE_TAMANHOS.forEach(tam => {
    const qtd = item.grade[tam] || 0;
    if (qtd > 0) {
      badgesGrade += `<span class="badge-tam">${tam}: <strong>${qtd}</strong></span>`;
    }
  });

  const statusGradeTexto = item.gradeCompleta ? '✓ Completo' : '⏳ Parcial';
  const statusGradeClass = item.gradeCompleta ? 'status-completo' : 'status-incompleto';
  const postitCount = (item.postits || []).length;

  el.innerHTML = `
    <div class="card-marker-line" style="background-color: ${item.marker}"></div>
    
    <div class="card-head">
      <span class="card-ref">${escapeHTML(item.ref)}</span>
      <button class="btn-grade-status ${statusGradeClass}" title="Alternar Completo/Parcial" onclick="toggleGradeStatus('${item.id}', event)">
        ${statusGradeTexto}
      </button>
    </div>

    <div class="card-prod-title" title="${escapeHTML(item.nome)}">${escapeHTML(item.nome)}</div>

    <div class="grade-badges-row">
      ${badgesGrade || '<span class="badge-tam">Sem grade</span>'}
    </div>

    <div class="card-footer">
      <span class="notes-badge">📝 ${postitCount}</span>
      <div class="marker-picker">
        <div class="dot-color" style="background:#ef4444" title="Urgente" onclick="setCorMarker('${item.id}', '#ef4444')"></div>
        <div class="dot-color" style="background:#f59e0b" title="Atenção" onclick="setCorMarker('${item.id}', '#f59e0b')"></div>
        <div class="dot-color" style="background:#10b981" title="OK" onclick="setCorMarker('${item.id}', '#10b981')"></div>
        <div class="dot-color" style="background:#8b5cf6" title="Prioridade" onclick="setCorMarker('${item.id}', '#8b5cf6')"></div>
        <div class="dot-color" style="background:#cbd5e1" title="Limpar" onclick="setCorMarker('${item.id}', '#cbd5e1')"></div>
      </div>
      <button class="btn-card-del" title="Remover" onclick="deletarItemCard('${item.id}', event)">✕</button>
    </div>
  `;

  return el;
}

// ----------------------------------------------------
// MENU LATERAL (DRAWER) E MURAL DE POST-ITS
// ----------------------------------------------------
function abrirDrawer(itemId) {
  activeItemId = itemId;
  const item = obterItem(itemId);
  if (!item) return;

  if (!item.postits) item.postits = [];

  const tag = document.getElementById('drawer-filial-tag');
  tag.innerText = item.filial === 'GYN' ? 'Goiânia' : 'Belém';
  tag.className = 'drawer-tag ' + (item.filial === 'GYN' ? 'gyn' : 'bel');

  document.getElementById('drawer-prod-title').innerText = item.nome;
  document.getElementById('drawer-prod-ref').innerText = `REF: ${item.ref}`;

  // Grades no Drawer
  const gradesBox = document.getElementById('drawer-grades-row');
  gradesBox.innerHTML = '';
  GRADE_TAMANHOS.forEach(tam => {
    const qtd = item.grade[tam] || 0;
    if (qtd > 0) {
      gradesBox.innerHTML += `<span class="badge-tam">${tam}: <strong>${qtd}</strong></span>`;
    }
  });

  // Botão Status no Drawer
  const btnStatus = document.getElementById('drawer-btn-status');
  btnStatus.innerText = item.gradeCompleta ? '✓ Completo' : '⏳ Parcial';
  btnStatus.className = 'btn-grade-status ' + (item.gradeCompleta ? 'status-completo' : 'status-incompleto');

  document.getElementById('postit-input').value = '';
  renderPostits();

  document.getElementById('drawer-overlay').classList.add('active');
  document.getElementById('card-drawer').classList.add('active');
}

function fecharDrawer() {
  document.getElementById('drawer-overlay').classList.remove('active');
  document.getElementById('card-drawer').classList.remove('active');
  activeItemId = null;
}

function toggleGradeStatusFromDrawer() {
  if (!activeItemId) return;
  toggleGradeStatus(activeItemId);
  const item = obterItem(activeItemId);
  const btnStatus = document.getElementById('drawer-btn-status');
  btnStatus.innerText = item.gradeCompleta ? '✓ Completo' : '⏳ Parcial';
  btnStatus.className = 'btn-grade-status ' + (item.gradeCompleta ? 'status-completo' : 'status-incompleto');
}

function adicionarPostit() {
  if (!activeItemId) return;
  const item = obterItem(activeItemId);
  if (!item) return;

  const textarea = document.getElementById('postit-input');
  const texto = textarea.value.trim();
  if (!texto) return;

  const corRadio = document.querySelector('input[name="postit-color"]:checked');
  const cor = corRadio ? corRadio.value : 'gray';

  item.postits.unshift({
    id: 'post_' + Date.now(),
    texto: texto,
    cor: cor, // 'gray', 'green', 'red'
    data: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  });

  saveState();
  textarea.value = '';
  renderPostits();
  renderKanban(); // Atualiza contador 📝 no card
}

function deletarPostit(postitId) {
  if (!activeItemId) return;
  const item = obterItem(activeItemId);
  if (!item || !item.postits) return;

  item.postits = item.postits.filter(p => p.id !== postitId);
  saveState();
  renderPostits();
  renderKanban();
}

function renderPostits() {
  const item = obterItem(activeItemId);
  const board = document.getElementById('postits-board');
  board.innerHTML = '';

  if (!item || !item.postits || item.postits.length === 0) {
    board.innerHTML = '<span class="empty-nf">Nenhum post-it ou observação adicionada.</span>';
    return;
  }

  const tagLabels = {
    'gray': 'Normal',
    'green': 'Feito / OK',
    'red': 'Urgente / Falta'
  };

  item.postits.forEach(p => {
    const postitEl = document.createElement('div');
    postitEl.className = `postit-card ${p.cor}`;
    postitEl.innerHTML = `
      <div class="postit-header">
        <span class="postit-tag-label">${tagLabels[p.cor] || 'Nota'} • ${p.data}</span>
        <button class="postit-del" onclick="deletarPostit('${p.id}')">✕</button>
      </div>
      <div class="postit-body">${escapeHTML(p.texto)}</div>
    `;
    board.appendChild(postitEl);
  });
}

// AÇÕES DO CARD
function toggleGradeStatus(itemId, ev) {
  if (ev) ev.stopPropagation();
  const item = obterItem(itemId);
  if (!item) return;
  item.gradeCompleta = !item.gradeCompleta;
  saveState();
  renderKanban();
}

function setCorMarker(itemId, cor) {
  const item = obterItem(itemId);
  if (!item) return;
  item.marker = cor;
  saveState();
  renderKanban();
}

function deletarItemCard(itemId, ev) {
  if (ev) ev.stopPropagation();
  const envio = envios.find(e => e.id === activeEnvioId);
  if (!envio) return;
  if (!confirm('Deseja remover esta peça do quadro?')) return;

  envio.itens = envio.itens.filter(i => i.id !== itemId);
  saveState();
  renderKanban();
  if (activeItemId === itemId) fecharDrawer();
}

function obterItem(itemId) {
  const envio = envios.find(e => e.id === activeEnvioId);
  return envio ? envio.itens.find(i => i.id === itemId) : null;
}

// DRAG AND DROP
function handleDragOver(ev) {
  ev.preventDefault();
  ev.currentTarget.classList.add('dragover');
}

function handleDragLeave(ev) {
  ev.currentTarget.classList.remove('dragover');
}

function handleDrop(ev, destFilial, destStatus) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('dragover');

  const cardId = ev.dataTransfer.getData('text/plain');
  const item = obterItem(cardId);

  if (item && item.filial === destFilial) {
    item.status = destStatus;
    saveState();
    renderKanban();
  }
}

// GESTÃO DE NOTAS FISCAIS
async function adicionarNotaFiscal() {
  const envio = envios.find(e => e.id === activeEnvioId);
  if (!envio) return;

  const filial = document.getElementById('nf-filial').value;
  const numero = document.getElementById('nf-numero').value.trim();
  const fileInput = document.getElementById('nf-arquivo');
  const file = fileInput.files[0];

  if (!numero) return alert('Digite a identificação ou número da NF.');

  let arquivoId = null;
  let arquivoNome = '';
  let arquivoTipo = '';

  if (file) {
    arquivoId = 'doc_' + Date.now();
    arquivoNome = file.name;
    arquivoTipo = file.type;
    await salvarArquivoIndexedDB(arquivoId, file, arquivoNome, arquivoTipo);
  }

  if (!envio.notasFiscais) envio.notasFiscais = [];

  envio.notasFiscais.push({
    id: 'nf_' + Date.now(),
    filial: filial,
    numero: numero,
    arquivoId: arquivoId,
    arquivoNome: arquivoNome,
    arquivoTipo: arquivoTipo
  });

  saveState();
  document.getElementById('nf-numero').value = '';
  fileInput.value = '';
  closeModal('modal-add-nf');
  renderNotasFiscais();
}

async function deletarNotaFiscal(nfId, arquivoId) {
  const envio = envios.find(e => e.id === activeEnvioId);
  if (!envio || !envio.notasFiscais) return;

  if (arquivoId) {
    await removerArquivoIndexedDB(arquivoId);
  }

  envio.notasFiscais = envio.notasFiscais.filter(n => n.id !== nfId);
  saveState();
  renderNotasFiscais();
}

function renderNotasFiscais() {
  const envio = envios.find(e => e.id === activeEnvioId);
  if (!envio) return;

  const gynBox = document.getElementById('nf-list-gyn');
  const belBox = document.getElementById('nf-list-bel');

  const nfs = envio.notasFiscais || [];
  const gynNFs = nfs.filter(n => n.filial === 'GYN');
  const belNFs = nfs.filter(n => n.filial === 'BEL');

  gynBox.innerHTML = gynNFs.length === 0 ? '<span class="empty-nf">Nenhum documento anexado para Goiânia.</span>' : '';
  belBox.innerHTML = belNFs.length === 0 ? '<span class="empty-nf">Nenhum documento anexado para Belém.</span>' : '';

  gynNFs.forEach(n => gynBox.appendChild(criarChipNF(n)));
  belNFs.forEach(n => belBox.appendChild(criarChipNF(n)));
}

function criarChipNF(nf) {
  const chip = document.createElement('div');
  chip.className = 'nf-chip';

  let btnVer = '';
  if (nf.arquivoId) {
    btnVer = `<button class="nf-chip-btn" onclick="abrirVisualizador('${nf.arquivoId}', '${escapeHTML(nf.numero)}')">Ver Anexo 👁️</button>`;
  }

  chip.innerHTML = `
    <span>📄 <strong>${escapeHTML(nf.numero)}</strong></span>
    ${btnVer}
    <span class="nf-chip-del" onclick="deletarNotaFiscal('${nf.id}', '${nf.arquivoId || ''}')" title="Excluir NF">✕</span>
  `;
  return chip;
}

// VISUALIZADOR DE DOCUMENTO
async function abrirVisualizador(arquivoId, titulo) {
  const arquivo = await obterArquivoIndexedDB(arquivoId);
  if (!arquivo) return alert('Arquivo não encontrado.');

  const viewerTitle = document.getElementById('viewer-title');
  const viewerContent = document.getElementById('viewer-content');
  
  viewerTitle.innerText = `Nota: ${titulo} (${arquivo.nomeOriginal})`;
  viewerContent.innerHTML = '';

  const url = URL.createObjectURL(arquivo.blob);

  if (arquivo.tipo.includes('pdf')) {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    viewerContent.appendChild(iframe);
  } else {
    const img = document.createElement('img');
    img.src = url;
    viewerContent.appendChild(img);
  }

  openModal('modal-viewer');
}

function fecharVisualizador() {
  closeModal('modal-viewer');
  document.getElementById('viewer-content').innerHTML = '';
}

// UTILITÁRIO
function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// INICIALIZAÇÃO
window.addEventListener('DOMContentLoaded', () => {
  switchTab('screen-home');
});