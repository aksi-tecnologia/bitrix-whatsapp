# Bitrix24 WhatsApp Skin

Extensão para Google Chrome (Manifest V3) que melhora o Bitrix24 em duas frentes:

1. **Bate-papo de Canal Aberto com cara de WhatsApp**: tema, gravador de áudio, player com velocidade e transcrição de áudios via webhook (n8n).
2. **Botão "Ligar por…"**: liga para o cliente escolhendo a linha de saída (0800, 6642, app VoIP…), sem depender da linha padrão do portal.

Versão atual: **0.2.1** (veja o [Histórico de versões](#histórico-de-versões)).

---

## Requisitos

- Google Chrome (ou outro navegador baseado em Chromium) recente. O recurso `world: "MAIN"` dos content scripts exige Chrome 111 ou mais novo.
- Portal Bitrix24 em nuvem, em `*.bitrix24.com.br` ou `*.bitrix24.com`. Outros domínios precisam de ajuste (veja [Limitações](#limitações)).
- Para o botão "Ligar por…": telefonia configurada no portal e usuário com permissão para fazer chamadas.
- Para a transcrição: um webhook (por exemplo, um fluxo do n8n) que receba o áudio e devolva o texto.

## Instalação

1. Baixe o zip da última versão em **Releases** (lado direito da página do repositório no GitHub) e descompacte. Também dá para usar `git clone`.
2. Abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta que contém o `manifest.json`.
5. Recarregue as abas do Bitrix24 que já estavam abertas.

### Atualizar

Baixe a versão nova por cima da pasta (ou `git pull`), volte em `chrome://extensions` e clique no ícone de recarregar da extensão. Depois recarregue as abas do Bitrix24. As configurações são mantidas.

## Configuração

Clique no ícone da extensão (ou em **Detalhes → Opções da extensão**). Tudo é salvo ao clicar em **Salvar**, no fim da página.

| Opção | O que faz | Padrão |
|---|---|---|
| Tema WhatsApp | Aplica cores e layout do WhatsApp ao Canal Aberto | ligado |
| Player de áudio | Troca o player padrão por um com velocidade 1× / 1,5× / 2× | ligado |
| Botão de gravar áudio | Mostra o microfone no compositor | ligado |
| Ouvir o áudio gravado antes de enviar | Ao parar a gravação, mostra uma prévia para ouvir, descartar ou enviar. Desmarcado, anexa direto ao chat | ligado |
| URL do webhook (n8n) | Endereço que recebe o áudio para transcrever | vazio |
| Token (opcional) | Enviado como `Authorization: Bearer <token>` | vazio |
| Responder com a transcrição em mensagem oculta | Grava o texto no chat como mensagem de sistema, visível só para a equipe | ligado |
| Transcrever automaticamente | Transcreve sozinho os áudios do cliente recebidos **hoje**; os mais antigos só pelo botão | desligado |
| Linhas no menu "Ligar por…" | Esconde linhas e muda a ordem do menu | todas, na ordem do Bitrix |
| Ligar para qualquer número | Discador livre: escolhe a linha e liga | — |

Ao salvar uma URL de webhook, o Chrome pede permissão para a extensão acessar aquele domínio. Ela é necessária: sem ela a chamada ao webhook é bloqueada.

> As listas de linhas e as demais opções ficam no armazenamento do navegador (`chrome.storage.sync`), sincronizado com a conta Google do Chrome. Elas valem para todos os portais abertos naquele perfil, não por portal.

## Funcionalidades

### Tema, gravador e player (Canal Aberto)

A extensão só age quando a página tem o bate-papo de Canal Aberto (div `.bx-imol-list-container-recent__container.bx-imol-messenger__scope`). Nas demais telas do Bitrix24 nada muda.

- **Tema** (`content/theme.css`): cores, balões, lista de conversas, cabeçalho e compositor no padrão WhatsApp.
- **Gravador**: botão de microfone no compositor. Na primeira vez o Chrome pede acesso ao microfone. Grava em Opus e gera um `.ogg` (WebCodecs + muxer próprio em `content/ogg.js`; se o navegador não suportar, usa MediaRecorder/webm). Esc descarta a gravação.
- **Prévia antes de enviar** (desde a v0.2.1): ao parar, o compositor mostra um mini player com 🗑 descartar, ▶ ouvir, barra de tempo e ➤ enviar. Só o ➤ da prévia anexa o áudio. Dá para desligar nas opções.
- **Envio ao chat:** o arquivo é enviado simulando arrastar e soltar, o que abre a janela "Selecionados" do Bitrix; se o Bitrix não aceitar, tenta colar; se também falhar, o arquivo é baixado para envio manual.
- **Player**: mensagens com áudio (.oga, .ogg, .mp3…) ganham player com velocidade 1× / 1,5× / 2×.

### Transcrição de áudio

O botão no player envia o áudio ao webhook e mostra o texto embaixo do áudio. Com a opção ligada, também responde o áudio com uma mensagem oculta (`im.v2.Chat.Message.send`, `fields[system]=Y`, `fields[replyId]`) no formato:

```
🎙 Transcrição do áudio #<messageId>:
<texto>
```

O `#<messageId>` permite que outras pessoas com a extensão vejam que aquele áudio já foi transcrito. As transcrições também ficam guardadas localmente no navegador (`chrome.storage.local`).

#### Contrato do webhook

`POST multipart/form-data`, chamado pelo service worker da extensão (fora das regras de CORS da página). Tempo limite: 2 minutos.

| Campo | Conteúdo |
|---|---|
| `audio` | arquivo binário do áudio |
| `dialogId` | ex.: `chat7489` |
| `chatId` | ex.: `7489` |
| `messageId` | id da mensagem que contém o áudio |
| `fileId`, `fileName`, `mimeType` | dados do arquivo no Bitrix |
| `publicUrl` | link público do ChatApp, quando existir na mensagem |
| `bitrixHost` | host do portal |

Resposta esperada: `{"text": "transcrição"}`. Também são aceitos os campos `transcription`, `transcricao`, `output` ou `result`, um array com o objeto na primeira posição, ou texto puro.
Se a resposta vier sem texto, a extensão entende que o próprio n8n vai responder no chat.

### Botão "Ligar por…" (desde a v0.2.0)

- **Onde aparece:** no topo da ficha de contato, lead, empresa e negócio (ao lado dos botões da direita), inclusive quando a ficha abre no painel lateral, e no cabeçalho do bate-papo de Canal Aberto. Em chats internos (entre colegas) não aparece.
- **Números:** os telefones da ficha. No negócio, os do contato principal (ou da empresa). No bate-papo, os do contato, lead ou empresa vinculado ao chat (`imopenlines.dialog.get` → `entity_data_2`). Números repetidos em formatos diferentes aparecem uma vez. Sempre há o campo "Outro número".
- **Linhas:** as mesmas do teclado de Telefonia (`voximplant.callView.getLines`), sem precisar de permissão de administrador.
- **Chamada:** `BX.Messenger.v2.Lib.PhoneManager.getInstance().startCall(numero, { LINE_ID, ENTITY_TYPE, ENTITY_ID })`, o mesmo caminho do teclado de Telefonia. A chamada fica vinculada à ficha do CRM. Linhas de aplicativo (tipo REST) o Bitrix encaminha sozinho para o app.
- **Discador nas opções:** o campo "Ligar para qualquer número" usa a aba do Bitrix24 que estiver aberta. Sem aba aberta, as linhas não carregam.

## Limitações

- **Domínios:** só funciona em `*.bitrix24.com.br` e `*.bitrix24.com`. Para outro domínio (`.eu`, `.es`, portal próprio), inclua-o nos três blocos `matches` do `manifest.json` e recarregue a extensão.
- **Site do portal:** a transcrição envia o cabeçalho `x-bitrix-site-id: s1`. Portais com outro site padrão precisam ajustar `content/content.js`.
- **Configuração por navegador:** ordem e linhas ocultas valem para o perfil do Chrome inteiro, não por portal nem por usuário do Bitrix.
- **Dependência do layout do Bitrix:** o tema, o gravador e o botão se apoiam em classes CSS e objetos JavaScript internos do Bitrix24 (não são API pública). Uma atualização do Bitrix pode quebrar algum recurso até a extensão ser ajustada.
- **Token do webhook:** fica salvo em `chrome.storage.sync` sem criptografia e é sincronizado com a conta Google. Use um token só para isso.
- **Sem loja:** a extensão não está na Chrome Web Store; a instalação é sempre pelo modo do desenvolvedor.

## Estrutura de arquivos

```
manifest.json            configuração da extensão (versão, permissões, content scripts)
background.js            service worker: envia o áudio ao webhook de transcrição
options.html / .js       tela de opções e popup (configurações, linhas, discador)
icons/                   ícones 16, 48 e 128 px
content/
  content.js             ativação no Canal Aberto, gravador, player e transcrição
  recorder.js            captura do microfone e codificação Opus
  ogg.js                 montagem do arquivo .ogg
  theme.css              tema WhatsApp
  ui.css                 componentes visuais da extensão (gravador, player)
  caller-main.js         botão "Ligar por…" (roda no contexto da página, world MAIN, em todos os frames)
  caller-bridge.js       ponte entre a página e as opções da extensão (linhas, discador)
  caller.css             estilo do botão e do menu de linhas
```

## Solução de problemas

- **Nada mudou no Bitrix:** recarregue a aba depois de instalar ou atualizar a extensão. Confira se o domínio do portal está em `matches`.
- **O botão "Ligar por…" não aparece:** confira se a telefonia está ativa para o seu usuário e se a ficha tem telefone (ou use "Outro número").
- **"Permissão para o host do webhook negada":** salve de novo e aceite o pedido do Chrome.
- **"Webhook demorou mais de 2 minutos":** o fluxo do n8n precisa responder em até 2 minutos.
- **Erros detalhados:** abra o DevTools (F12) na aba do Bitrix e veja o Console; para o webhook, veja o service worker em `chrome://extensions` → **Inspecionar visualizações**.

## Histórico de versões

O que mudou em cada versão está no [CHANGELOG.md](CHANGELOG.md).

### Publicar uma versão nova

1. Escreva a seção da versão no topo do `CHANGELOG.md` (`## [x.y.z] - AAAA-MM-DD`).
2. Suba o `version` no `manifest.json`.
3. Faça commit e push no `main`.

O GitHub Actions (`.github/workflows/release.yml`) cria a tag `vx.y.z` e uma Release com o zip da extensão e as notas do CHANGELOG. Push sem mudança de versão não gera Release.

## Licença

MIT. Veja [LICENSE](LICENSE).
