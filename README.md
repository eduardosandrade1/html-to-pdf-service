# html-to-pdf-service

Serviço HTTP em Node.js que recebe HTML completo e devolve um PDF de alta fidelidade, renderizado com **Chromium via Playwright**. Construído com **Fastify**.

```
Cliente (Laravel/Node/etc.)
        |
        | POST /v1/pdf  (HTML + opções)
        v
html-to-pdf-service
        |
        | Playwright -> Chromium
        v
       PDF
        |
        v
Content-Type: application/pdf
```

## 1. O que é o projeto

Uma API HTTP privada, sem banco de dados, sem filas e sem TypeScript, que:

- Recebe HTML (com CSS embutido, imagens base64, SVG, fontes) via `POST /v1/pdf` e devolve o PDF diretamente no corpo da resposta.
- Ou, via `POST /v1/pdf/file`, gera o PDF, salva em disco e devolve uma URL para download em `GET /files/:filename`.
- Reaproveita uma única instância do Chromium para todas as requisições (não abre um browser novo por request).
- Exige autenticação por API key em todos os endpoints `/v1/*`.
- Limpa automaticamente os PDFs salvos após um tempo de retenção configurável.

## 2. Requisitos

- Node.js **20+**
- npm
- Para rodar localmente sem Docker: dependências de sistema do Chromium (o Playwright instala o binário do Chromium, mas em Linux pode ser necessário instalar bibliotecas do sistema operacional — veja o passo `playwright install --with-deps`).
- Para rodar via Docker: apenas Docker e Docker Compose (a imagem já inclui o Chromium).

## 3. Instalação local

```bash
cd html-to-pdf-service
npm install

# Baixa o binário do Chromium usado pelo Playwright e, em Linux,
# também instala as bibliotecas de sistema necessárias.
npx playwright install --with-deps chromium
```

> Se `--with-deps` falhar por falta de permissão de root, rode `sudo npx playwright install-deps chromium` separadamente e depois `npx playwright install chromium`.

## 4. Configuração do `.env`

Copie o arquivo de exemplo e ajuste os valores:

```bash
cp .env.example .env
```

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP do serviço |
| `HOST` | `0.0.0.0` | Interface de rede |
| `PDF_API_KEY` | `change-me` | Chave exigida no header `X-API-Key` para os endpoints `/v1/*` |
| `MAX_HTML_SIZE_MB` | `10` | Tamanho máximo aceito para o campo `html` |
| `OUTPUT_DIR` | `./output` | Diretório onde os PDFs de `/v1/pdf/file` são salvos |
| `PDF_BASE_URL` | `http://localhost:3000` | Base usada para montar a `url` retornada por `/v1/pdf/file` |
| `PDF_RETENTION_HOURS` | `24` | Tempo, em horas, que um PDF salvo permanece em disco antes de ser removido |
| `LOG_LEVEL` | `info` | Nível de log do Fastify/Pino |
| `PDF_TIMEOUT_MS` | `60000` | Timeout máximo para gerar um PDF antes de retornar `504` |
| `CORS_ORIGIN` | `*` | Origem(ns) permitidas em CORS (separadas por vírgula) |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `60` / `60000` | Limite de requisições por janela de tempo, por IP |
| `CLEANUP_INTERVAL_MS` | `900000` | Intervalo entre execuções da rotina de limpeza de arquivos antigos |

**Troque `PDF_API_KEY` para um valor forte e secreto antes de colocar o serviço em produção.**

## 5. Como executar

```bash
npm start        # produção
npm run dev       # desenvolvimento, com nodemon e reload automático
```

O servidor sobe em `http://localhost:3000` (ou o `HOST`/`PORT` configurados). No boot, o Chromium é iniciado uma única vez ("warm up") e reaproveitado por todas as requisições subsequentes.

## 6. Como executar com Docker

```bash
cp .env.example .env
# edite o .env, especialmente PDF_API_KEY

docker compose up -d
```

A imagem usa `mcr.microsoft.com/playwright:v1.47.0-jammy` como base, que já contém o Chromium e todas as dependências de sistema — não é necessário instalar nada manualmente no host.

Para ver os logs:

```bash
docker compose logs -f
```

Para parar:

```bash
docker compose down
```

## 7. Como testar o `/health`

```bash
curl http://localhost:3000/health
```

Resposta esperada:

```json
{ "status": "ok", "service": "html-to-pdf-service" }
```

Este endpoint **não exige** API key.

## 8. Como chamar `POST /v1/pdf`

Use o arquivo `payload.example.json` incluído no projeto como referência (renomeie/copie para `payload.json` se quiser seguir o exemplo abaixo à risca):

```bash
curl -X POST http://localhost:3000/v1/pdf \
  -H "Content-Type: application/json" \
  -H "X-API-Key: change-me" \
  --data-binary @payload.example.json \
  --output resultado.pdf
```

O PDF gerado é salvo em `resultado.pdf`.

