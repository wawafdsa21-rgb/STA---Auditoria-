/**
 * Auditoria STA – Santa Therezinha (versão 6)
 * Recebe os lançamentos do aplicativo e grava na planilha:
 *   - Auditoria_Ruas     (permissão aud_rua)
 *   - Auditoria_Retorno  (permissão aud_ret)
 * Login pela aba Permissionamento (Matrícula, Permissão, Observação, Senha).
 * Fotos vão para a pasta "Fotos Auditoria de Ruas" no Google Drive.
 *
 * Implantar → Gerenciar implantações → lápis → Nova versão
 *   Executar como: Eu   |   Quem pode acessar: Qualquer pessoa
 */
const SHEET_ID = '1Srs2JdL1WEGsaa-SaLec2TaYQYX_eUmNsU2zE1M4CAA';
const PASTA_FOTOS = 'Fotos Auditoria de Ruas';
const ABA_PERMISSOES = 'Permissionamento';
const ABA_QUADRO = 'Quadro_Repositores';
const VALIDADE_LOGIN_DIAS = 180;

const ABAS = {
  ruas: {
    nome: 'Auditoria_Ruas', perm: 'aud_rua',
    colunas: ['ID_Auditoria', 'DataHora', 'Matricula_Auditor', 'Nome_Auditor', 'Produto', 'Descricao_Produto',
      'Endereco', 'Rua', 'Predio', 'Nivel', 'Apto', 'Erro_Produto', 'Endereco_Correto', 'Prox_Vencimento',
      'Data_Vencimento', 'Sem_Saldo', 'Avaria', 'Tipo_Avaria', 'Foto_Avaria', 'Qtd_Divergencia_Un',
      'Vl_Ult_Entrada', 'Valor_Divergencia', 'Observacao', 'Possui_NC', 'Matricula_Colaborador_NC',
      'Nome_Colaborador_NC', 'Funcao_Colaborador_NC', 'Status_NC', 'Responsavel_Tratativa',
      'Acao_Corretiva', 'Data_Resolucao', 'Ultima_Atualizacao', 'ID_Sessao', 'Links_Fotos', 'Recebido_Em'],
    texto: ['ID_Auditoria', 'Matricula_Auditor', 'Produto', 'Endereco', 'Endereco_Correto',
      'Matricula_Colaborador_NC', 'ID_Sessao', 'DataHora', 'Data_Vencimento', 'Ultima_Atualizacao']
  },
  retorno: {
    nome: 'Auditoria_Retorno', perm: 'aud_ret',
    colunas: ['ID_Auditoria', 'DataHora', 'Matricula_Auditor', 'Nome_Auditor', 'Produto', 'Descricao_Produto',
      'Rua', 'Prox_Vencimento', 'Data_Vencimento', 'Foto_Retorno', 'Foto_Etiqueta', 'Observacao', 'Possui_NC',
      'Matricula_Colaborador_NC', 'Nome_Colaborador_NC', 'Funcao_Colaborador_NC', 'Status_NC',
      'Responsavel_Tratativa', 'ID_Sessao', 'Links_Fotos', 'Recebido_Em'],
    texto: ['ID_Auditoria', 'Matricula_Auditor', 'Produto', 'Matricula_Colaborador_NC', 'ID_Sessao',
      'DataHora', 'Data_Vencimento']
  }
};

/* ===================== Entradas ===================== */

