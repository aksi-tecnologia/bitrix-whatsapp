# Modelo n8n: transcrição de áudio

Fluxo pronto para importar no n8n e usar como webhook de transcrição da extensão.
Arquivo: [`transcricao-audio.json`](transcricao-audio.json).

## Dois modos

O modo é escolhido pela URL que você coloca nas opções da extensão.

| | Modo simples | Modo completo |
|---|---|---|
| URL na extensão | `https://SEU-N8N/webhook/bitrix-transcricao?return=true` | `https://SEU-N8N/webhook/bitrix-transcricao` |
| O que o n8n faz | Transcreve e devolve `{"text": "..."}` | Transcreve, responde no chat com mensagem oculta e registra o áudio |
| Quem responde no chat | A extensão (opção "Responder o áudio com a transcrição em mensagem oculta") | O próprio n8n |
| Evita transcrever duas vezes | Não | Sim (Data Table + trava no Redis) |
| Precisa de | OpenAI | OpenAI, Redis, Data Table do n8n e webhook de entrada do Bitrix24 |

Comece pelo modo simples. Use o completo quando várias pessoas com a extensão ligada
(ou a transcrição automática) puderem pedir o mesmo áudio ao mesmo tempo.

## Importar

1. No n8n: **Workflows → Import from File** e escolha `transcricao-audio.json`.
2. Abra o nó **Webhook** e copie a **Production URL** (o caminho é `bitrix-transcricao`; troque se quiser).
3. Configure as credenciais conforme o modo (abaixo).
4. **Publique / ative** o fluxo.
5. Nas opções da extensão, cole a URL em "URL do webhook (n8n)", com ou sem `?return=true`, e clique em Salvar.

## Configurar

### Modo simples
- **Transcrever e devolver (OpenAI)**: escolha ou crie uma credencial da OpenAI. O idioma está em `pt`.

### Modo completo
1. **Data Table**: crie uma tabela (ex.: `audiosTranscritos`) com as colunas `messageId`, `audioId` e `dadosCompletos`, todas do tipo texto. Selecione-a nos nós **Já transcrito? (buscar)** e **Registrar transcrição**.
2. **Trava (Redis)**: credencial do Redis. A trava expira em 5 minutos, para liberar nova tentativa se a transcrição falhar.
3. **Transcrever (OpenAI)**: credencial da OpenAI.
4. **Responder no chat (Bitrix)**: troque a URL `https://SEU-PORTAL.bitrix24.com.br/rest/ID_USUARIO/TOKEN_DO_WEBHOOK/im.message.add` pela do seu webhook de entrada.
   - No Bitrix24: **Aplicativos → Recursos para desenvolvedores → Outros → Webhook de entrada**, com a permissão `im` (Mensageiro).
   - A mensagem sai no formato `🎙 Transcrição do áudio #<messageId>:`, que a extensão reconhece para mostrar o texto embaixo do áudio para todo mundo.
   - Não monte essa URL com o campo `bitrixHost` recebido: qualquer pessoa poderia mandar outro host e receber o seu token.

## Segurança

- A URL do webhook do n8n é pública. Para restringir, ligue **Authentication → Header Auth** no nó Webhook com o cabeçalho `Authorization` e o valor `Bearer SEU_TOKEN`, e coloque `SEU_TOKEN` no campo "Token" das opções da extensão.
- O token do webhook do Bitrix dá acesso ao Mensageiro em nome do usuário que o criou. Crie-o com um usuário técnico e só com a permissão `im`.

## O que a extensão envia

`POST multipart/form-data` com `audio` (arquivo) e os campos `dialogId`, `chatId`, `messageId`, `fileId`, `fileName`, `mimeType`, `publicUrl` e `bitrixHost`. Detalhes no [README principal](../README.md#contrato-do-webhook).
