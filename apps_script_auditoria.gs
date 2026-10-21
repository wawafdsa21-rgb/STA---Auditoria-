/**
 * Recebe os lançamentos do formulário "Auditoria de Ruas – Santa Therezinha"
 * e grava na aba Auditoria_Ruas da planilha. Fotos vão para a pasta
 * "Fotos Auditoria de Ruas" no Google Drive, com o link na coluna Links_Fotos.
 *
 * Implantar → Nova implantação → App da Web
 *   Executar como: Eu
 *   Quem pode acessar: Qualquer pessoa
 */
const SHEET_ID = '1Srs2JdL1WEGsaa-SaLec2TaYQYX_eUmNsU2zE1M4CAA';
const ABA = 'Auditoria_Ruas';
const PASTA_FOTOS = 'Fotos Auditoria de Ruas';

const COLUNAS = [
  'ID_Auditoria', 'DataHora', 'Matricula_Auditor', 'Nome_Auditor', 'Produto', 'Descricao_Produto',
  'Endereco', 'Rua', 'Predio', 'Nivel', 'Apto', 'Erro_Produto', 'Endereco_Correto', 'Prox_Vencimento',
  'Data_Vencimento', 'Sem_Saldo', 'Avaria', 'Tipo_Avaria', 'Foto_Avaria', 'Qtd_Divergencia_Un',
  'Vl_Ult_Entrada', 'Valor_Divergencia', 'Observacao', 'Possui_NC', 'Matricula_Colaborador_NC',
  'Nome_Colaborador_NC', 'Funcao_Colaborador_NC', 'Status_NC', 'Responsavel_Tratativa',
  'Acao_Corretiva', 'Data_Resolucao', 'Ultima_Atualizacao', 'ID_Sessao', 'Links_Fotos', 'Recebido_Em'
];
// Colunas gravadas como texto (evita perder zeros ou virar data)
const TEXTO = ['ID_Auditoria', 'Matricula_Auditor', 'Produto', 'Endereco', 'Endereco_Correto',
  'Matricula_Colaborador_NC', 'ID_Sessao', 'DataHora', 'Data_Vencimento', 'Ultima_Atualizacao'];

function abrirPlanilha() {
  // Script criado dentro da planilha (Extensões → Apps Script) usa a própria planilha; senão abre pelo ID.
  try { const a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; } catch (err) {}
  return SpreadsheetApp.openById(SHEET_ID);
}

function doPost(e) {
  if (!e || !e.postData) {
    return resposta({ ok: false, erro: 'doPost só funciona chamado pelo formulário. Para testar no editor, execute a função testeGravacao.' });
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const dados = JSON.parse(e.postData.contents);
    const registros = Array.isArray(dados.records) ? dados.records : [dados];
    const ss = abrirPlanilha();
    const sh = ss.getSheetByName(ABA) || ss.insertSheet(ABA);

    if (sh.getLastRow() === 0) sh.appendRow(COLUNAS);
    const cab = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    COLUNAS.forEach(function (c) {
      if (cab.indexOf(c) < 0) { sh.getRange(1, cab.length + 1).setValue(c); cab.push(c); }
    });

    const colId = cab.indexOf('ID_Auditoria');
    const existentes = new Set(sh.getLastRow() > 1
      ? sh.getRange(2, colId + 1, sh.getLastRow() - 1, 1).getValues().map(function (l) { return String(l[0]); })
      : []);

    const linhas = [];
    registros.forEach(function (r) {
      if (!r || !r.ID_Auditoria || existentes.has(String(r.ID_Auditoria))) return;
      try { r.Links_Fotos = salvarFotos(r).join(' '); }
      catch (err) { r.Links_Fotos = 'Fotos não salvas: ' + err; }
      r.Recebido_Em = new Date();
      linhas.push(cab.map(function (h) { const v = r[h]; return v === undefined || v === null ? '' : v; }));
      existentes.add(String(r.ID_Auditoria));
    });

    if (linhas.length) {
      const ini = sh.getLastRow() + 1;
      TEXTO.forEach(function (c) {
        const i = cab.indexOf(c);
        if (i >= 0) sh.getRange(ini, i + 1, linhas.length, 1).setNumberFormat('@');
      });
      sh.getRange(ini, 1, linhas.length, cab.length).setValues(linhas);
    }
    return resposta({ ok: true, adicionados: linhas.length });
  } catch (err) {
    return resposta({ ok: false, erro: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function salvarFotos(r) {
  const fotos = r.fotos || [];
  if (!fotos.length) return [];
  const pasta = obterPasta();
  return fotos.map(function (d, i) {
    const m = String(d).match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (!m) return '';
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], r.ID_Auditoria + '_' + (i + 1) + '.jpg');
    return pasta.createFile(blob).getUrl();
  }).filter(String);
}

function obterPasta() {
  const it = DriveApp.getFoldersByName(PASTA_FOTOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_FOTOS);
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const ss = abrirPlanilha();
    if (e && e.parameter && e.parameter.acao === 'registros') return listarRegistros(ss);
    return resposta({ ok: true, servico: 'Auditoria de Ruas', versao: 5, planilha: ss.getName() });
  } catch (err) {
    return resposta({ ok: false, erro: 'Sem acesso à planilha: ' + err });
  }
}

/** Devolve os lançamentos (sem fotos) para o Painel de ruas do formulário. */
function listarRegistros(ss) {
  const campos = ['ID_Auditoria', 'DataHora', 'Nome_Auditor', 'Endereco', 'Rua', 'Possui_NC', 'Erro_Produto',
    'Prox_Vencimento', 'Sem_Saldo', 'Avaria', 'Qtd_Divergencia_Un', 'Valor_Divergencia',
    'Matricula_Colaborador_NC', 'Nome_Colaborador_NC', 'Status_NC', 'ID_Sessao', 'Recebido_Em'];
  const quadro = lerQuadro(ss);
  const sh = ss.getSheetByName(ABA);
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

/* ---------- Quadro de repositores (aba Quadro_Repositores) ---------- */
const ABA_QUADRO = 'Quadro_Repositores';
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

/** Lê a aba Quadro_Repositores (cria com o quadro padrão se não existir). */
function lerQuadro(ss) {
  let sh = ss.getSheetByName(ABA_QUADRO);
  if (!sh) {
    sh = ss.insertSheet(ABA_QUADRO);
    sh.getRange(1, 1, 1, 4).setValues([['Matricula', 'Nome', 'Funcao', 'Ruas']]).setFontWeight('bold');
    sh.getRange(2, 1, QUADRO_PADRAO.length, 4).setNumberFormat('@').setValues(QUADRO_PADRAO);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, 4);
  }
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues()
    .filter(function (l) { return String(l[0]).trim(); });
}

function autorizar() {
  Logger.log('Planilha: ' + abrirPlanilha().getName());
  Logger.log('Pasta de fotos: ' + obterPasta().getName());
}

/** Teste pelo editor: grava uma linha de exemplo na aba Auditoria_Ruas (apague depois). */
function testeGravacao() {
  const r = doPost({ postData: { contents: JSON.stringify({ records: [{
    ID_Auditoria: 'TESTE-' + new Date().getTime(), DataHora: new Date().toLocaleString('pt-BR'),
    Nome_Auditor: 'TESTE', Endereco: '1-1-1-1', Observacao: 'Linha de teste – pode apagar', Status_NC: 'Conforme'
  }] }) } });
  Logger.log(r.getContent());
}