function doPost(e) {
  if (!e || !e.postData) return resposta({ ok: false, erro: 'Chame pelo aplicativo. Para testar no editor, execute testeGravacao.' });
  let dados;
  try { dados = JSON.parse(e.postData.contents); } catch (err) { return resposta({ ok: false, erro: 'Dados inválidos.' }); }

  if (dados.acao === 'login') return resposta(login(dados.matricula, dados.senha));

  const sessao = validarToken(dados.token);
  if (!sessao.ok) return resposta({ ok: false, erro: sessao.erro, login: true });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = abrirPlanilha();
    const grupos = {};
    (Array.isArray(dados.records) ? dados.records : []).forEach(function (r) {
      const aba = (r && r._aba) || 'ruas';
      (grupos[aba] = grupos[aba] || []).push(r);
    });
    let adicionados = 0;
    for (const aba in grupos) {
      const cfg = ABAS[aba];
      if (!cfg) return resposta({ ok: false, erro: 'Tipo de auditoria desconhecido: ' + aba });
      if (sessao.permissoes.indexOf(cfg.perm) < 0) {
        return resposta({ ok: false, erro: 'A matrícula ' + sessao.matricula + ' não tem a permissão ' + cfg.perm + ' na aba Permissionamento.' });
      }
      adicionados += gravar(ss, cfg, grupos[aba]);
    }
    return resposta({ ok: true, adicionados: adicionados });
  } catch (err) {
    return resposta({ ok: false, erro: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const ss = abrirPlanilha();
    if (p.acao === 'sessao') return resposta(validarToken(p.token));
    if (p.acao === 'registros') {
      const s = validarToken(p.token);
      if (!s.ok) return resposta({ ok: false, erro: s.erro, login: true });
      return listarRegistros(ss);
    }
    return resposta({ ok: true, servico: 'Auditoria STA', versao: 6, planilha: ss.getName() });
  } catch (err) {
    return resposta({ ok: false, erro: 'Sem acesso à planilha: ' + err });
  }
}

/* ===================== Login e permissões ===================== */

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Lê a aba Permissionamento: { matricula: { senhas[], permissoes[] } }. */
function lerPermissoes() {
  const sh = abrirPlanilha().getSheetByName(ABA_PERMISSOES);
  if (!sh || sh.getLastRow() < 2) return {};
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const cab = v[0].map(normalizar);
  const iMat = cab.findIndex(function (h) { return h.indexOf('MATRIC') === 0; });
  const iPer = cab.findIndex(function (h) { return h.indexOf('PERMISS') === 0; });
  const iSen = cab.findIndex(function (h) { return h.indexOf('SENHA') === 0; });
  if (iMat < 0 || iPer < 0 || iSen < 0) throw new Error('A aba Permissionamento precisa das colunas Matrícula, Permissão e Senha.');
  const mapa = {};
  for (let i = 1; i < v.length; i++) {
    const mat = String(v[i][iMat]).trim(), per = String(v[i][iPer]).trim().toLowerCase(), sen = String(v[i][iSen]).trim();
    if (!mat || !per) continue;
    const m = mapa[mat] = mapa[mat] || { senhas: [], permissoes: [] };
    if (sen && m.senhas.indexOf(sen) < 0) m.senhas.push(sen);
    if (m.permissoes.indexOf(per) < 0) m.permissoes.push(per);
  }
  return mapa;
}

function login(matricula, senha) {
  const mat = String(matricula || '').trim(), sen = String(senha || '').trim();
  if (!mat || !sen) return { ok: false, erro: 'Informe matrícula e senha.' };
  const u = lerPermissoes()[mat];
  if (!u || u.senhas.indexOf(sen) < 0) return { ok: false, erro: 'Matrícula ou senha inválidas.' };
  return { ok: true, matricula: mat, nome: nomeDaMatricula(mat), permissoes: u.permissoes, token: gerarToken(mat) };
}

function segredo() {
  const pr = PropertiesService.getScriptProperties();
  let s = pr.getProperty('SEGREDO');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); pr.setProperty('SEGREDO', s); }
  return s;
}

function assinar(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, segredo())).replace(/=+$/, '');
}

function gerarToken(mat) {
  const base = mat + '.' + Date.now();
  return base + '.' + assinar(base);
}

/** Confere o token e devolve as permissões ATUAIS (tirar a matrícula da aba = perde o acesso). */
function validarToken(token) {
  const t = String(token || '').split('.');
  if (t.length !== 3) return { ok: false, erro: 'Faça login no aplicativo.' };
  const base = t[0] + '.' + t[1];
  if (assinar(base) !== t[2]) return { ok: false, erro: 'Login inválido. Entre novamente.' };
  if (Date.now() - Number(t[1]) > VALIDADE_LOGIN_DIAS * 864e5) return { ok: false, erro: 'Login expirado. Entre novamente.' };
  const u = lerPermissoes()[t[0]];
  if (!u || !u.permissoes.length) return { ok: false, erro: 'Matrícula sem permissão na aba Permissionamento.' };
  return { ok: true, matricula: t[0], nome: nomeDaMatricula(t[0]), permissoes: u.permissoes };
}

function nomeDaMatricula(mat) {
  try {
    const sh = abrirPlanilha().getSheetByName(ABA_QUADRO);
    if (!sh || sh.getLastRow() < 2) return '';
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues();
    for (let i = 0; i < v.length; i++) if (String(v[i][0]).trim() === mat) return String(v[i][1]).trim();
  } catch (e) {}
  return '';
}

