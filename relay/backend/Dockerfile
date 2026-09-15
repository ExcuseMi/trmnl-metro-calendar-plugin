# No dependencies on purpose: the whole service is one file of Node's own
# standard library, so there is no lockfile to drift and nothing to audit.
FROM node:22-alpine

WORKDIR /app
COPY server.js ./

ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

# It fetches URLs other people choose, so it runs as nobody in particular.
USER node

CMD ["node", "server.js"]
