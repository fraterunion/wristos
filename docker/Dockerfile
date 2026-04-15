# WristOS API — local / CI image (monorepo root as context)
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY apps/api/package.json ./apps/api/

RUN npm install

COPY prisma ./prisma
COPY tsconfig.base.json ./
COPY apps/api ./apps/api

RUN npx prisma generate
RUN npm run build --workspace=@fraterunion/wristos-api

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "apps/api/dist/main.js"]
