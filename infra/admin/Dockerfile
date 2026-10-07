FROM nginx:stable-alpine
ENV ADMIN_API_UPSTREAM=http://host.docker.internal:3114
COPY infra/admin/default.conf.template /etc/nginx/templates/default.conf.template
COPY apps/admin/dist/ /usr/share/nginx/html/