## 9. Como chamar `POST /v1/pdf/file`

```bash
curl -X POST http://localhost:3000/v1/pdf/file \
  -H "Content-Type: application/json" \
  -H "X-API-Key: change-me" \
  --data-binary @payload.example.json
```

Resposta:

```json
{
  "success": true,
  "id": "pdf_ab12cd34ef56",
  "filename": "pdf_ab12cd34ef56.pdf",
  "url": "http://localhost:3000/files/pdf_ab12cd34ef56.pdf"
}
```

Baixe o arquivo com:

```bash
curl -O http://localhost:3000/files/pdf_ab12cd34ef56.pdf
```

## 10. Exemplos usando curl

Veja os itens 7, 8 e 9 acima. Todos os exemplos usam o arquivo `payload.example.json` incluído no repositório como corpo da requisição.

## 11. Exemplo de integração Laravel usando `Http::post()`

```php
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

// Devolve o PDF direto no corpo da resposta
$response = Http::withHeaders([
    'X-API-Key' => env('PDF_SERVICE_API_KEY'),
])->post(env('PDF_SERVICE_URL') . '/v1/pdf', [
    'html' => $html,
    'options' => [
        'format' => 'A4',
        'printBackground' => true,
        'preferCSSPageSize' => true,
    ],
]);

$pdf = $response->body();

Storage::put('pdfs/documento.pdf', $pdf);
```

Quando você prefere receber uma **URL** em vez do binário (por exemplo, para enviar por e-mail ou salvar a referência no banco), use `/v1/pdf/file`:

```php
$response = Http::withHeaders([
    'X-API-Key' => env('PDF_SERVICE_API_KEY'),
])->post(env('PDF_SERVICE_URL') . '/v1/pdf/file', [
    'html' => $html,
]);

$data = $response->json();
// $data['url'] aponta para o PDF gerado, ex:
// http://pdf-service:3000/files/pdf_ab12cd34ef56.pdf

// Se quiser baixar o conteúdo e guardar localmente no Laravel:
$pdfContent = Http::get($data['url'])->body();
Storage::put('pdfs/' . $data['filename'], $pdfContent);
```

Adicione ao `.env` do Laravel:

```
PDF_SERVICE_URL=http://localhost:3000
PDF_SERVICE_API_KEY=change-me
```

## 12. Explicação das opções de PDF

