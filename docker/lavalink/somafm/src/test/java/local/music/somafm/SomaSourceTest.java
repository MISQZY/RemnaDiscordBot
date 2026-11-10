package local.music.somafm;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class SomaSourceTest {
    @Test
    void acceptsOnlySomaStreams() {
        assertTrue(SomaSource.allowed("https://ice.somafm.com/groovesalad"));
        assertTrue(SomaSource.allowed("https://ice5.somafm.com/dronezone-128-mp3"));
        for (String url : new String[]{"http://ice.somafm.com/groovesalad", "https://localhost/stream",
            "https://ice.somafm.com.evil.test/stream", "https://user@ice.somafm.com/stream",
            "https://ice.somafm.com:8080/stream", "https://ice.somafm.com/a?redirect=http://localhost",
            "https://somafm.com/groovesalad.pls", "file:///etc/passwd"}) {
            assertFalse(SomaSource.allowed(url), url);
        }
    }
}
