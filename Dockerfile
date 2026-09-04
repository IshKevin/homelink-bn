FROM node:22-alpine

# puppeteer's own downloaded Chrome is glibc-linked and won't exec on Alpine's
# musl libc (fails at runtime with "spawn ENOEXEC"). Use Alpine's native
# chromium package instead and skip the bundled download entirely.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ARG IMAGE_TAG=local
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILD_TIME=$BUILD_TIME
ENV IMAGE_TAG=$IMAGE_TAG

EXPOSE 3000

CMD ["npm", "start"]
