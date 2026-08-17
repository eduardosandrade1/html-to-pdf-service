# Imagem oficial do Playwright já inclui Chromium, Firefox, WebKit e todas
# as dependências de sistema necessárias para renderização headless.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

ENV NODE_ENV=production

# Instala apenas dependências de produção
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Copia o restante do código-fonte
COPY src ./src
COPY .env.example ./.env.example

# Diretório onde os PDFs gerados via /v1/pdf/file são armazenados
RUN mkdir -p /app/output && chown -R pwuser:pwuser /app

EXPOSE 3000

# Roda como usuário não-root já criado na imagem base do Playwright
USER pwuser

CMD ["node", "src/server.js"]
