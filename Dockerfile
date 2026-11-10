FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY apps ./apps
COPY packages ./packages
COPY roles ./roles
COPY themes ./themes
COPY plugins ./plugins
# 非 root 运行；数据目录由卷挂载
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "apps/api/server.js"]
