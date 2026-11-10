plugins {
    java
    id("dev.arbjerg.lavalink.gradle-plugin") version "1.0.15"
}

group = "local.music"
version = "1.0.0"

lavalinkPlugin {
    name = "somafm-plugin"
    path = "local.music.somafm"
    apiVersion = "4.0.6"
    serverVersion = "4.0.6"
}

java {
    toolchain { languageVersion = JavaLanguageVersion.of(17) }
}

repositories { mavenCentral() }

dependencies {
    testImplementation("dev.arbjerg.lavalink:plugin-api:4.0.6")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform() }

tasks.withType<JavaCompile>().configureEach { options.encoding = "UTF-8" }
