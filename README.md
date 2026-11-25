# Bitrix24 WhatsApp Skin

Extensão Chrome (Manifest V3) que deixa o bate-papo de Canal Aberto do Bitrix24 com cara de WhatsApp.
Só age quando existe na página a div `.bx-imol-list-container-recent__container.bx-imol-messenger__scope`.

## Instalar
1. Descompacte a pasta.
2. `chrome://extensions` → ative **Modo do desenvolvedor** → **Carregar sem compactação** → selecione a pasta.
3. Recarregue a aba do Bitrix24. Opções: clique no ícone da extensão.

## O que faz
- **Tema** (`content/theme.css`): cores, balões, lista de conversas, cabeçalho e compositor no padrão WhatsApp.
- **Gravador**: botão de microfone no compositor. Grava em Opus e gera um `.ogg` (WebCodecs + muxer próprio em
  `content/ogg.js`; cai para MediaRecorder/webm se o navegador não suportar). Ao parar, simula o arrastar-e-soltar
  no chat (`dragenter/dragover/drop`; se o Bitrix não tratar, tenta `paste`; se também falhar, baixa o arquivo).
- **Player**: mensagens com arquivo de áudio (.oga, .ogg, .mp3…) ganham player com velocidade 1×/1,5×/2×.
- **Transcrição**: botão no player envia o áudio ao webhook e mostra o texto embaixo do áudio. Com a opção ligada,
  responde o áudio com mensagem oculta (`im.v2.Chat.Message.send`, `fields[system]=Y`, `fields[replyId]`).

## Contrato do webhook (n8n)
`POST multipart/form-data`

| campo | conteúdo |
|---|---|
| `audio` | arquivo binário do áudio |
| `dialogId` | ex.: `chat7489` |
| `chatId` | ex.: `7489` |
| `messageId` | id da mensagem que contém o áudio |
| `fileId`, `fileName`, `mimeType` | dados do arquivo no Bitrix |
| `publicUrl` | link público do ChatApp, quando existir na mensagem |
| `bitrixHost` | host do portal |

Resposta esperada: `{"text": "transcrição"}` (aceita também `transcription`, `output` ou texto puro).
Se a resposta vier sem texto, a extensão entende que o próprio n8n vai responder no chat.
Token opcional vai em `Authorization: Bearer <token>`.

A mensagem oculta sai como `🎙 Transcrição do áudio #<messageId>:` + texto. O `#<messageId>` é o que permite
às outras pessoas com a extensão reconhecerem que aquele áudio já foi transcrito.

## Arquivos
- `manifest.json`, `background.js` (chamada ao webhook), `options.html/js`
- `content/content.js` (ativação, gravador, player, transcrição), `content/recorder.js`, `content/ogg.js`
- `content/theme.css` (tema), `content/ui.css` (componentes da extensão)

## Botão "Ligar por…" (v0.2.0)
Liga para o cliente escolhendo a linha de saída, sem depender da linha padrão.

- **Onde aparece:** no topo da ficha de contato, lead, empresa e negócio (ao lado dos botões da direita) e no
  cabeçalho do bate-papo de Canal Aberto. Em chats internos (colegas) não aparece.
- **Números:** usa os telefones da ficha. No negócio, os do contato principal (ou da empresa). No bate-papo, os do
  contato/lead/empresa vinculado ao chat (`imopenlines.dialog.get` → `entity_data_2`). Repetidos em formatos
  diferentes aparecem uma vez. Sempre há o campo "Outro número".
- **Linhas:** as mesmas do teclado de Telefonia (`voximplant.callView.getLines`). No ícone da extensão dá para esconder
  linhas e mudar a ordem; também há um campo para ligar para qualquer número.
- **Chamada:** `BX.Messenger.v2.Lib.PhoneManager.getInstance().startCall(numero, { LINE_ID, ENTITY_TYPE, ENTITY_ID })`,
  o mesmo caminho do teclado. Linhas de app (tipo REST) o Bitrix encaminha sozinho para o app.

Arquivos: `content/caller-main.js` (roda no contexto da página, `world: MAIN`, em todos os frames por causa das fichas
abertas em painel lateral), `content/caller-bridge.js` (ponte com as opções), `content/caller.css`.