O campo `options` do corpo da requisição aceita as mesmas opções de [`page.pdf()`](https://playwright.dev) do Playwright:

| Opção | Tipo | Padrão | Descrição |
|---|---|---|---|
| `format` | string | `A4` | Formato do papel (`A4`, `Letter`, etc). Ignorado se `width`/`height` forem informados |
| `width` / `height` | string/number | — | Dimensões customizadas da página |
| `landscape` | boolean | `false` | Orientação paisagem |
| `printBackground` | boolean | `true` | Imprime cores e imagens de fundo definidas em CSS |
| `preferCSSPageSize` | boolean | `true` | Respeita `@page { size: ... }` definido no CSS do HTML recebido |
| `margin` | objeto | — | `{ top, right, bottom, left }`, ex: `"10mm"` |
| `scale` | number | `1` | Escala de renderização |
| `displayHeaderFooter` | boolean | `false` | Exibe cabeçalho/rodapé customizados |
| `headerTemplate` / `footerTemplate` | string | — | HTML do cabeçalho/rodapé quando `displayHeaderFooter` é `true` |

O serviço não modifica nem sanitiza o HTML recebido — ele é renderizado exatamente como enviado, incluindo regras `@page`, `page-break-inside`, `break-before`, imagens base64, SVG e fontes.

## 13. Segurança

- **Este serviço deve ficar atrás de autenticação e/ou firewall.** Ele renderiza HTML arbitrário (incluindo `<script>`, se presente) dentro de um browser real, e o HTML **não é sanitizado** — a responsabilidade de garantir que apenas HTML confiável seja enviado é da aplicação cliente. Não exponha este serviço diretamente à internet pública sem uma camada adicional de proteção (VPN, allowlist de IP, proxy reverso autenticado).
- Todos os endpoints `/v1/*` exigem o header `X-API-Key`, comparado com `PDF_API_KEY`.
- `helmet` está habilitado para cabeçalhos HTTP de segurança.
- Rate limiting (`@fastify/rate-limit`) protege contra abuso/força bruta.
- O tamanho do corpo da requisição é limitado por `MAX_HTML_SIZE_MB`.
- Nomes de arquivo em `/files/:filename` são sempre gerados internamente (nunca a partir do input do usuário) e validados contra path traversal.
- Stack traces nunca são retornadas ao cliente — o handler de erros global sempre responde com um JSON padronizado.
- API keys e o conteúdo completo do HTML nunca são gravados nos logs.

## 14. Limites

- Tamanho máximo do HTML: `MAX_HTML_SIZE_MB` (padrão 10 MB). Requisições maiores recebem `413`.
- Timeout de geração de PDF: `PDF_TIMEOUT_MS` (padrão 60s). Excedido, o serviço retorna `504`.
- Rate limit: `RATE_LIMIT_MAX` requisições por `RATE_LIMIT_WINDOW_MS` (padrão 60 req/min por IP). Excedido, retorna `429`.
- Retenção de arquivos salvos: `PDF_RETENTION_HOURS` (padrão 24h), após o qual são removidos automaticamente.

### Tabela de respostas de erro

| HTTP | Situação |
|---|---|
| `400` | Corpo inválido (ex: `html` ausente/vazio) |
| `401` | API key ausente ou incorreta |
| `413` | HTML acima do limite configurado |
| `429` | Rate limit excedido |
| `500` | Erro interno inesperado |
| `504` | Geração do PDF excedeu o timeout |

Todas seguem o formato `{ "success": false, "error": "..." }`.

## 15. Como fazer deploy em uma VPS

```bash
# 1. Instale o Node.js 20+ na VPS (ou use Docker, recomendado)
# 2. Clone/copie o projeto
git clone <seu-repositorio> html-to-pdf-service
cd html-to-pdf-service

# 3. Configure o .env
cp .env.example .env
nano .env   # defina PDF_API_KEY forte e ajuste PDF_BASE_URL

# 4. Suba com Docker (recomendado, evita instalar dependências do Chromium manualmente)
docker compose up -d

# Alternativa sem Docker:
npm install --omit=dev
npx playwright install --with-deps chromium
npm start
# Recomendado usar um process manager como pm2 ou systemd para manter o processo vivo
```

## 16. Como colocar atrás de Nginx

Exemplo de configuração de proxy reverso (`/etc/nginx/sites-available/html-to-pdf-service`):

```nginx
server {
    listen 80;
    server_name pdf.seudominio.com;

    client_max_body_size 15M;  # deve ser >= MAX_HTML_SIZE_MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 65s;   # deve ser >= PDF_TIMEOUT_MS/1000
    }
}
```

Ative com `ln -s` para `sites-enabled` e recarregue: `sudo nginx -t && sudo systemctl reload nginx`.

## 17. Como configurar HTTPS

A forma mais simples é usar o Certbot com o Nginx configurado acima:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d pdf.seudominio.com
```

O Certbot ajusta automaticamente o bloco `server` do Nginx para servir HTTPS e renova o certificado periodicamente. O serviço Node em si continua ouvindo apenas HTTP na rede interna — é o Nginx quem termina o TLS.

## 18. Como alterar o diretório de armazenamento

Ajuste `OUTPUT_DIR` no `.env` (caminho relativo ao diretório de execução, ou absoluto):

```
OUTPUT_DIR=/var/data/html-to-pdf-service
```

Se estiver usando Docker, atualize também o volume no `docker-compose.yml`:

```yaml
volumes:
  - /var/data/html-to-pdf-service:/app/output
```

## 19. Como alterar o tempo de retenção

Ajuste `PDF_RETENTION_HOURS` no `.env` (aceita valores fracionários, ex: `0.5` para 30 minutos) e reinicie o serviço. A rotina de limpeza roda a cada `CLEANUP_INTERVAL_MS` (padrão 15 minutos) e remove arquivos com mais tempo de vida do que o configurado.

## 20. Como trocar a API key

1. Gere uma chave forte, por exemplo: `openssl rand -hex 32`
2. Atualize `PDF_API_KEY` no `.env` (ou na variável de ambiente do container/orquestrador)
3. Reinicie o serviço (`docker compose restart` ou `npm start`)
4. Atualize todos os clientes que consomem a API com a nova chave

---

## Testes

```bash
npm test
```

Cobre: `GET /health`, API key ausente/inválida/válida, HTML vazio, geração de PDF via `/v1/pdf` (validando `Content-Type: application/pdf` e a assinatura `%PDF-` no início do arquivo) e geração via `/v1/pdf/file`. Os testes que dependem de renderização real são automaticamente pulados caso o binário do Chromium não esteja instalado no ambiente (rode `npx playwright install chromium` para habilitá-los).

## Estrutura do projeto

```
html-to-pdf-service/
├── src/
│   ├── app.js          # Fastify app: plugins, rotas, tratamento de erros
│   ├── server.js        # Entrypoint: listen, warm-up do browser, shutdown gracioso
│   ├── browser.js        # Instância global e reutilizável do Chromium
│   ├── pdf.js            # Renderização de HTML -> PDF (fontes, imagens, timeout)
│   ├── auth.js           # Middleware de autenticação por API key
│   ├── validation.js      # Validação do corpo das requisições
│   ├── storage.js         # Salvar/servir PDFs, path traversal safety, limpeza automática
│   └── config.js          # Leitura centralizada das variáveis de ambiente
├── output/                # PDFs gerados por /v1/pdf/file (gitignored)
├── tests/
│   └── health.test.js
├── payload.example.json
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```
