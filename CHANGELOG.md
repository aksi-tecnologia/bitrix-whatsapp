# Histórico de versões

Cada versão nova vira uma Release no GitHub com o zip da extensão. O texto da
Release é a seção da versão neste arquivo, então escreva aqui o que mudou
**antes** de subir o `version` no `manifest.json`.

Formato: `## [x.y.z] - AAAA-MM-DD`, seguido da lista de mudanças.

## [0.2.3] - 2026-11-25

### Novo
- Opção "Reorganizar a lista" dos Canais Abertos (desligada por padrão): conversas aguardando resposta no topo, a que espera há mais tempo primeiro; as demais pela última mensagem. Um ponto colorido no avatar mostra o status.
  - Só atua com a pasta Canais Abertos selecionada e desfaz tudo ao desligar ou trocar de pasta.
  - Não move elementos do Bitrix (usa a ordem visual do CSS), então cliques, rolagem e o carregamento de mais conversas continuam funcionando.

## [0.2.2] - 2026-11-25

### Novo
- Botão "Procurar atualização" nas opções: consulta a última Release no GitHub, compara com a versão instalada e mostra o que há de novo e o link do zip.

## [0.2.1] - 2026-11-25

### Novo
- Prévia do áudio gravado antes de enviar: ao parar a gravação, o compositor mostra um mini player com descartar, ouvir, barra de tempo e enviar. Só o enviar anexa o áudio ao chat.
- Opção "Ouvir o áudio gravado antes de enviar" (ligada por padrão). Desmarcada, o áudio é anexado direto, como antes.

### Corrigido
- Texto invisível em "Conversa #… iniciada" no bate-papo com o tema WhatsApp.

### Documentação
- README completo: requisitos, instalação, opções, contrato do webhook, limitações, estrutura e solução de problemas.
- A ajuda do webhook nas opções passa a citar os campos `mimeType` e `bitrixHost`.
- Modelo de fluxo n8n para a transcrição em `n8n/`, com modo simples (devolve o texto) e completo (responde no chat e evita duplicidade).

## [0.2.0] - 2026-11-25

### Novo
- Botão "Ligar por…" nas fichas de contato, lead, empresa e negócio e no cabeçalho do Canal Aberto, com escolha da linha de saída.
- Discador para qualquer número e ordem/visibilidade das linhas nas opções.

## [0.1.x]

- Tema WhatsApp no Canal Aberto, gravador em OGG/Opus, player com velocidade e transcrição via webhook (n8n).