/** Rode se precisar derrubar todos os logins (todos terão de entrar de novo). */
function revogarTodosOsLogins() {
  PropertiesService.getScriptProperties().deleteProperty('SEGREDO');
}

/* ===================== Gravação ===================== */

function abrirPlanilha() {
  try { const a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; } catch (err) {}
  return SpreadsheetApp.openById(SHEET_ID);
}

function gravar(ss, cfg, registros) {
  const sh = ss.getSheetByName(cfg.nome) || ss.insertSheet(cfg.nome);
  if (sh.getLastRow() === 0) sh.appendRow(cfg.colunas);
  const cab = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  cfg.colunas.forEach(function (c) {
    if (cab.indexOf(c) < 0) { sh.getRange(1, cab.length + 1).setValue(c); cab.push(c); }
  });
  const colId = cab.indexOf('ID_Auditoria');
  const existentes = new Set(sh.getLastRow() > 1
    ? sh.getRange(2, colId + 1, sh.getLastRow() - 1, 1).getValues().map(function (l) { return String(l[0]); })
    : []);

  const linhas = [];
  registros.forEach(function (r) {
    if (!r || !r.ID_Auditoria || existentes.has(String(r.ID_Auditoria))) return;
    try {
      if (cfg === ABAS.retorno) {
        const fr = salvarFoto(r.foto_retorno, r.ID_Auditoria + '_retorno');
        const fe = salvarFoto(r.foto_etiqueta, r.ID_Auditoria + '_etiqueta');
        r.Foto_Retorno = fr; r.Foto_Etiqueta = fe;
        r.Links_Fotos = [fr, fe].filter(String).join(' ');
      } else {
        r.Links_Fotos = (r.fotos || []).map(function (d, i) { return salvarFoto(d, r.ID_Auditoria + '_' + (i + 1)); }).filter(String).join(' ');
      }
    } catch (err) { r.Links_Fotos = 'Fotos não salvas: ' + err; }
    r.Recebido_Em = new Date();
    linhas.push(cab.map(function (h) { const v = r[h]; return v === undefined || v === null ? '' : v; }));
    existentes.add(String(r.ID_Auditoria));
  });

  if (linhas.length) {
    const ini = sh.getLastRow() + 1;
    cfg.texto.forEach(function (c) {
      const i = cab.indexOf(c);
      if (i >= 0) sh.getRange(ini, i + 1, linhas.length, 1).setNumberFormat('@');
    });
    sh.getRange(ini, 1, linhas.length, cab.length).setValues(linhas);
  }
  return linhas.length;
}

function salvarFoto(dataUrl, nome) {
  const m = String(dataUrl || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (!m) return '';
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], nome + '.jpg');
  return obterPasta().createFile(blob).getUrl();
}

