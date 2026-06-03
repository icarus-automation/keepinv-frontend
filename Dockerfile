FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS installer
COPY package*.json ./
RUN npm install

FROM installer AS builder
COPY . .
ARG API_BASE_URL=https://asset-wise-api.geoplanph.com/api/v1
RUN printf "export const environment = {\n  production: true,\n  apiBaseUrl: '%s',\n};\n" "$API_BASE_URL" > src/environments/environment.ts
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
