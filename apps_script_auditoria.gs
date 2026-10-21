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

function doGet() {
  try {
    const ss = abrirPlanilha();
    return resposta({ ok: true, servico: 'Auditoria de Ruas', versao: 3, planilha: ss.getName() });
  } catch (err) {
    return resposta({ ok: false, erro: 'Sem acesso à planilha: ' + err });
  }
}

/** Rode esta função uma vez pelo editor (botão Executar) para autorizar Planilhas e Drive. */
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
