# Cris Parambu — Sistema de Gestão

Sistema web privado mobile-first (instalável como PWA) desenvolvido para vendas ambulantes, controle de estoque, clientes/fiados/parcelas, financeiro e gestão de aluguéis.

## Tecnologias

- **Frontend:** React + TypeScript + Tailwind CSS + Vite + PWA (`manifest.webmanifest` e `sw.js`)
- **Backend:** Node.js (v24+) + Express + Zod + Multer
- **Banco de Dados:** SQLite relacional (`node:sqlite` nativo com integridade referencial, modo WAL e transações atômicas)

## Como rodar em desenvolvimento

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Copie o arquivo de ambiente (opcional):
   ```bash
   cp .env.example .env
   ```
3. Inicie o sistema:
   ```bash
   npm run dev
   ```
4. Acesse no navegador: `http://localhost:3000`
   - Primeiro acesso padrão: usuário `cris`, senha `1234` (troque a senha em **Dinheiro → Trocar Minha Senha**).

## Como publicar em uma VPS (Produção)

1. Instale Node.js 24+ na VPS.
2. Envie o projeto e rode:
   ```bash
   npm install
   npm run build
   ```
3. Configure as variáveis de ambiente (`PORT=3000`, `NODE_ENV=production`, `DATA_DIR=/var/lib/cris-parambu`, `SESSION_SECRET=...`).
4. Inicie com Node ou PM2:
   ```bash
   NODE_ENV=production npm start
   ```
5. Coloque Nginx/Caddy com HTTPS na frente apontando para `http://127.0.0.1:3000` para ativar a instalação como PWA no celular.

## Testes automatizados

```bash
npm test
```
