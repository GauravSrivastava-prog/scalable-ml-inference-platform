# Use the official Prometheus image
FROM prom/prometheus:latest

# Copy your custom configuration file into the container
COPY prometheus.yml /etc/prometheus/prometheus.yml

# Expose the default Prometheus port
EXPOSE 9090