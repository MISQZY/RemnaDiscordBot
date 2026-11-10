FROM gradle:8.14.3-jdk17 AS soma-build
USER root
WORKDIR /build
COPY somafm/ ./
RUN gradle --no-daemon test build

FROM ghcr.io/lavalink-devs/lavalink:4.2.2-alpine
COPY --from=soma-build /build/build/libs/somafm-plugin-1.0.0.jar /opt/Lavalink/somafm-plugin.jar
# Keep the built plugin in the existing persistent plugins volume on each start.
ENTRYPOINT ["/bin/sh", "-c", "cp /opt/Lavalink/somafm-plugin.jar /opt/Lavalink/plugins/somafm-plugin-1.0.0.jar && exec java -jar /opt/Lavalink/Lavalink.jar"]
