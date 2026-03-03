FROM nginx:alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy web resources
COPY resources/ /usr/share/nginx/html/

# Remove Neutralinojs-specific files not needed for web serving
RUN rm -f /usr/share/nginx/html/js/neutralino.js && \
    rm -rf /usr/share/nginx/html/icons/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
