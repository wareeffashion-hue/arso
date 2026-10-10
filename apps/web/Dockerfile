# يُبنى من جذر المستودع: docker build -f apps/web/Dockerfile .
FROM node:22.22-alpine AS build
RUN corepack enable
WORKDIR /repo
# وجهة وكيل /api تُكتب في إعداد Next وقت البناء
ARG API_INTERNAL_URL=http://api.railway.internal:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@arso/web...
# حارس: يفشل البناء إن لم تُكتب وجهة الوكيل الصحيحة في إعداد Next
RUN grep -q "$API_INTERNAL_URL" apps/web/.next/routes-manifest.json \
  || (echo "API_INTERNAL_URL لم يصل إلى بناء Next" && exit 1)

FROM node:22.22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=::
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