function obterPasta() {
  const it = DriveApp.getFoldersByName(PASTA_FOTOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_FOTOS);
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== Painel ===================== */

function listarRegistros(ss) {
  const campos = ['ID_Auditoria', 'DataHora', 'Nome_Auditor', 'Endereco', 'Rua', 'Possui_NC', 'Erro_Produto',
    'Prox_Vencimento', 'Sem_Saldo', 'Avaria', 'Qtd_Divergencia_Un', 'Valor_Divergencia',
    'Matricula_Colaborador_NC', 'Nome_Colaborador_NC', 'Status_NC', 'ID_Sessao', 'Recebido_Em'];
  const quadro = lerQuadro(ss);
  const sh = ss.getSheetByName(ABAS.ruas.nome);
  if (!sh || sh.getLastRow() < 2) return resposta({ ok: true, colunas: campos, registros: [], quadro: quadro });
  const dados = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const cab = dados[0].map(String);
  const idx = campos.map(function (c) { return cab.indexOf(c); });
  const regs = [];
  for (let i = 1; i < dados.length; i++) {
    const l = dados[i];
    if (idx[0] < 0 || !l[idx[0]]) continue;
    regs.push(idx.map(function (k) {
      if (k < 0) return '';
      const v = l[k];
      return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss') : v;
    }));
  }
  return resposta({ ok: true, colunas: campos, registros: regs, quadro: quadro });
}

const QUADRO_PADRAO = [
  ['10003926', 'FABIANNE MATURANO DE LUCENA ALVES', 'SUPORTE', ''],
  ['10003936', 'GRAZIELA PEREIRA DA SILVA', 'REPOSITOR', '29, 30'],
  ['10003932', 'ALICE KAUANE PEREIRA SILVA', 'REPOSITOR', '24'],
  ['10003925', 'ANA CAROLINA DE ALCANTARA FERREIRA', 'REPOSITOR', '43, 44'],
  ['10003615', 'CARLOS ANTONIO DOS SANTOS', 'REPOSITOR', '4'],
  ['10003639', 'CLEITON CARDOSO DA SILVA', 'REPOSITOR', '38, 39, 40'],
  ['10002347', 'EDIO JOSE DE SOUZA', 'REPOSITOR', '20, 22'],
  ['10003850', 'ESDRAS SOUZA ARAUJO', 'REPOSITOR', '16, 17'],
  ['10003902', 'FRANCIMAR ABADE DA SILVA', 'REPOSITOR', '27, 28'],
  ['10003413', 'GABRIEL FILLIPE DOS SANTOS FERREIRA', 'REPOSITOR', '41, 42'],
  ['10003748', 'HALLYSON DE SOUSA DELMONDES', 'REPOSITOR', '8, 9'],
  ['10003193', 'JOSE RODRIGUES DA SILVA FILHO', 'REPOSITOR', '2, 3'],
  ['10003928', 'KETNEY CRISTINE ALVES DOS SANTOS', 'REPOSITOR', '25, 26'],
  ['10001781', 'LEANDRO SOARES LOPES', 'REPOSITOR', '5, 6, 7'],
  ['10003942', 'NAIARA GONCALVES DOS SANTOS', 'REPOSITOR', '10, 11'],
  ['10003930', 'NATHAN ALVES DE OLIVEIRA', 'REPOSITOR', '34, 35'],
  ['10003961', 'NICACIO GUILHERME DOS SANTOS', 'REPOSITOR', '36, 37'],
  ['10003316', 'PAULO CESAR ALVES VIANA', 'REPOSITOR', '45, 46'],
  ['10003643', 'TIAGO VITO PEREIRA MELO', 'REPOSITOR', '23'],
  ['10003787', 'WAGNER HENRIQUE ALVES', 'REPOSITOR', '11, 12'],
  ['10003993', 'FABIO NYCKOLAS FIGUEIREDO BOTERO', 'LIDER', ''],
  ['10004015', 'CAIO GABRIEL ANDRADE DE HOLANDA', 'REPOSITOR', '31, 32'],
  ['10003995', 'HELIANO HOLANDA E SILVA CASTRO', 'REPOSITOR', '18, 19'],
  ['10002871', 'RONNY KENDSON RAMALHO SILVA', 'AUXILIAR', '']
];

function lerQuadro(ss) {
  let sh = ss.getSheetByName(ABA_QUADRO);
  if (!sh) {
    sh = ss.insertSheet(ABA_QUADRO);
    sh.getRange(1, 1, 1, 4).setValues([['Matricula', 'Nome', 'Funcao', 'Ruas']]).setFontWeight('bold');
    sh.getRange(2, 1, QUADRO_PADRAO.length, 4).setNumberFormat('@').setValues(QUADRO_PADRAO);
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues()
    .filter(function (l) { return String(l[0]).trim(); });
}

/* ===================== Testes pelo editor ===================== */

function autorizar() {
  Logger.log('Planilha: ' + abrirPlanilha().getName());
  Logger.log('Pasta de fotos: ' + obterPasta().getName());
  Logger.log('Matrículas com permissão: ' + Object.keys(lerPermissoes()).join(', '));
  segredo();
}

function testeLogin() {
  const mapa = lerPermissoes(), mat = Object.keys(mapa)[0];
  Logger.log(JSON.stringify(login(mat, mapa[mat].senhas[0])));
}

function testeGravacao() {
  const ss = abrirPlanilha(), agora = new Date().getTime();
  gravar(ss, ABAS.ruas, [{ ID_Auditoria: 'TESTE-RUA-' + agora, DataHora: new Date().toLocaleString('pt-BR'), Nome_Auditor: 'TESTE', Endereco: '1-1-1-1', Observacao: 'Teste – pode apagar', Status_NC: 'Conforme' }]);
  gravar(ss, ABAS.retorno, [{ ID_Auditoria: 'TESTE-RET-' + agora, DataHora: new Date().toLocaleString('pt-BR'), Nome_Auditor: 'TESTE', Produto: '338', Rua: '44', Observacao: 'Teste – pode apagar', Status_NC: 'Conforme' }]);
  Logger.log('Linhas de teste gravadas em Auditoria_Ruas e Auditoria_Retorno.');
}
