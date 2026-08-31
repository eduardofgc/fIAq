# fIAq — imagem do app (SvelteKit + adapter-node)
# Build a partir da RAIZ do repositório (o lockfile do workspace pnpm fica aqui):
#   docker build --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... -t fiaq-app .

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# Instala todas as dependências (inclui dev, necessárias pro build)
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY fiaq-app/package.json fiaq-app/
RUN pnpm install --frozen-lockfile --filter fiaq-app
COPY fiaq-app fiaq-app

# Vite embute as VITE_* no bundle do browser — precisam existir no build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    DEPLOY_TARGET=node
RUN pnpm --filter fiaq-app build

# Só dependências de produção (adapter-node não embute as deps no build/)
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY fiaq-app/package.json fiaq-app/
RUN pnpm install --prod --frozen-lockfile --filter fiaq-app

# Imagem final — replica o layout do workspace pra preservar os symlinks do pnpm
FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production PORT=3000
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/fiaq-app/node_modules ./fiaq-app/node_modules
COPY --from=build /repo/fiaq-app/build ./fiaq-app/build
COPY --from=build /repo/fiaq-app/package.json ./fiaq-app/package.json
# scripts + data permitem rodar os seeds de dentro do container
COPY --from=build /repo/fiaq-app/scripts ./fiaq-app/scripts
COPY --from=build /repo/fiaq-app/data ./fiaq-app/data
WORKDIR /repo/fiaq-app
EXPOSE 3000
CMD ["node", "build"]
