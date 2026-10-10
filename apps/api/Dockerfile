# يُبنى من جذر المستودع: docker build -f apps/api/Dockerfile .
FROM node:22.22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@arso/api...
RUN pnpm --filter @arso/api deploy --prod --legacy /out

FROM node:22.22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
