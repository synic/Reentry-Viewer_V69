FROM nginx:alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy all static files
COPY . /usr/share/nginx/html/

# Remove files that shouldn't be served
RUN rm -f /usr/share/nginx/html/Dockerfile \
           /usr/share/nginx/html/nginx.conf \
           /usr/share/nginx/html/.gitignore

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
